/**
 * Repair the quarantine bucket by:
 * 1. Marking dispositioned IDs as done with a note (idempotent)
 * 2. Collapsing file-key duplicates via collapseQuarantineDuplicates
 * 3. Collapsing the three ui suite-lane rows to one survivor
 * 4. Reporting unresolved rows that have neither a file nor a lane key
 *
 * Usage: bun run scripts/repair-quarantine-bucket.ts [--apply] [project-root]
 * Default: --dry-run (no writes). Pass --apply to commit changes.
 * If project-root is omitted, defaults to process.cwd().
 */

import Database from 'bun:sqlite';
import { collapseQuarantineDuplicates, quarantineDedupKey } from '../src/services/quarantine-dedup';
import {
  listTodos,
  updateTodo,
  type Todo,
  openDb,
} from '../src/services/todo-store';
import { resolveQuarantineTestFile, resetQuarantineTestFileCache } from '../src/services/quarantine-test-file';

export const QUARANTINE_TITLE_PREFIX = '[BUG] flaky test quarantined: ';

// The 7 dispositioned IDs from the blueprint
export const DISPOSITIONED_TODO_IDS = [
  '75cf4886',
  'b907c28a',
  '6858c35a',
  'babd725b',
  '7bb1d0fa',
  '49cfe113',
  '7cd6d419',
] as const;

export const DISPOSITION_NOTE =
  'Dispositioned: see docs/baseline-failure-dispositions.md, fixed/justified in commit 395e96e1.';

interface QuarantineDedupDeps {
  listTodos?: typeof listTodos;
  updateTodo?: typeof updateTodo;
  resolveTestFile?: (project: string, test: string) => string | null;
}

/**
 * Derive a group key for dedup. Returns:
 * - quarantineDedupKey result (file path) if resolvedPath is non-null
 * - a suite-lane prefix if the suffix matches `suites:\S+::[a-z-]+` pattern
 * - null if neither applies (unresolvable row)
 */
export function quarantineGroupKey(suffix: string, resolvedPath: string | null): string | null {
  if (resolvedPath) {
    return quarantineDedupKey(suffix, resolvedPath);
  }

  const stripped = suffix.replace(/^\(\d+\/\d+\)\s*/, '');

  // Match suite-lane pattern: `suites:^ui\/::unhandled-rejection:...`
  const laneMatch = stripped.match(/^(suites:\S+?::[a-z-]+)/);
  if (laneMatch) {
    return laneMatch[1];
  }

  return null;
}

interface DispositionedRow {
  id: string;
  alreadyClosed: boolean;
}

interface Group {
  key: string;
  survivorId: string;
  closeIds: string[];
}

interface UnresolvedRow {
  id: string;
  title: string;
}

export interface QuarantineBucketRepairPlan {
  openBefore: number;
  dispositioned: DispositionedRow[];
  groups: Group[];
  unresolved: UnresolvedRow[];
}

/**
 * Analyze the live quarantine bucket and plan the repair.
 * Does not write — returns the plan for inspection or application.
 */
