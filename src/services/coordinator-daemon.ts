import type { Todo } from './todo-store';
import { resolveCompletion } from '../agent/completion-resolver';

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
  /** Claim-time-only liveness FILTER (readiness-gates P4): narrow the ready set to
   *  todos claimable right now — e.g. drop a probe-gated todo whose operator-env
   *  service is down. MUST NOT mutate status (pure filter, no stored cleared-bit);
   *  a failing probe simply isn't claimed this tick and is re-probed next tick.
   *  Optional — omitted ⇒ no probe filtering. */
  claimGuard?: (project: string, todos: Todo[]) => Promise<Todo[]>;
  claimTodo: (project: string, id: string, claimedBy: string, leaseMs: number) => Promise<Todo | null>;
  releaseExpiredClaims: (project: string, now?: string) => Promise<{ released: string[]; exhausted: string[] }>;
  completeTodo: (project: string, id: string, acceptance?: 'pending' | 'accepted' | 'rejected') => Promise<{ completed: Todo; promoted: string[] }>;
  launchWorker: (project: string, todo: Todo) => Promise<boolean>;
  /** Escalate a todo that exhausted its retry budget (parked 'blocked'). Optional. */
  escalateExhausted?: (project: string, todoId: string) => Promise<void>;
  /** P3 headless circuit-breaker exhaustion sweep: for any leaf paused on a rate cap
   *  past the 2h total-wait ceiling, escalate (blocker) + park BLOCKED and clear it
   *  from the breaker. Called once per tick. Optional. */
  sweepExhaustedHeadless?: (project: string) => Promise<void>;
  /** Reclaim claims whose worker is hard-dead (tmux gone), without waiting for
   *  the lease. Returns reclaimed-to-ready + retry-exhausted (parked blocked) ids. Optional. */
  reapDeadClaims?: (project: string) => Promise<{ reclaimed: string[]; exhausted: string[] }>;
  /** Claim-INDEPENDENT sweep: reclaim a LEAF left in_progress with no live claim
   *  (claimedBy NULL after a daemon restart, or a claim past its lease with a dead
   *  worker) once it's older than the orphan grace. reapDeadClaims keys on a held
   *  claim + tmux liveness and releaseExpiredClaims on a live lease, so a leaf with
   *  claimedBy/claimedAt NULL is invisible to both (the 19b097a1 ~9h gap). Reaped
   *  to 'ready' (retry-budget-aware). Returns reclaimed + retry-exhausted ids.
   *  Survives daemon restarts (ages off persisted updatedAt). Optional. */
  reapOrphanedLeaves?: (project: string) => Promise<{ reclaimed: string[]; exhausted: string[] }>;
  /** Free pool SLOTS whose backing worker tmux is gone, independent of any todo's
   *  status. reapDeadClaims only visits in_progress todos, so a slot orphaned by a
   *  dropped/abandoned todo would otherwise stay wedged 'busy' forever (889e3e26).
   *  Returns the freed session names. Optional. */
  reapDeadPoolSlots?: (project: string) => Promise<string[]>;
  /** Detect ALIVE-but-idle (stalled) workers — a worker sitting at its prompt
   *  awaiting input without filing an escalation — and surface them as escalations
   *  (DOGFOOD #6). Returns the stalled todo ids. Optional. */
  detectStalls?: (project: string) => Promise<string[]>;
  /** Act on the supervisor decision queue (COORD handoff): apply resolved verdicts
   *  (escalate/nudge/resume/wait) and time-out unresolved requests to a fail-safe
   *  escalate, then mark them consumed. Returns the consumed decision ids. The
   *  daemon detects+enqueues in detectStalls and ACTS here — the LLM only judges
   *  in between. Optional. */
  drainDecisions?: (project: string) => Promise<string[]>;
  /** Escalate a todo a worker REJECTED (mechanical gate failed). Optional. */
  escalateRejected?: (project: string, todoId: string) => Promise<void>;
  /** Run the project's DECLARED acceptance gate on a worker-completed todo and
   *  return an AUTHORITATIVE verdict. null = no gate declared → honor the worker's
   *  self-report (backward compat). The COORDINATOR runs this, not the worker; a
   *  failed verdict overrides a worker 'accepted' to 'rejected' so unverified work
   *  never lands — the #6/#7 lesson made enforceable (5374e299). Optional. */
  runGate?: (project: string, todoId: string) => Promise<GateVerdict | null>;
  /** Re-verify a worker's 'accepted' actually produced committable work (PAW P1
   *  ride-along). Returns true (work exists), false (provably none → a hallucinated
   *  completion, downgrade to 'pending'), or null (indeterminate → preserve). Runs
   *  AFTER a green gate inside the completion resolver. Optional. */
  verifyWorkCommitted?: (project: string, todoId: string) => Promise<boolean | null>;
  /** Notify the UI that this project's todos changed (broadcast session_todos_updated)
   *  after a DAEMON-driven transition — reclaim→ready, retry-exhaust→blocked, claim→
   *  in_progress, reap. Without this the only session_todos_updated broadcasts come
   *  from the MCP tool handlers, so a daemon-side block/reclaim leaves the Bridge
   *  showing a stale in-flight card until a manual refresh. Optional. */
  notifyTodosChanged?: (project: string) => void;
}

