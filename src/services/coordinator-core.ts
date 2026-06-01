import type { Todo } from './todo-store';

export interface CoordinatorTickPlan {
  toClaim: string[];   // ready todo ids whose deps are all done — claimable now
  toRelease: string[]; // in_progress ids whose lease has expired
}

/**
 * Pure planning step for the Coordinator daemon: given a project's todos + the
 * current time, decide what to claim and what to release. No DB, no side effects —
 * the daemon acts on this via todo-store.claimTodo / releaseExpiredClaims.
 */
export function planCoordinatorTick(todos: Todo[], now: string): CoordinatorTickPlan {
  const statusById = new Map(todos.map((t) => [t.id, t.status]));
  const nowMs = new Date(now).getTime();
  const toClaim: string[] = [];
  const toRelease: string[] = [];
  for (const t of todos) {
    if (t.status === 'ready') {
      const depsDone = (t.dependsOn ?? []).every((d) => {
        const s = statusById.get(d);
        return s === undefined || s === 'done';
      });
      if (depsDone) toClaim.push(t.id);
    } else if (t.status === 'in_progress') {
      if (t.claimedAt != null && t.claimLeaseMs != null &&
          new Date(t.claimedAt).getTime() + t.claimLeaseMs < nowMs) {
        toRelease.push(t.id);
      }
    }
  }
  return { toClaim, toRelease };
}
