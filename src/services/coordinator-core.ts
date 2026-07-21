import type { Todo } from './todo-store';
import { isClaimable } from './claimability';
import { DEFAULT_ORPHAN_GRACE_MS, DEFAULT_PULSE_STALE_MS } from './harness-caps';

export interface CoordinatorTickPlan {
  toClaim: string[];   // ready todo ids whose deps are all done — claimable now
  toRelease: string[]; // in_progress ids whose lease has expired
}

/**
 * Pure planning step for the Coordinator daemon: given a project's todos + the
 * current time, decide what to claim and what to release. No DB, no side effects —
 * the daemon acts on this via todo-store.claimTodo / releaseExpiredClaims.
 */
// DEFAULT_ORPHAN_GRACE_MS moved to harness-caps.ts (the harness's single
// worker-liveness threshold surface); imported above and re-exported here so
// existing importers (coordinator-live.ts) keep working unchanged.
export { DEFAULT_ORPHAN_GRACE_MS };

export interface OrphanReapCandidate {
  id: string;
  /** Pool lane (for the tmux probe / slot free), or null when never spawned. */
  sessionName: string | null;
  /** Case B (a claim PAST its lease): the caller MUST confirm the worker's tmux is
   *  actually gone before reaping. Case A (claimedBy NULL) has no live claim by
   *  definition, so it is reaped outright (needsTmuxProbe=false). */
  needsTmuxProbe: boolean;
}

/**
 * Pure: which LEAF in_progress todos look orphaned by CLAIM + AGE alone — the
 * claim-independent sweep that catches a leaf left in_progress with no live claim
 * (claimedBy NULL after a daemon restart, OR a claim past its lease). This is the
 * gap reapDeadClaims/releaseExpiredClaims miss: the former reclaims only a todo
 * holding a claimToken, the latter only one with a live lease — an in_progress
 * leaf with claimedBy/claimedAt NULL has neither, so nothing ages it out.
 *
 * Age is measured off the PERSISTED `updatedAt` (survives daemon restarts — no
 * in-memory timer). Epics (parentId NULL) are containers and are NEVER reaped.
 * A candidate with needsTmuxProbe must be confirmed tmux-dead by the caller (the
 * tmux probe is injected there so this stays pure + clock-injectable).
 */
export function planOrphanReap(todos: Todo[], now: string, graceMs: number): OrphanReapCandidate[] {
  const nowMs = new Date(now).getTime();
  const out: OrphanReapCandidate[] = [];
  for (const t of todos) {
    if (t.status !== 'in_progress') continue;
    if (t.assigneeKind === 'human') continue; // human-owned (e.g. a [SESSION] note) — the daemon never reaps/works it
    if (t.parentId == null) continue; // epics are containers — never reaped
    if (nowMs - new Date(t.updatedAt).getTime() <= graceMs) continue; // within grace
    if (t.claimedBy == null) {
      // Case A: no claim at all → orphaned, reap outright (no worker to probe).
      out.push({ id: t.id, sessionName: t.sessionName, needsTmuxProbe: false });
    } else if (
      t.claimedAt != null && t.claimLeaseMs != null &&
      new Date(t.claimedAt).getTime() + t.claimLeaseMs < nowMs
    ) {
      // Case B: a claim past its lease → reap only if its worker tmux is gone.
      out.push({ id: t.id, sessionName: t.sessionName, needsTmuxProbe: true });
    }
  }
  return out;
}

/**
 * Heal-on-restart selector: ids of in_progress leaves whose claim was minted by a
 * daemon epoch OTHER than the live one. Such a claim's in-process executor died
 * with that prior daemon, so it is reclaimable ON SIGHT — no liveness probe (a
 * lingering reusable tmux shell must not shield it, the gap that stranded leaves
 * across a sidecar hot-swap). Claims with NO epoch (legacy / pre-this-feature)
 * are excluded here — left to the pulse/grace probes, so this is never worse than
 * before. Pure; the daemon feeds it `listTodos(status:'in_progress')`.
 */
export function planPriorEpochReap(todos: Todo[], liveEpoch: string): string[] {
  const out: string[] = [];
  for (const t of todos) {
    if (t.status !== 'in_progress') continue;
    if (t.assigneeKind === 'human') continue; // human-owned — never reclaimed
    if (t.parentId == null) continue;          // epics are containers — never reaped
    const ep = t.claim?.epoch;
    if (!ep || ep === liveEpoch) continue;     // no epoch (legacy) or ours (live) → skip
    out.push(t.id);
  }
  return out;
}

// DEFAULT_PULSE_STALE_MS moved to harness-caps.ts (the harness's single
// worker-liveness threshold surface); imported above and re-exported here so
// existing importers (coordinator-live.ts) keep working unchanged.
export { DEFAULT_PULSE_STALE_MS };

/**
 * Pure two-fact pulse-staleness reclaim (Phase 1 of design-session-daemon-comms,
 * decision 9cd01858). A lane is reclaimable in SECONDS only when BOTH facts agree:
 * its durable session_status pulse is STALE (older than staleMs) AND its worker is
 * CONFIRMED not-alive (tmux gone, or an alive tmux whose pane subtree has no
 * `claude` process). Requiring both prevents a false-reap on a momentary pulse gap
 * while a live process is mid-task.
 *
 * STRICTLY ADDITIVE: a lane with NO durable pulse yet (pulseAt null) returns false
 * here, so it falls through to the existing planOrphanReap age/lease grace — this
 * fast path can only reclaim a dead lane SOONER, never reclaim a lane the old path
 * would have left alone, and never make a NULL-pulse lane worse than today.
 */
export function shouldPulseReap(
  pulseAt: number | null,
  nowMs: number,
  staleMs: number,
  confirmedDead: boolean,
): boolean {
  if (pulseAt == null) return false;            // no durable signal → fall back to grace
  if (nowMs - pulseAt <= staleMs) return false; // pulse fresh → worker alive, keep
  return confirmedDead;                          // staleness AND not-alive → reclaim
}

export function planCoordinatorTick(todos: Todo[], now: string): CoordinatorTickPlan {
  const byId = new Map(todos.map((t) => [t.id, t]));
  const nowMs = new Date(now).getTime();
  const toClaim: string[] = [];
  const toRelease: string[] = [];
  // Container claim-guard (worker-decomposition P3): a todo that is the PARENT of a
  // not-yet-terminal child is a CONTAINER (epic / split parent), NOT claimable work —
  // claiming it would spawn a worker on an epic. It completes via the auto-complete
  // cascade (sweepEpicRollups) when its last child settles, never via a worker.
  const openChildParents = new Set<string>();
  for (const t of todos) {
    if (t.parentId && t.status !== 'done' && t.status !== 'dropped') openChildParents.add(t.parentId);
  }
  for (const t of todos) {
    // De-conflate (b2c858d4): claimability via the SINGLE predicate — isClaimable covers
    // approved + unblocked + agent + deps-satisfied (incl. the rejected-dep rule and the
    // unknown-dep-is-not-satisfied rule). The container guard is the only EXTRA daemon-launch
    // constraint layered on top.
    if (isClaimable(t, byId) && !openChildParents.has(t.id)) {
      toClaim.push(t.id);
    } else if (t.claim != null) {
      // in-flight ≡ claim != null → release once the lease has elapsed.
      if (new Date(t.claim.at).getTime() + t.claim.leaseMs < nowMs) toRelease.push(t.id);
    }
  }
  return { toClaim, toRelease };
}
