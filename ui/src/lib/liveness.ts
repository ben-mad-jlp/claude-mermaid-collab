/**
 * Shared worker-liveness derivation (Bridge redesign BR-2, design §2/§8).
 *
 * Extracted from WorkerPool's rows-memo so the WorkerRoster and future
 * FleetGraph nodes derive a session's state identically — one source of truth
 * for "is this worker active / idle / crashed", computed INLINE from
 * subscription freshness (no server round-trip, no supervisorLiveness helper).
 *
 * THIN CLIENT of the canonical read model (refactor C3): the server owns the
 * unified join + `deriveLiveness` in `src/services/session-runtime.ts`; this file
 * mirrors that shape (`SessionRuntime`) and keeps the SAME liveness rule so the
 * UI can either compute liveness inline (current) or consume the server's
 * `/api/session-runtime` feed without a shape mismatch. Keep CRASH_MS and the
 * derive rule in lockstep with the backend module.
 */

import type { SessionTodo } from '@/types/sessionTodo';

export type Liveness = 'active' | 'idle' | 'crashed';

/**
 * Mirror of the server's `SessionRuntime` (src/services/session-runtime.ts) — the
 * single unified shape for "who is alive and what are they doing". The UI cannot
 * import backend code, so this is a hand-kept structural copy; the
 * `/api/session-runtime` feed serves exactly this shape.
 */
export interface SessionRuntime {
  project: string;
  session: string;
  role: string;
  isSupervisor: boolean;
  status: 'active' | 'waiting' | 'permission' | 'checkpoint_ready';
  updatedAt: number;
  contextPercent: number | null;
  contextUpdatedAt: number | null;
  checkpointReadyAt: number | null;
  claimedTodoId: string | null;
  claimedAt: string | null;
  retryCount: number;
  slotTmux: string | null;
  idleSince: number | null;
  escalated: boolean;
  liveness: Liveness;
}

/** No heartbeat for this long ⇒ treat a working session as crashed. */
export const CRASH_MS = 120_000;
/** Context fraction at/above which we flag the worker as running hot. */
export const CTX_WARN = 80;

export interface LivenessInput {
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
}

/**
 * Derive a session's liveness. A stale session that still holds a todo reads as
 * `crashed` (the dangerous case); a fresh `active` subscription is `active`;
 * everything else is `idle`.
 */
export function deriveLiveness(
  sub: LivenessInput,
  currentTodo: SessionTodo | null,
  now: number,
): Liveness {
  const stale = now - sub.lastUpdate > CRASH_MS;
  if (stale && currentTodo) return 'crashed';
  if (sub.status === 'active') return 'active';
  return 'idle';
}

/**
 * Find the todo a session is currently working: claimed by or assigned to it
 * AND still in progress. A terminal status must never count — completeTodo
 * marks status='done' without clearing claimedBy, so keying off the claim alone
 * would surface a stale-claimed done/dropped todo as the worker's "current" work
 * (phantom animated claim edges in FleetGraph, wrong current todo in the
 * WorkerRoster). Requiring in_progress is the SI-2 belt-and-suspenders guard
 * that agrees with the SI-1 producer invariant.
 */
export function currentTodoFor(session: string, todos: SessionTodo[]): SessionTodo | null {
  return (
    todos.find(
      (t) =>
        (t.claimedBy === session || t.assigneeSession === session) &&
        t.status === 'in_progress',
    ) ?? null
  );
}

/** Whether a session's context gauge is in the hot zone. */
export function isContextHot(contextPercent: number | undefined): boolean {
  return typeof contextPercent === 'number' && contextPercent >= CTX_WARN;
}

/** Orchestrator/role sessions (supervisor, steward, planner) are NOT workers —
 *  they drive the work-graph, they don't execute claimed work todos. Excluded
 *  from the Workers roster and the graph's worker nodes (a supervisor holding an
 *  epic in_progress must not read as a worker building it). By name prefix. */
export function isOrchestratorSession(session: string): boolean {
  const role = session.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return role === 'supervisor' || role === 'steward' || role === 'planner';
}

/** Single-glyph role badge derived from the session-name prefix. */
export function roleGlyph(session: string): string {
  const role = session.split(/[-_]/)[0]?.toLowerCase() ?? '';
  switch (role) {
    case 'frontend':
      return '🖼';
    case 'backend':
      return '⚙';
    case 'design':
      return '◇';
    case 'planner':
      return '🗺';
    case 'supervisor':
      return '🛡';
    default:
      return '⚙';
  }
}
