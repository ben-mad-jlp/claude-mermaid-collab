/**
 * Purge fixture rows from the production worker-ledger database.
 *
 * Fixture rows are test artifacts that should not exist in the live ledger:
 * - Rows with synthetic project roots (test directories)
 * - Rows with fixture todo IDs (test mocks)
 * - Rows with future timestamps (impossible time travel)
 *
 * Usage: bun run scripts/purge-ledger-fixture-rows.ts [--apply]
 * Default: --dry-run (no writes). Pass --apply to commit changes.
 * Exits non-zero if --apply ran and fixture rows remain after deletion.
 */

import Database from 'bun:sqlite';
import { storePath } from '../src/services/store-paths';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const UUID_TODO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SYNTHETIC_PROJECT_ROOTS = ['/proj/alpha', 'test-project-window', 'test-project-exclusion'];

export const FIXTURE_TODO_IDS = new Set([
  'worker-1',
  'todo-conductor-1',
  'todo-other-source',
  'todo-0',
  'todo-1',
  'todo-2',
  'todo-3',
  'todo-4',
  'todo-5',
  'todo-6',
  'todo-7',
  'todo-8',
  'todo-9',
]);

export const AMBIGUOUS_TODO_IDS = ['node', 'planner'];

/**
 * Check if a project root is synthetic (a test directory).
 * Matches exact project roots and /tmp/node-invoker-* patterns.
 */
export function isSyntheticProjectRoot(project: string): boolean {
  // Exact matches
  if (SYNTHETIC_PROJECT_ROOTS.includes(project)) {
    return true;
  }

  // Pattern match /tmp/node-invoker-*
  if (project.match(/^\/tmp\/node-invoker-/)) {
    return true;
  }

  return false;
}

export type FixtureRowClass = 'fixture-todo-id' | 'synthetic-project-root' | 'future-dated';

export interface LedgerRow {
  id: number;
  todoId: string;
  project: string;
  ts: number;
}

/**
 * Classify a ledger row as fixture or real.
 * Returns the fixture class or null if the row is real.
 *
 * Evaluation order (first match wins):
 * 1. UUID todoId under non-synthetic project → null (always real)
 * 2. Future timestamp (ts > now) → 'future-dated'
 * 3. Fixture todo ID → 'fixture-todo-id'
 * 4. Ambiguous todo ID under synthetic project → 'synthetic-project-root'
 * 5. Synthetic project root → 'synthetic-project-root'
 * 6. Otherwise → null (real)
 */
export function classifyLedgerRow(
  row: { todoId: string; project: string; ts: number },
  now: number,
): FixtureRowClass | null {
  // 1. UUID guard first — real rows with UUID todoId are NEVER fixture
  if (UUID_TODO_ID.test(row.todoId) && !isSyntheticProjectRoot(row.project)) {
    return null;
  }

  // 2. Future-dated rows
  if (row.ts > now) {
    return 'future-dated';
  }

  // 3. Known fixture todo IDs
  if (FIXTURE_TODO_IDS.has(row.todoId)) {
    return 'fixture-todo-id';
  }

  // 4. Ambiguous todo IDs (only under synthetic projects)
  if (AMBIGUOUS_TODO_IDS.includes(row.todoId) && isSyntheticProjectRoot(row.project)) {
    return 'synthetic-project-root';
  }

  // 5. Synthetic project roots themselves
  if (isSyntheticProjectRoot(row.project)) {
    return 'synthetic-project-root';
  }

  // 6. Real row
  return null;
}

/**
 * Pure boolean predicate: is this row a fixture row?
 */
export function isFixtureLedgerRow(row: { todoId: string; project: string; ts: number }, now: number = Date.now()): boolean {
  return classifyLedgerRow(row, now) !== null;
}

export interface PurgeReport {
  scanned: number;
  matchedByClass: Record<FixtureRowClass, number>;
  deleted: number;
  remaining: number;
  remainingFixtures: number;
}

/**
 * Purge fixture rows from the worker-ledger database.
 * In dry-run mode, reports what would be deleted without changing the DB.
 * In apply mode, deletes the matched rows and re-counts fixtures.
 */
export function purgeLedgerFixtureRows(db: Database, opts: { apply: boolean; now: number }): PurgeReport {
  // Read all rows
  const allRows = db.prepare('SELECT id, project, todoId, ts FROM worker_ledger').all() as LedgerRow[];

  const toDelete: number[] = [];
  const matchedByClass: Record<FixtureRowClass, number> = {
    'fixture-todo-id': 0,
    'synthetic-project-root': 0,
    'future-dated': 0,
  };

  // Classify each row
  for (const row of allRows) {
    const classification = classifyLedgerRow(row, opts.now);
    if (classification) {
      toDelete.push(row.id);
      matchedByClass[classification]++;
    }
  }

  if (!opts.apply) {
    // Dry-run: don't modify, just report what we found
    return {
      scanned: allRows.length,
      matchedByClass,
      deleted: 0,
      remaining: allRows.length,
      remainingFixtures: toDelete.length,
    };
  }

  // Apply: delete the matched rows
  const deleteStmt = db.prepare('DELETE FROM worker_ledger WHERE id = ?');
  db.transaction(() => {
    for (const id of toDelete) {
      deleteStmt.run(id);
    }
  })();

  // Re-read and recount fixtures using the same predicate
  const afterDelete = db.prepare('SELECT id, project, todoId, ts FROM worker_ledger').all() as LedgerRow[];
  let remainingFixtures = 0;
  for (const row of afterDelete) {
    if (isFixtureLedgerRow(row, opts.now)) {
      remainingFixtures++;
    }
  }

  return {
    scanned: allRows.length,
    matchedByClass,
    deleted: toDelete.length,
    remaining: afterDelete.length,
    remainingFixtures,
  };
}

async function main() {
  const args = process.argv.slice(2);
  let apply = false;

  for (const arg of args) {
    if (arg === '--apply') {
      apply = true;
    }
  }

  console.log(`\nPurge worker-ledger fixture rows`);
  console.log(`   mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log('');

  // Open the database
  const path = storePath('workerLedger');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);

  try {
    const report = purgeLedgerFixtureRows(db, { apply, now: Date.now() });

    console.log(`Scanned: ${report.scanned} rows`);
    console.log(`Matched by class:`);
    for (const [cls, count] of Object.entries(report.matchedByClass)) {
      if (count > 0) {
        console.log(`  ${cls}: ${count}`);
      }
    }
    console.log(`Deleted: ${report.deleted} rows`);
    console.log(`Remaining: ${report.remaining} rows`);
    console.log(`Remaining fixtures: ${report.remainingFixtures}`);

    if (apply && report.remainingFixtures !== 0) {
      console.log(`\nVERIFICATION FAILED — ${report.remainingFixtures} fixture rows remain after deletion`);
      process.exit(1);
    }

    console.log(`${apply ? '\nPURGE APPLIED' : '\nDRY-RUN COMPLETE'}`);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