export function planQuarantineBucketRepair(
  project: string,
  deps: QuarantineDedupDeps = {},
): QuarantineBucketRepairPlan {
  const listTodosFn = deps.listTodos ?? listTodos;
  const resolveTestFileFn = deps.resolveTestFile ?? resolveQuarantineTestFile;

  // Step 1: Load all open quarantine rows
  const rows = listTodosFn(project, { includeCompleted: true }).filter(
    (t) =>
      t.title.startsWith(QUARANTINE_TITLE_PREFIX) &&
      t.status !== 'done' &&
      t.status !== 'dropped',
  );

  const openBefore = rows.length;

  // Step 2: Identify dispositioned rows (load ALL rows including completed)
  // to catch already-terminal dispositioned rows that need note-stamping
  const allRows = listTodosFn(project, { includeCompleted: true }).filter((t) =>
    t.title.startsWith(QUARANTINE_TITLE_PREFIX),
  );
  const dispositionedMap = new Map<string, Todo>();
  const dispositionedSet = new Set(DISPOSITIONED_TODO_IDS);
  for (const row of allRows) {
    if (dispositionedSet.has(row.id.slice(0, 8))) {
      dispositionedMap.set(row.id, row);
    }
  }

  const dispositioned: DispositionedRow[] = Array.from(dispositionedMap.values()).map((row) => ({
    id: row.id,
    alreadyClosed: row.status === 'done' || row.status === 'dropped',
  }));

  // Step 3: Collect rows for dedup (exclude already-terminal dispositioned rows)
  const dedupCandidates = rows.filter((r) => !dispositionedSet.has(r.id.slice(0, 8)));

  // Step 4: Group by file-key or lane-key
  const byKey = new Map<string | null, Todo[]>();
  const unresolvedRows: UnresolvedRow[] = [];

  for (const row of dedupCandidates) {
    const suffix = row.title.slice(QUARANTINE_TITLE_PREFIX.length);
    const testFile = resolveTestFileFn(project, suffix);
    const key = quarantineGroupKey(suffix, testFile);

    if (key === null) {
      unresolvedRows.push({
        id: row.id,
        title: row.title,
      });
    } else {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(row);
    }
  }

  // Step 5: Identify survivors and duplicates for each key
  const groups: Group[] = [];

  for (const [key, group] of byKey) {
    if (key === null || group.length <= 1) continue;

    const sorted = [...group].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;

      // Prefer a row whose title already contains a src/ or ui/ path token
      const aHasPath = /\b(src|ui)\//.test(a.title);
      const bHasPath = /\b(src|ui)\//.test(b.title);
      if (aHasPath !== bHasPath) return aHasPath ? -1 : 1;

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const survivor = sorted[0];
    const closeIds = sorted.slice(1).map((r) => r.id);

    if (closeIds.length > 0) {
      groups.push({
        key,
        survivorId: survivor.id,
        closeIds,
      });
    }
  }

  return {
    openBefore,
    dispositioned,
    groups,
    unresolved: unresolvedRows,
  };
}

/**
 * Execute the repair plan, optionally writing changes.
 * When apply is true, updates todos via updateTodo (the store API).
 * When apply is false, returns the plan untouched.
 */
export async function runQuarantineBucketRepair(
  project: string,
  opts: { apply: boolean },
  deps: QuarantineDedupDeps = {},
): Promise<QuarantineBucketRepairPlan> {
  const updateTodoFn = deps.updateTodo ?? updateTodo;

  const plan = planQuarantineBucketRepair(project, deps);

  if (!opts.apply) {
    return plan;
  }

  // Step 1: Mark dispositioned rows as done and stamp the note
  for (const disp of plan.dispositioned) {
    const existing = listTodos(project, { includeCompleted: true }).find((t) => t.id === disp.id);
    if (!existing) continue;

    if (!disp.alreadyClosed) {
      // Open: mark as done with note
      const desc = existing.description ?? '';
      const newDesc = desc.includes(DISPOSITION_NOTE)
        ? desc
        : `${desc}\n\n${DISPOSITION_NOTE}`.trim();
      await updateTodoFn(project, disp.id, {
        status: 'done',
        description: newDesc,
      });
    } else {
      // Already terminal: stamp note if absent
      if (existing.description && !existing.description.includes(DISPOSITION_NOTE)) {
        const newDesc = `${existing.description}\n\n${DISPOSITION_NOTE}`.trim();
        await updateTodoFn(project, disp.id, {
          description: newDesc,
        });
      } else if (!existing.description) {
        // No description, add the note
        await updateTodoFn(project, disp.id, {
          description: DISPOSITION_NOTE,
        });
      }
    }
  }

  // Step 2: Collapse file-key duplicates via the shipped function
  // (This writes its own rows, so we just call it)
  await collapseQuarantineDuplicates(project, deps);

  // Step 3: Collapse lane-key duplicates (the ui suite rows)
  // Check if the row is still open before closing (collapseQuarantineDuplicates might have already closed it)
  for (const group of plan.groups) {
    for (const closeId of group.closeIds) {
      const existing = listTodos(project, { includeCompleted: true }).find((t) => t.id === closeId);
      if (existing && existing.status !== 'done' && existing.status !== 'dropped') {
        await updateTodoFn(project, closeId, {
          status: 'done',
          description: (existing.description ?? '') + `\n\nClosed as duplicate of ${group.survivorId} (dedup key: ${group.key}).`,
        });
      }
    }
  }

  return plan;
}

