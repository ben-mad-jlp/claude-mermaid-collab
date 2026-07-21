import type { Todo } from './todo-store';
import { planOrphanReap, planPriorEpochReap, shouldPulseReap } from './coordinator-core';

/** One `ps` snapshot's shape (pid → { ppid-children, comm }), as produced by
 *  coordinator-live's procSnapshot(). Re-declared here (not imported) to keep this
 *  module import-cycle-free from coordinator-live. */
export type ProcSnapshot = Map<number, { children: number[]; comm: string }>;

export interface WorkerReapResult {
  reclaimed: string[];
  exhausted: string[];
}

/**
 * Everything the unified dead-worker sweep closes over. Mirrors the DI style of
 * makeLeafExecutorDeps: coordinator-live's makeCoordinatorDeps builds this object
 * from the SAME functions/closures it uses today (the live wiring) and exposes it
 * as the single `reapDeadWorkers` dep; tests can pass a fake deps object directly.
 */
export interface WorkerLivenessDeps {
  listTodos: (project: string, opts?: { status?: 'in_progress'; includeCompleted?: boolean }) => Todo[];
  getTodo: (project: string, id: string) => Todo | null | undefined;
  reclaimClaim: (project: string, id: string, hadProgress?: (id: string) => boolean) => Promise<'ready' | 'blocked' | null>;
  reclaimOrphan: (project: string, id: string, hadProgress?: (id: string) => boolean) => Promise<'ready' | 'blocked' | null>;
  /** Progress reader for 0-node kill detection (per-project closure, matches the
   *  `leafHadProgress` local in makeCoordinatorDeps). */
  leafHadProgress: (project: string) => (id: string) => boolean;
  /** E4: whole-run liveness (incl. between nodes), THIS process only. */
  isRunLive: (todoId: string) => boolean;
  /** A LIVE current-epoch node (e.g. a long blueprint) — bug 0f1df3d2. */
  isLeafInflightLive: (todoId: string) => boolean;
  /** §6.7: grok-own/anthropic-core harnesses run in-process — no tmux to probe. */
  inProcessLaneAlive: (session: string) => Promise<boolean>;
  /** Durable per-lane pulse (session_status.updatedAt), or null if never recorded. */
  lanePulseAt: (project: string, session: string | null) => number | null;
  markIdle: (project: string, sessionName: string) => void;
  recordSupervisorAudit: (entry: { kind: string; project: string; session: string; detail: string }) => void;
  clearLeafInflight: (leafId: string) => void;
  reapStaleInflight: () => number | void;
  reapSameEpochOrphanInflight: (isLive: (leafId: string) => boolean) => number | void;
  listLeafInflight: () => Array<{ project: string }>;
  reconcileInflight: (live: { global: number; perProject: Record<string, number> }) => {
    corrected: boolean;
    before: unknown;
    after: unknown;
  };
  listTrackedLeaves: () => Array<{ leafId: string; project: string }>;
  killLeafSubtree: (leafId: string) => boolean;
  leafAbortReason: (project: string, leafId: string, launchToken: string | null) => string | null;
  reapOrphanedLeafWorktrees: (project: string) => unknown;
  tickGcLeafWorktrees: (project: string) => unknown;
  isHeadlessLeaf: (todo: Todo, childrenIndex: Map<string, Todo[]>) => boolean;
  buildChildrenIndex: (todos: Todo[]) => Map<string, Todo[]>;
  /** This daemon process's epoch (COORDINATOR_EPOCH) — used by the prior-epoch rule. */
  coordinatorEpoch: string;
  /** DEFAULT_PULSE_STALE_MS (or its override) — the pulse rule's staleness threshold. */
  pulseStaleMs: number;
  /** DEFAULT_ORPHAN_GRACE_MS (or its override) — the grace rule's age threshold. */
  orphanGraceMs: number;
}

