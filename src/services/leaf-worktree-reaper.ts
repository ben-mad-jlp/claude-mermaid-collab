import { getWorktreeManager } from './coordinator-live.js';
import { listLeafInflight } from './worker-ledger.js';
import { getTodo } from './todo-store.js';

const LEAF_EXEC_PREFIX = 'leaf-exec-';
const REAP_THROTTLE_MS = 5 * 60_000;

const lastReapMs = new Map<string, number>();

/**
 * Safety-net reaper for orphaned leaf-exec worktrees (epoch-death case).
 *
 * Called inside the coordinator's reapOrphanedLeaves tick callback. Throttled to once
 * per REAP_THROTTLE_MS per project so filesystem + git ops don't run every 30 s.
 *
 * Scope: only handles tracking-project === targetProject. Cross-project worktrees
 * (build123d / other repos) are deferred.
 */
export async function reapOrphanedLeafWorktrees(project: string): Promise<number> {
  const now = Date.now();
  if ((now - (lastReapMs.get(project) ?? 0)) < REAP_THROTTLE_MS) return 0;
  lastReapMs.set(project, now);

  const wm = getWorktreeManager(project);
  let records;
  try {
    records = await wm.list();
  } catch {
    return 0;
  }

  const leafRecords = records.filter((r) => r.sessionId.startsWith(LEAF_EXEC_PREFIX));
  if (leafRecords.length === 0) return 0;

  // Build the live-inflight set once (all projects share the same DB).
  const inflight = new Set(listLeafInflight().map((r) => r.leafId));

  let reaped = 0;
  for (const rec of leafRecords) {
    // Session key is 'leaf-exec-<id8>' or 'leaf-exec-<id8>-<suffix>' on collision.
    // id8 is always the first 8 hex chars after the prefix.
    const id8 = rec.sessionId.slice(LEAF_EXEC_PREFIX.length, LEAF_EXEC_PREFIX.length + 8);
    if (id8.length < 8) continue;

    const todo = getTodo(project, id8);
    if (!todo) continue; // can't verify terminal status — skip (conservative)

    const isTerminal = todo.status === 'done' || todo.status === 'dropped';
    if (!isTerminal) continue;

    if (inflight.has(todo.id)) continue; // actively running — never touch it

    try {
      await wm.remove(rec.sessionId);
      reaped++;
      console.log(
        `[worktree-reaper] reaped orphaned worktree ${rec.sessionId} (${rec.path}), ` +
        `todo=${todo.id.slice(0, 8)} status=${todo.status}`,
      );
    } catch {
      // best-effort; wm.remove already handles "not a working tree" gracefully
    }
  }

  return reaped;
}
