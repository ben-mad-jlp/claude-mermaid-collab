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
/** How long a LEAF may sit in_progress with no live claim before the orphan
 *  reaper reclaims it. Distinct from the 40-min claim lease: the lease only fires
 *  when claimedAt+claimLeaseMs are set, but an orphan's defining trait is that they
 *  are NULL (e.g. wiped by a daemon restart). 15 min by default — long enough to
 *  clear a spawn/handoff gap, short enough that a stuck leaf doesn't sit for hours
 *  (the 19b097a1 ~9h gap). Override with MERMAID_ORPHAN_GRACE_MIN. */
export const DEFAULT_ORPHAN_GRACE_MS =
  (Number(process.env.MERMAID_ORPHAN_GRACE_MIN) || 15) * 60 * 1000;

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

export function planCoordinatorTick(todos: Todo[], now: string): CoordinatorTickPlan {
  const statusById = new Map(todos.map((t) => [t.id, t.status]));
  const acceptById = new Map(todos.map((t) => [t.id, t.acceptanceStatus]));
  const nowMs = new Date(now).getTime();
  const toClaim: string[] = [];
  const toRelease: string[] = [];
  for (const t of todos) {
    if (t.status === 'ready') {
      // Mirror todo-store.depSatisfied: a dep satisfies only when 'done' AND not
      // rejected. A rejected dep (SI-3) never silently satisfies its dependents.
      // An unknown dep id is external → treated as satisfied.
      const depsDone = (t.dependsOn ?? []).every((d) => {
        const s = statusById.get(d);
        if (s === undefined) return true;
        return s === 'done' && acceptById.get(d) !== 'rejected';
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
