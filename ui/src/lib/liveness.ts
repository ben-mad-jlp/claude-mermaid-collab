/**
 * Shared worker-liveness derivation (Bridge redesign BR-2, design §2/§8).
 *
 * Extracted from WorkerPool's rows-memo so the WorkerRoster and future
 * FleetGraph nodes derive a session's state identically — one source of truth
 * for "is this worker active / idle / crashed", computed INLINE from
 * subscription freshness (no server round-trip, no supervisorLiveness helper).
 */

import type { SessionTodo } from '@/types/sessionTodo';

export type Liveness = 'active' | 'idle' | 'crashed';

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
