/**
 * parent-epic-under-mission.ts — per-epic backfill CLI for §4d mission parenting.
 *
 * Re-parents ONE epic under ONE mission. Dry-run by default; mutates only with
 * `--commit`. This is a human decision per epic, never a bulk operation — it
 * mutates the live work graph, so treat every run against `.collab/todos.db`
 * deliberately.
 *
 * Usage:
 *   bun scripts/parent-epic-under-mission.ts <epicId> <missionId> [--commit] [--db <path>]
 *
 * Without --commit, prints the plan and writes nothing. With --commit, applies
 * a single-row UPDATE moving exactly the named epic.
 */
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import {
  epicBackfillSkipReason,
  isMissionTarget,
  type EpicBackfillSkipReason,
} from '../src/services/mission-parenting.ts';
import { MissingKindError } from '../src/services/todo-kind.ts';

export interface EpicRow {
  id: string;
  title: string | null;
  parentId: string | null;
  status: string;
  kind: string | null;
  claimedBy: string | null;
  claim: string | null;
  executedBySession: string | null;
}

export type Refusal =
  | { reason: 'epic-not-found' | 'mission-not-found'; message: string }
  | { reason: 'not-a-mission'; message: string }
  | { reason: EpicBackfillSkipReason; message: string }
  | { reason: 'claimed'; message: string }
  | { reason: 'in-flight-descendants'; message: string };

export interface Plan {
  epic: EpicRow;
  mission: EpicRow;
  oldParent: string | null;
  newParent: string;
}

function resolveOne(db: Database, id: string, notFoundReason: 'epic-not-found' | 'mission-not-found'): EpicRow | Refusal {
  const rows = db
    .query('SELECT id, title, parentId, status, kind, claimedBy, claim, executedBySession FROM todos WHERE id = ? OR id LIKE ?')
    .all(id, `${id}%`) as EpicRow[];
  if (rows.length === 0) {
    return { reason: notFoundReason, message: `No todo found matching id/prefix "${id}".` };
  }
  if (rows.length > 1) {
    return { reason: 'epic-not-found', message: `Ambiguous prefix "${id}" matches ${rows.length} rows.` };
  }
  return rows[0]!;
}

function isLive(row: EpicRow): boolean {
  return row.claimedBy != null || row.claim != null || row.executedBySession != null || row.status === 'in_progress';
}

export function planReparent(db: Database, epicId: string, missionId: string): Plan | Refusal {
  const epicResolved = resolveOne(db, epicId, 'epic-not-found');
  if ('reason' in epicResolved) return epicResolved;
  const epic = epicResolved;

  const missionResolved = resolveOne(db, missionId, 'mission-not-found');
  if ('reason' in missionResolved) return missionResolved;
  const mission = missionResolved;

  try {
    if (!isMissionTarget(mission)) {
      return {
        reason: 'not-a-mission',
        message: `Target ${mission.id} (title ${JSON.stringify(mission.title)}) has kind ${JSON.stringify(mission.kind)}, not "mission".`,
      };
    }
  } catch (err) {
    if (err instanceof MissingKindError) {
      return { reason: 'not-a-mission', message: `Target ${mission.id}: ${err.message}` };
    }
    throw err;
  }

  let skipReason: EpicBackfillSkipReason | null;
  try {
    skipReason = epicBackfillSkipReason(epic);
  } catch (err) {
    if (err instanceof MissingKindError) {
      return { reason: 'not-an-epic', message: `Epic ${epic.id}: ${err.message}` };
    }
    throw err;
  }
  if (skipReason != null) {
    return {
      reason: skipReason,
      message: `Epic ${epic.id} (title ${JSON.stringify(epic.title)}, kind ${JSON.stringify(epic.kind)}) is ${skipReason}.`,
    };
  }

  if (isLive(epic)) {
    return {
      reason: 'claimed',
      message: `Epic ${epic.id} is claimed/in-flight (claimedBy=${JSON.stringify(epic.claimedBy)}, status=${epic.status}).`,
    };
  }

  const visited = new Set<string>([epic.id]);
  const queue: string[] = [epic.id];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = db
      .query('SELECT id, title, parentId, status, kind, claimedBy, claim, executedBySession FROM todos WHERE parentId = ?')
      .all(parentId) as EpicRow[];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (isLive(child)) {
        return {
          reason: 'in-flight-descendants',
          message: `Descendant ${child.id.slice(0, 8)} (claimedBy=${JSON.stringify(child.claimedBy)}, status=${child.status}) is claimed/in-flight.`,
        };
      }
      queue.push(child.id);
    }
  }

  return { epic, mission, oldParent: epic.parentId, newParent: mission.id };
}

export function applyReparent(db: Database, plan: Plan): void {
  db.query('UPDATE todos SET parentId = ?, updatedAt = ? WHERE id = ?').run(
    plan.newParent,
    new Date().toISOString(),
    plan.epic.id,
  );
}

export function formatPlan(plan: Plan): string {
  return [
    `Epic:        ${plan.epic.id} (${JSON.stringify(plan.epic.title)})`,
    `Old parent:  ${plan.oldParent ?? '(root)'}`,
    `New parent:  ${plan.newParent} (mission ${JSON.stringify(plan.mission.title)})`,
  ].join('\n');
}

export function main(argv: string[]): number {
  const positional: string[] = [];
  let commit = false;
  let dbPath = join(process.cwd(), '.collab', 'todos.db');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--commit') {
      commit = true;
    } else if (arg === '--db') {
      dbPath = argv[++i] ?? dbPath;
    } else {
      positional.push(arg);
    }
  }

  const [epicId, missionId] = positional;
  if (!epicId || !missionId) {
    console.error('Usage: parent-epic-under-mission.ts <epicId> <missionId> [--commit] [--db <path>]');
    return 1;
  }

  const db = new Database(dbPath);
  try {
    const result = planReparent(db, epicId, missionId);
    if ('reason' in result) {
      console.error(`REFUSED (${result.reason}): ${result.message}`);
      return 2;
    }

    console.log(formatPlan(result));
    if (commit) {
      applyReparent(db, result);
      console.log('COMMITTED');
    } else {
      console.log('DRY RUN — nothing written. Re-run with --commit to apply.');
    }
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