/**
 * Shared liveness shield chain (duplicated identically across the dead-claims,
 * pulse, and grace rules before this unification): a leaf is shielded from a
 * liveness-based reap when EITHER its whole run is live (E4, incl. between nodes —
 * mirrors reapDeadClaims:2830), OR its current node is live (bug 0f1df3d2: an
 * in-process node-invoker subprocess that inProcessLaneAlive can't see), OR it's a
 * live in-process lane (no tmux to probe, §6.7 bootstrap). Order matters (cheapest/
 * most-authoritative first) and is preserved exactly. Returns the shield name that
 * fired, or null (not shielded — the caller proceeds to its own tmux/dead-check).
 */
async function leafShieldedFromReap(
  todoId: string,
  sessionName: string | null | undefined,
  deps: Pick<WorkerLivenessDeps, 'isRunLive' | 'isLeafInflightLive' | 'inProcessLaneAlive'>,
): Promise<'run-live' | 'inflight-live' | 'in-process-live' | null> {
  if (deps.isRunLive(todoId)) return 'run-live'; // run-level-live between nodes — never reclaim (mirrors reapDeadClaims:2830)
  if (deps.isLeafInflightLive(todoId)) return 'inflight-live'; // bug 0f1df3d2: a live current-epoch node (e.g. a long blueprint) is NOT an orphan — inProcessLaneAlive is blind to the node-invoker `claude -p` subprocess, so the leaf_inflight row is the authoritative signal
  if (sessionName && (await deps.inProcessLaneAlive(sessionName))) return 'in-process-live'; // live in-process lane — no tmux to probe (§6.7)
  return null;
}

/**
 * The unified dead-worker sweep (replaces the formerly-separate reapDeadClaims +
 * reapOrphanedLeaves deps). Runs, over ONE shared evidence set (one in_progress
 * snapshot, one childrenIndex, one ps snapshot, one dedup Set), TODAY'S EXACT
 * GLOBAL ORDER:
 *   (a) dead-claims  — tmux-lane reaper; EXCLUDES headless leaves (durable coverage
 *       lives in c/d/e instead of this non-durable liveness-bit path).
 *   (b) side sweeps  — stale/same-epoch inflight reaps, the inflight-limiter
 *       reconcile, the E1 stop-leaf loop, and the worktree GC throttles — exactly
 *       as they sat at the top of reapOrphanedLeaves.
 *   (c) prior-epoch  — heal-on-restart; deliberately NO liveness shields (an
 *       in-process executor cannot outlive its daemon).
 *   (d) pulse        — durable two-fact staleness reclaim (seconds, not the
 *       15-min/~9h grace).
 *   (e) grace        — the original claim+age fallback, catching anything the
 *       faster rules didn't (incl. every NULL-pulse lane).
 * A todo reclaimed by an earlier rule is added to one shared `reaped` Set so a
 * later rule skips it outright, rather than relying on reclaimOrphan/reclaimClaim's
 * own race guard (null return) to no-op on a stale row.
 */
