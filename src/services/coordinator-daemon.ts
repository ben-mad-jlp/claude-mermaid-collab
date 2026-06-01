import type { Todo } from './todo-store';

/** The Coordinator daemon: a non-LLM, per-project loop that claims ready todos and
 *  spawns workers for them, and reclaims expired leases. All I/O is injected (DI) so
 *  the orchestration is unit-testable; the live wiring (real launchAndBind worker
 *  spawn, the tick scheduler, worker-completion + acceptance gate) is Phase 2c. */

export const COORDINATOR_ID = 'coordinator';
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export interface CoordinatorDeps {
  listReadyTodos: (project: string) => Todo[];
  claimTodo: (project: string, id: string, claimedBy: string, leaseMs: number) => Promise<Todo | null>;
  releaseExpiredClaims: (project: string, now?: string) => Promise<string[]>;
  completeTodo: (project: string, id: string, acceptance?: 'pending' | 'accepted' | 'rejected') => Promise<{ completed: Todo; promoted: string[] }>;
  launchWorker: (project: string, todo: Todo) => Promise<boolean>;
}

export interface TickResult { released: string[]; claimed: string[]; spawned: string[]; }

/** One coordination tick: reclaim expired leases, then claim each ready todo and
 *  spawn a worker for it. A failed/false launchWorker leaves the todo in_progress
 *  with a lease — a future tick's releaseExpiredClaims reclaims + retries it. */
export async function runTick(
  deps: CoordinatorDeps,
  project: string,
  now: string = new Date().toISOString(),
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<TickResult> {
  const released = await deps.releaseExpiredClaims(project, now);
  const ready = deps.listReadyTodos(project);
  const claimed: string[] = [];
  const spawned: string[] = [];
  for (const t of ready) {
    try {
      const c = await deps.claimTodo(project, t.id, COORDINATOR_ID, leaseMs);
      if (!c) continue; // lost the race / already claimed
      claimed.push(c.id);
      const ok = await deps.launchWorker(project, c);
      if (ok) spawned.push(c.id);
    } catch {
      // one bad todo must not abort the whole tick; the lease handles recovery
    }
  }
  return { released, claimed, spawned };
}

/** Route a worker's completion to the store (mark done + unblock dependents).
 *  The caller (Phase 2c worker, after its mechanical acceptance gate) decides accepted/rejected. */
export async function handleWorkerComplete(
  deps: CoordinatorDeps,
  project: string,
  todoId: string,
  acceptance: 'accepted' | 'rejected',
): Promise<{ promoted: string[] }> {
  const { promoted } = await deps.completeTodo(project, todoId, acceptance);
  return { promoted };
}
