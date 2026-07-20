/**
 * Throttled archival sweep pass (mission 03a968f5).
 *
 * Stamps `archivedAt` on terminal (done/dropped todos, converged/abandoned missions)
 * rows past their retention window, moving them out of the hot (`archivedAt IS NULL`)
 * index. Hygiene, not claim/build-latency-sensitive — same throttle shape as the
 * reconcile pass (coordinator-live.ts BUILD_PASS_INTERVAL_MS / shouldRunBuildPass) and
 * the same chunked keyset-paging + loop-yield shape as assertClaimInvariantsAsync
 * (invariant-check.ts).
 */

import { listTodosChunked, archiveTodosByIds } from './todo-store.js';
import { listMissions, archiveMissionsByTodoIds } from './mission-store.js';
import { yieldToLoop } from './loop-yield.js';

/** Minimum spacing between PERIODIC archival sweeps for a single project. Archival is
 *  not latency-sensitive (nothing waits on a row being marked archived), so this is
 *  coarser than BUILD_PASS_INTERVAL_MS (120_000, coordinator-live.ts:3524) — same
 *  throttle shape, longer window. */
export const ARCHIVAL_SWEEP_INTERVAL_MS = 300_000; // 5 min

/** Default retention window: a terminal (done/dropped/converged/abandoned) row is
 *  eligible for archival once this much time has passed since it went terminal. */
export const ARCHIVAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const ARCHIVAL_CHUNK_SIZE = 500;

const lastArchivalSweepMs = new Map<string, number>();

export function shouldRunArchivalSweep(project: string, now: number = Date.now()): boolean {
  const last = lastArchivalSweepMs.get(project);
  if (last !== undefined && now - last < ARCHIVAL_SWEEP_INTERVAL_MS) return false;
  lastArchivalSweepMs.set(project, now);
  return true;
}

export function _resetArchivalSweepThrottle(project?: string): void {
  if (project === undefined) lastArchivalSweepMs.clear();
  else lastArchivalSweepMs.delete(project);
}

export interface ArchivalSweepResult {
  todosArchived: number;
  missionsArchived: number;
}

export async function runArchivalSweep(
  project: string,
  opts: {
    now?: number;
    retentionMs?: number;
    chunkSize?: number;
    yieldFn?: () => Promise<void>;
    force?: boolean;
  } = {},
): Promise<ArchivalSweepResult> {
  const now = opts.now ?? Date.now();
  // Self-gated like a caller-forced pass: `force` lets tests/direct callers run outside
  // the throttle window; the periodic tick wiring below always passes force:true since
  // it already consulted shouldRunArchivalSweep as the outer gate (same two-seam shape
  // as build/reconcile — see orchestrator-live.ts).
  if (!opts.force && !shouldRunArchivalSweep(project, now)) {
    return { todosArchived: 0, missionsArchived: 0 };
  }
  const retentionMs = opts.retentionMs ?? ARCHIVAL_RETENTION_MS;
  const chunkSize = Math.max(opts.chunkSize ?? ARCHIVAL_CHUNK_SIZE, 1);
  const doYield = opts.yieldFn ?? yieldToLoop;
  const cutoff = now - retentionMs;

  // TODOS: keyset-paged + yielding (todo-store.ts listTodosChunked), same call shape as
  // assertClaimInvariantsAsync (invariant-check.ts). includeArchived:false is the
  // default but stated explicitly — never re-archive an already-archived row.
  const todos = await listTodosChunked(
    project,
    { includeCompleted: true, includeArchived: false },
    { pageSize: chunkSize, yieldFn: doYield },
  );
  let todosArchived = 0;
  let batch: string[] = [];
  for (const t of todos) {
    if (t.status !== 'done' && t.status !== 'dropped') continue;
    const terminalAtIso = t.status === 'done' ? (t.completedAt ?? t.updatedAt) : t.updatedAt;
    if (new Date(terminalAtIso).getTime() > cutoff) continue;
    batch.push(t.id);
    if (batch.length >= chunkSize) {
      todosArchived += archiveTodosByIds(project, batch, now);
      batch = [];
      await doYield(); // cede the HTTP loop between UPDATE batches too
    }
  }
  if (batch.length > 0) todosArchived += archiveTodosByIds(project, batch, now);

  // MISSIONS: the mission table is small (one row per mission, not per todo) — a single
  // listMissions call (already hot-only by default) is the same cost class as the
  // existing mission-loop pass; no chunking needed.
  const missions = listMissions(project, { includeArchived: false });
  const staleMissionTodoIds = missions
    .filter(
      (m) =>
        (m.mission.status === 'converged' || m.mission.status === 'abandoned') &&
        m.mission.updatedAt <= cutoff,
    )
    .map((m) => m.node.id);
  const missionsArchived =
    staleMissionTodoIds.length > 0 ? archiveMissionsByTodoIds(project, staleMissionTodoIds, now) : 0;

  return { todosArchived, missionsArchived };
}