export async function reapDeadWorkers(project: string, deps: WorkerLivenessDeps): Promise<WorkerReapResult> {
  const reclaimed: string[] = [];
  const exhausted: string[] = [];
  const hadProgress = deps.leafHadProgress(project);
  const reaped = new Set<string>();
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);

  // ============================================================================
  // (a) DEAD-CLAIMS RULE (former reapDeadClaims) — tmux-lane liveness reaper.
  // Only in_progress todos can have a dead worker. A WARM IDLE pool session is
  // never reaped here: its todo is already `done` (not in_progress) so it isn't
  // iterated, and even if an in_progress todo points at it, its tmux is alive →
  // we `continue`. We only reclaim a todo whose lease backstop applies AND whose
  // session/tmux is actually gone (hard-dead worker), then free its pool slot so
  // the slot isn't wedged busy on a vanished session.
  // ONE full-table snapshot for this whole sweep — isHeadlessLeaf below used to call
  // listTodos(includeCompleted:true) itself on EVERY iteration of this in_progress
  // loop (O(n) full-table reads per sweep). Children of an in_progress todo need not
  // themselves be in_progress, so this must be its own includeCompleted:true query,
  // not the in_progress-only list being iterated.
  const reapChildrenIndex = deps.buildChildrenIndex(deps.listTodos(project, { includeCompleted: true }));
  const inProgress = deps.listTodos(project, { status: 'in_progress' });
  for (const t of inProgress) {
    if (t.assigneeKind === 'human') continue; // human-owned (e.g. a [SESSION] note) — never reclaim
    // DUP-DISPATCH FIX (claim-lost churn root, audit c11df7d3): a headless leaf-exec
    // lane has NO tmux — so THIS reaper's death signal (tmux/harness absence at the
    // probes below) is meaningless for it, and its ONLY shield here is isRunLive, an
    // in-memory Set wiped on every restart/hot-swap. A leaf that was in_progress across
    // a restart (or a soft reload) therefore reads as a "dead claim", gets its claim
    // re-minted (audit-SILENTLY — this loop records nothing), and the claim loop launches
    // a DUPLICATE run → the still-live run's launchToken mismatches → claim-lost → repeat
    // to retry-exhausted/held. Headless-leaf reclamation is covered durably elsewhere,
    // each with a real staleness/epoch test rather than a volatile liveness bit:
    // prior-epoch reap (restart), pulse-reap (stale pulse), grace-fallback (null/aged
    // pulse), and the lease. So exclude headless leaves from this non-durable path.
    if (deps.isHeadlessLeaf(t, reapChildrenIndex)) continue;
    // Identity is the persisted pool lane. No sessionName → the todo was never
    // spawned under a lane (or its persist raced); treat as dead and reclaim,
    // rather than fabricating a `worker-<id8>` name that points at no real tmux.
    const session = t.sessionName;
    // HARDENING (audit aadd927b/dup-dispatch root): a headless leaf-exec lane has NO
    // tmux and NO registered in-process harness, and BETWEEN nodes its per-node
    // leaf_inflight row is gone — so a genuinely-running leaf caught between nodes read
    // as a "dead worker" here, got its claim reclaimed, and the claim loop launched a
    // DUPLICATE run (same worktree+row) → false-block + retryCount inflation. The
    // run-level liveness set (E4) is true for the whole run incl. between-nodes; the
    // inflight row covers an active node. Either ⇒ a live current-epoch run, never reap.
    // In-process lanes have no tmux — ask the harness before the tmux probe, or a
    // healthy in-process worker reads as dead (§6.7 bootstrap).
    if (await leafShieldedFromReap(t.id, session, deps)) continue;
    const next = await deps.reclaimClaim(project, t.id, hadProgress);
    // The session is gone — release the pool slot it held (no-op if it wasn't a pool session).
    // The slot lives in the project the worker's lane ran in (target for cross-project).
    if (session) deps.markIdle(t.targetProject ?? project, session);
    reaped.add(t.id); // dedup: later rules must not reprocess a row this rule already touched
    if (next === 'ready') reclaimed.push(t.id);
    else if (next === 'blocked') exhausted.push(t.id);
    // Invariant 2: every reclaim decision logs a reason. This loop was audit-silent
    // (see :2503) → the re-mint was invisible in the trace. Record one line per decision.
    deps.recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: 'coordinator',
      detail: JSON.stringify({ todoId: t.id, reap: 'reapDeadClaims', priorClaimant: session ?? null, decision: next }),
    });
  }

  // ============================================================================
  // (b) SIDE SWEEPS — exactly as they sat at the top of reapOrphanedLeaves.
  // CLAIM-INDEPENDENT sweep (gap 2026-06-09, real instance 19b097a1): a LEAF left
  // status=in_progress with claimedBy/claimedAt NULL is invisible to BOTH existing
  // reapers — releaseExpiredClaims needs a live lease, reapDeadClaims needs a
  // claimToken — so it never ages out (sat ~9h across 3 deploys). The in-memory
  // deadTracker only holds workers THIS process spawned, wiped on every restart;
  // this sweep instead ages off the PERSISTED updatedAt, so it survives restarts.

  // Reap stranded leaf_inflight telemetry rows left by a now-dead daemon (a
  // sidecar restart killed the in-process executor before its finally cleared
  // the row) so daemon_status stops showing phantom running leaves. Global +
  // idempotent; cheap to run each tick (epic 8e7386e4).
  deps.reapStaleInflight();
  // E4: also drop SAME-epoch phantom rows whose run already ended without clearing
  // them (aborted/errored). isRunLive (run-level liveness) keeps a genuinely-running
  // leaf's row even between its nodes, where the per-node subprocess registry is empty.
  deps.reapSameEpochOrphanInflight(deps.isRunLive);

  // capacity-fixes FIX 1: snap the inflight-limiter's in-process counters
  // (globalActive/perProject) to observed truth. By this point BOTH reaps above have
  // run, so every remaining leaf_inflight row is guaranteed current-epoch AND
  // run-live — a durable, restart-surviving signal (preferred here over the in-memory
  // leaf-subprocess-registry alone, which resets exactly like the counters being
  // reconciled). This is global, not project-scoped (leaf_inflight spans every
  // project), so it's harmless to recompute on every project's tick — idempotent,
  // same cost class as the two reaps it rides alongside.
  const liveInflight = deps.listLeafInflight();
  const perProjectLive: Record<string, number> = {};
  for (const row of liveInflight) perProjectLive[row.project] = (perProjectLive[row.project] ?? 0) + 1;
  const inflightRecon = deps.reconcileInflight({ global: liveInflight.length, perProject: perProjectLive });
  if (inflightRecon.corrected) {
    deps.recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: '',
      detail: JSON.stringify({ source: 'inflight-limiter-reconcile', before: inflightRecon.before, after: inflightRecon.after }),
    });
  }

  // E1 (epic e5acda93): stop a leaf whose todo was DROPPED or HELD while a node is
  // live — kill its subprocess group within a tick. (level→off kills immediately via
  // the orchestrator_off hook; this catches drop/hold, which have no single MCP
  // chokepoint.) The registry only holds leaves with a LIVE node, so this is a tiny
  // set. The aborted run's late completion is a no-op via E2's ownership-CAS.
  for (const tracked of deps.listTrackedLeaves()) {
    if (tracked.project !== project) continue;
    const todo = deps.getTodo(project, tracked.leafId);
    // No launch token here (E1 has no dispatch context) — gone/dropped/held cover the
    // ancestor-drop cascade. A tracked, still-`in_progress` leaf whose claim vanished
    // (claimedBy null) is a claim RELEASE mid-run — the exact 22:09 CDT observation
    // (row not dropped/held, so the plain leafAbortReason check misses it) — so stop it
    // too, one tick after the release.
    const reason =
      deps.leafAbortReason(project, tracked.leafId, null) ??
      (todo && todo.status === 'in_progress' && todo.claimedBy == null ? 'claim-lost' : null);
    if (reason && deps.killLeafSubtree(tracked.leafId)) {
      deps.recordSupervisorAudit({
        kind: 'reconcile',
        project,
        session: todo?.sessionName ?? '',
        detail: JSON.stringify({ source: 'e1-stop-leaf', todoId: tracked.leafId, reason }),
      });
    }
  }

  // Safety-net: reap leaf-exec-* worktrees whose todo is terminal but worktree
  // survived (epoch-death case — process killed before finishWith ran). Throttled
  // to once per 5 min to avoid per-tick fs + git overhead.
  void deps.reapOrphanedLeafWorktrees(project);
  // Directory-driven GC (its own coarser throttle): drains orphans whose JSON record
  // was already deleted (invisible to the record-driven reap above).
  void deps.tickGcLeafWorktrees(project);

  // ============================================================================
  // (c) PRIOR-EPOCH FAST PATH (heal-on-restart): a claim stamped with a daemon
  // epoch other than THIS process's was minted by a now-dead daemon. The
  // leaf-executor runs in-process, so it cannot have outlived that process —
  // reclaim on sight, NO liveness probe (a lingering reusable tmux shell must
  // not shield it; that gap stranded leaves across a sidecar hot-swap until
  // lease expiry). Claims with no epoch (legacy/pre-this-feature) are left to
  // the pulse/grace probes below — never worse than today.
  for (const id of planPriorEpochReap(inProgress, deps.coordinatorEpoch)) {
    if (reaped.has(id)) continue; // rule (a) already reclaimed this row this sweep
    const t = inProgress.find((x) => x.id === id)!;
    const next = await deps.reclaimOrphan(project, id, hadProgress);
    if (next == null) continue; // raced to terminal
    deps.clearLeafInflight(id); // drop the dead executor's inflight row
    if (t.sessionName) deps.markIdle(t.targetProject ?? project, t.sessionName); // free pool slot
    reaped.add(id);
    if (next === 'ready') reclaimed.push(id);
    else exhausted.push(id);
    deps.recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: t.sessionName ?? '',
      detail: JSON.stringify({ source: 'prior-epoch-reap', todoId: id, outcome: next, claimEpoch: t.claim?.epoch, liveEpoch: deps.coordinatorEpoch }),
    });
  }

  // ============================================================================
  // (d) FAST PATH (Phase 1, decision 9cd01858): derive staleness from the DURABLE
  // session_status pulse instead of the 15-min/​~9h todo-updatedAt grace. A leaf
  // whose lane last pulsed > PULSE_STALE_MS ago is reclaimed in SECONDS. Strictly
  // additive: a lane with NO durable pulse is skipped here (shouldPulseReap →
  // false) and falls through to the grace sweep below, so it can NEVER be worse
  // than today.
  for (const t of inProgress) {
    if (reaped.has(t.id)) continue; // already reclaimed by an earlier rule this sweep
    if (t.assigneeKind === 'human') continue; // human-owned (e.g. a [SESSION] note) — never reclaim
    if (t.parentId == null) continue; // epics are containers — never reaped
    const session = t.sessionName;
    if (!session) continue; // never-spawned leaf → grace sweep handles it
    const pulseAt = deps.lanePulseAt(project, session);
    if (pulseAt == null || nowMs - pulseAt <= deps.pulseStaleMs) continue; // fresh/absent → fall back
    if (await leafShieldedFromReap(t.id, session, deps)) continue;
    if (!shouldPulseReap(pulseAt, nowMs, deps.pulseStaleMs, true)) continue;
    const next = await deps.reclaimOrphan(project, t.id, hadProgress);
    if (next == null) continue; // raced to a terminal state
    deps.markIdle(t.targetProject ?? project, session); // free any pool slot it held
    reaped.add(t.id);
    if (next === 'ready') reclaimed.push(t.id);
    else exhausted.push(t.id);
    deps.recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session,
      detail: JSON.stringify({ source: 'pulse-reap', todoId: t.id, outcome: next, stalePulseMs: nowMs - pulseAt }),
    });
  }

  // ============================================================================
  // (e) FALLBACK (never-worse): the existing claim+age grace sweep for every leaf
  // the faster rules did not already reap (incl. all NULL-pulse / fresh-pulse lanes).
  const candidates = planOrphanReap(inProgress, now, deps.orphanGraceMs);
  for (const c of candidates) {
    if (reaped.has(c.id)) continue; // already reclaimed (dead-claims, prior-epoch, or pulse)
    // bug 0f1df3d2: a live current-epoch leaf_inflight row means a node is running
    // RIGHT NOW (e.g. a >lease blueprint) — never reap it via the age/lease grace
    // path. Authoritative for headless leaves, which inProcessLaneAlive can't see.
    if (await leafShieldedFromReap(c.id, c.sessionName, deps)) continue;
    // reclaimOrphan (NOT reclaimClaim) reclaims regardless of claimToken — an
    // orphan's whole problem is the missing token. Retry-budget-aware: → ready,
    // or blocked once the retry cap is exceeded.
    const next = await deps.reclaimOrphan(project, c.id, hadProgress);
    if (next == null) continue; // raced to a terminal state — nothing to reap
    if (c.sessionName) {
      // The slot lives in the project the worker's lane ran in (target for cross-project).
      const cProject = inProgress.find((t) => t.id === c.id)?.targetProject ?? project;
      deps.markIdle(cProject, c.sessionName); // free any pool slot it held
    }
    reaped.add(c.id);
    if (next === 'ready') reclaimed.push(c.id);
    else exhausted.push(c.id);
    deps.recordSupervisorAudit({
      kind: 'reconcile',
      project,
      session: c.sessionName ?? 'orphan-reap',
      detail: JSON.stringify({ source: 'orphan-reap', todoId: c.id, outcome: next, hadClaim: c.needsTmuxProbe }),
    });
  }

  return { reclaimed, exhausted };
}