interface PostStateSummary {
  open: number;
  maxPerKey: number;
  byKey: Array<{ key: string; count: number }>;
  unresolved: number;
}

/**
 * Summarize the post-state: open count, per-key counts, max count per key, unresolved count.
 */
export function summarizeOpenByResolvedFile(project: string): PostStateSummary {
  const rows = listTodos(project, { includeCompleted: true }).filter(
    (t) =>
      t.title.startsWith(QUARANTINE_TITLE_PREFIX) &&
      t.status !== 'done' &&
      t.status !== 'dropped',
  );

  const byCounts = new Map<string, number>();
  let unresolvedCount = 0;

  for (const row of rows) {
    const suffix = row.title.slice(QUARANTINE_TITLE_PREFIX.length);
    const testFile = resolveQuarantineTestFile(project, suffix);
    const key = quarantineGroupKey(suffix, testFile);

    if (key === null) {
      unresolvedCount += 1;
    } else {
      byCounts.set(key, (byCounts.get(key) ?? 0) + 1);
    }
  }

  const byKey = [...byCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  const maxPerKey = byCounts.size > 0 ? Math.max(...byCounts.values()) : 0;

  return {
    open: rows.length,
    maxPerKey,
    byKey,
    unresolved: unresolvedCount,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let apply = false;
  let project = process.cwd();

  for (const arg of args) {
    if (arg === '--apply') {
      apply = true;
    } else if (!arg.startsWith('-')) {
      project = arg;
    }
  }

  console.log(`\nRepair quarantine bucket`);
  console.log(`   project: ${project}`);
  console.log(`   mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log('');

  const beforeSummary = summarizeOpenByResolvedFile(project);
  console.log(`Before: open=${beforeSummary.open} keys=${beforeSummary.byKey.length} maxPerKey=${beforeSummary.maxPerKey} unresolved=${beforeSummary.unresolved}`);

  const plan = await runQuarantineBucketRepair(project, { apply });

  console.log('');
  console.log(`Plan:`);
  console.log(`  Dispositioned rows: ${plan.dispositioned.length}`);
  for (const disp of plan.dispositioned) {
    console.log(`    ${disp.id.slice(0, 8)}: ${disp.alreadyClosed ? 'already closed' : 'marking done'}`);
  }

  console.log(`  File/lane groups to collapse: ${plan.groups.length}`);
  for (const group of plan.groups) {
    console.log(`    ${group.key}: close ${group.closeIds.length} into ${group.survivorId.slice(0, 8)}`);
  }

  console.log(`  Unresolved rows (leaving open): ${plan.unresolved.length}`);
  for (const unres of plan.unresolved) {
    console.log(`    ${unres.id.slice(0, 8)}: ${unres.title}`);
  }

  // Clear the cache before reading post-state
  resetQuarantineTestFileCache();

  const afterSummary = summarizeOpenByResolvedFile(project);
  console.log('');
  console.log(`After: open=${afterSummary.open} keys=${afterSummary.byKey.length} maxPerKey=${afterSummary.maxPerKey} unresolved=${afterSummary.unresolved}`);

  if (apply && afterSummary.maxPerKey > 1) {
    console.log(`\nVERIFICATION FAILED — maxPerKey > 1 after apply`);
    process.exit(1);
  }

  console.log(`${apply ? '\nREPAIR APPLIED' : '\nDRY-RUN COMPLETE'}`);
}

if (import.meta.main) {
  main();
}