export interface TickResult { released: string[]; exhausted: string[]; claimed: string[]; spawned: string[]; }

/** Authoritative acceptance-gate verdict (5374e299). `passed` is the only thing
 *  that governs whether a worker's 'accepted' stands; `reasons`/`metrics` are for
 *  the escalation + audit trail. */
export interface GateVerdict {
  passed: boolean;
  reasons: string[];
  metrics?: Record<string, unknown>;
}

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
  // Claim-independent orphan reap: a LEAF stuck in_progress with no live claim
  // (claimedBy NULL after a restart, or a lease-expired dead worker) is invisible
  // to releaseExpiredClaims (no live lease) AND reapDeadClaims (no claimToken) — so
  // sweep it to 'ready' here, retry-budget-aware (the 19b097a1 ~9h gap).
  if (deps.reapOrphanedLeaves) {
    try {
      const orphans = await deps.reapOrphanedLeaves(project);
      released.push(...orphans.reclaimed);
      exhausted.push(...orphans.exhausted);
    } catch { /* orphan reaping must not abort the tick */ }
  }
  // Free pool slots orphaned by dropped/abandoned todos (their worker tmux gone).
  if (deps.reapDeadPoolSlots) {
    try { await deps.reapDeadPoolSlots(project); } catch { /* slot reaping must not abort the tick */ }
  }
  for (const id of exhausted) {
    try { await deps.escalateExhausted?.(project, id); } catch { /* escalation must not abort the tick */ }
  }
  // Idle-at-prompt stall detection (DOGFOOD #6): file escalations for ALIVE-but-
  // stalled workers so a silent stall surfaces instead of sitting until lease-expiry.
  if (deps.detectStalls) {
    try { await deps.detectStalls(project); } catch { /* stall detection must not abort the tick */ }
  }
  // P3: rate-cap exhaustion sweep — park leaves stuck paused past the 2h ceiling.
  if (deps.sweepExhaustedHeadless) {
    try { await deps.sweepExhaustedHeadless(project); } catch { /* sweep must not abort the tick */ }
  }
  if (deps.drainDecisions) {
    try { await deps.drainDecisions(project); } catch { /* decision drain must not abort the tick */ }
  }
  let ready = deps.listReadyTodos(project);
  // Claim-time liveness filter (P4): drop probe-gated todos whose env is down. Pure
  // filter — a failing probe is just not claimed this tick (no status write).
  if (deps.claimGuard) {
    try { ready = await deps.claimGuard(project, ready); } catch { /* probe filter must not abort the tick */ }
  }
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
  // Push the daemon-driven status changes to the UI (reclaim/exhaust/claim) so the
  // Bridge doesn't show a stale in-flight card after a block/reclaim happened
  // entirely server-side (no MCP tool call to ride the existing broadcast).
  if (released.length || exhausted.length || claimed.length) {
    try { deps.notifyTodosChanged?.(project); } catch { /* notify must not abort the tick */ }
  }
  return { released, exhausted, claimed, spawned };
}

/** Route a worker's completion to the store. ACCEPTED → done + unblock dependents.
 *  REJECTED (mechanical gate failed, SI-3) → NOT done: the todo is stored
 *  non-terminal ('planned' + acceptanceStatus='rejected', completedAt cleared) and
 *  escalated as a blocker for a human to re-open/split/drop. It is NOT auto-retried:
 *  claimReason now DERIVES a 'rejected' (non-claimable) reason from the stored
 *  acceptanceStatus (80f85190), so a rejected todo stays parked — never silently
 *  re-claims and re-fails — until a human clears the rejection. (The old hold was
 *  completeTodo's unblock-pass skip, deleted in S4.) The caller (the worker, after
 *  its tsc+tests gate) decides accepted/rejected. */
export async function handleWorkerComplete(
  deps: CoordinatorDeps,
  project: string,
  todoId: string,
  acceptance: 'accepted' | 'rejected',
): Promise<{ promoted: string[]; escalated: boolean; gateOverride?: GateVerdict; effective?: 'accepted' | 'rejected' | 'pending'; pendingReason?: string }> {
  // AUTHORITATIVE RESOLUTION (5374e299 + PAW P1): a worker can only PROPOSE an
  // acceptance. The server-authoritative completion-resolver decides the effective
  // outcome — the declared gate (fail-closed; overrides 'accepted'→'rejected'), then
  // a work-committed re-verify (fail-open; downgrades a gate-green-but-empty
  // 'accepted'→'pending', closing the hallucinated-completion hole). No declared
  // gate / indeterminate re-verify preserves the prior trust-the-worker behavior.
  const { effective, gateOverride, pendingReason } = await resolveCompletion(
    { runGate: deps.runGate, verifyWorkCommitted: deps.verifyWorkCommitted },
    project,
    todoId,
    acceptance,
  );
  const { promoted } = await deps.completeTodo(project, todoId, effective);
  let escalated = false;
  if (effective === 'rejected' && deps.escalateRejected) {
    try { await deps.escalateRejected(project, todoId); escalated = true; } catch { /* never block the report */ }
  }
  return { promoted, escalated, gateOverride, effective, pendingReason };
}
