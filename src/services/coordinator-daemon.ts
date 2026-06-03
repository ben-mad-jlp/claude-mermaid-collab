import type { Todo } from './todo-store';

/** The Coordinator daemon: a non-LLM, per-project loop that claims ready todos and
 *  spawns workers for them, and reclaims expired leases. All I/O is injected (DI) so
 *  the orchestration is unit-testable; the live wiring (real launchAndBind worker
 *  spawn, the tick scheduler, worker-completion + acceptance gate) is Phase 2c. */

export const COORDINATOR_ID = 'coordinator';
/** Claim lease before a worker's todo is reclaimable. 40 min by default — big
 *  multi-component todos (e.g. a UI command-center build) exceed a short lease
 *  and get falsely reclaimed mid-work. Override with MERMAID_CLAIM_LEASE_MIN. */
export const DEFAULT_LEASE_MS =
  (Number(process.env.MERMAID_CLAIM_LEASE_MIN) || 40) * 60 * 1000;

export interface CoordinatorDeps {
  listReadyTodos: (project: string) => Todo[];
  claimTodo: (project: string, id: string, claimedBy: string, leaseMs: number) => Promise<Todo | null>;
  releaseExpiredClaims: (project: string, now?: string) => Promise<{ released: string[]; exhausted: string[] }>;
  completeTodo: (project: string, id: string, acceptance?: 'pending' | 'accepted' | 'rejected') => Promise<{ completed: Todo; promoted: string[] }>;
  launchWorker: (project: string, todo: Todo) => Promise<boolean>;
  /** Escalate a todo that exhausted its retry budget (parked 'blocked'). Optional. */
  escalateExhausted?: (project: string, todoId: string) => Promise<void>;
  /** Reclaim claims whose worker is hard-dead (tmux gone), without waiting for
   *  the lease. Returns reclaimed-to-ready + retry-exhausted (parked blocked) ids. Optional. */
  reapDeadClaims?: (project: string) => Promise<{ reclaimed: string[]; exhausted: string[] }>;
  /** Escalate a todo a worker REJECTED (mechanical gate failed). Optional. */
  escalateRejected?: (project: string, todoId: string) => Promise<void>;
}

export interface TickResult { released: string[]; exhausted: string[]; claimed: string[]; spawned: string[]; }

/** One coordination tick: reclaim expired leases (retry, or park+escalate if the
 *  retry cap is exceeded), then claim each ready todo and spawn a worker. A
 *  failed/false launchWorker leaves the todo in_progress with a lease — a future
 *  tick reclaims + retries it until the cap, then escalates. */
export async function runTick(
  deps: CoordinatorDeps,
  project: string,
  now: string = new Date().toISOString(),
  leaseMs: number = DEFAULT_LEASE_MS,
): Promise<TickResult> {
  const { released, exhausted } = await deps.releaseExpiredClaims(project, now);
  // Hard-crash reap: a dead worker's claim is reclaimed now, not at lease end.
  if (deps.reapDeadClaims) {
    try {
      const dead = await deps.reapDeadClaims(project);
      released.push(...dead.reclaimed);
      exhausted.push(...dead.exhausted);
    } catch { /* reaping must not abort the tick */ }
  }
  for (const id of exhausted) {
    try { await deps.escalateExhausted?.(project, id); } catch { /* escalation must not abort the tick */ }
  }
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
  return { released, exhausted, claimed, spawned };
}

/** Route a worker's completion to the store. ACCEPTED → done + unblock dependents.
 *  REJECTED (mechanical gate failed, SI-3) → NOT done: the todo returns to a
 *  non-terminal 'blocked' state (completedAt cleared) and is escalated as a blocker
 *  for a human to re-open/split/drop. It is NOT auto-retried — completeTodo's
 *  unblock pass skips rejected todos, so a rejected todo stays parked (never
 *  silently re-claims and re-fails) until a human clears the rejection. The caller
 *  (the worker, after its tsc+tests gate) decides accepted/rejected. */
export async function handleWorkerComplete(
  deps: CoordinatorDeps,
  project: string,
  todoId: string,
  acceptance: 'accepted' | 'rejected',
): Promise<{ promoted: string[]; escalated: boolean }> {
  const { promoted } = await deps.completeTodo(project, todoId, acceptance);
  let escalated = false;
  if (acceptance === 'rejected' && deps.escalateRejected) {
    try { await deps.escalateRejected(project, todoId); escalated = true; } catch { /* never block the report */ }
  }
  return { promoted, escalated };
}
