/**
 * Pure predicates lifted from collectMissionStatusFacts (mission-store.ts).
 * These functions take pre-built indexes as parameters and have no internal
 * listTodos/listLeafRuns calls.
 */
import { isEpic } from './todo-kind.ts';
import { criterionEdgesOf } from './criterion-edges.ts';
import { isLanded } from './epic-landedness.ts';
import { derivedStatus } from './claimability.ts';
import { isHollowLand } from './todo-store.ts';
import { isZeroBurnGateHold } from './epic-churn.ts';
import { CHILDLESS_SERVE_GRACE_MS } from './harness-caps.ts';
import type { Todo } from './todo-store.ts';
import type { LeafRunSummary } from './ledger-stats.ts';

/**
 * Proof-aware land check: a landed epic must prove a criterion (a delivered
 * descendant leaf carries this criterion's id) OR the epic tags no leaf at all
 * AND every descendant leaf has settled (legacy fallback).
 *
 * Memoized by the caller's proofByEpic map.
 *
 * `undelivered` is an independent negative signal: the set of criterion ids
 * that some tagged descendant leaf failed to deliver (dropped, rejected, or
 * not yet finished). A criterion id may appear in both proven and undelivered
 * if one tagged leaf delivered it and another dropped it.
 */
export function proofForEpic(
  epicId: string,
  childrenByParent: Map<string, Todo[]>,
  memo: Map<string, { proven: Set<string>; tagsAnyLeaf: boolean; hasUnfinishedLeaf: boolean; undelivered: Set<string> }>,
): { proven: Set<string>; tagsAnyLeaf: boolean; hasUnfinishedLeaf: boolean; undelivered: Set<string> } {
  const hit = memo.get(epicId);
  if (hit) return hit;
  const proven = new Set<string>();
  const undelivered = new Set<string>();
  let tagsAnyLeaf = false;
  let hasUnfinishedLeaf = false;
  const walk = (parentId: string) => {
    for (const t of childrenByParent.get(parentId) ?? []) {
      if (!isEpic(t)) {
        const tags = criterionEdgesOf(t);
        if (tags.length > 0) {
          tagsAnyLeaf = true;
          if (t.status === 'done' && t.acceptanceStatus !== 'rejected') tags.forEach((id) => proven.add(id));
          if (t.status === 'dropped' || t.acceptanceStatus === 'rejected' || (t.status !== 'done' && t.acceptanceStatus !== 'accepted')) {
            tags.forEach((id) => undelivered.add(id));
          }
        }
        if (t.status !== 'dropped' && t.status !== 'done' && t.acceptanceStatus !== 'accepted') {
          hasUnfinishedLeaf = true;
        }
      }
      walk(t.id);
    }
  };
  walk(epicId);
  const res = { proven, tagsAnyLeaf, hasUnfinishedLeaf, undelivered };
  memo.set(epicId, res);
  return res;
}

/**
 * Criterion liveness: does this serving epic have actual motion?
 * A filed-but-unapproved epic is NOT live — its criterion stays 'discover'.
 *
 * ledgerUnavailable: treat any open serving epic as live (fail toward LIVE).
 */
export function servingEpicLive(
  e: Todo,
  ledgerUnavailable: boolean,
  runs: readonly Pick<LeafRunSummary, 'epicId' | 'finalOutcome'>[],
  allTodos: readonly Todo[],
  byId: Map<string, Todo>,
  now: number,
): boolean {
  if (ledgerUnavailable) {
    return !isLanded(e);
  }
  return (
    !isLanded(e) && (
      runs.some((r) => r.epicId === e.id && (r.finalOutcome === 'pending' || r.finalOutcome === 'paused')) ||
      allTodos.some((t) => t.parentId === e.id && !isEpic(t) &&
        (derivedStatus(t, byId) === 'ready' || derivedStatus(t, byId) === 'in_progress')) ||
      (!allTodos.some((t) => t.parentId === e.id && !isEpic(t)) && Number.isFinite(Date.parse(e.createdAt)) &&
        now - Date.parse(e.createdAt) < CHILDLESS_SERVE_GRACE_MS)
    )
  );
}

/**
 * Rolled-back replan gap: a discover criterion that has NO serving epic at all.
 * When an epic is dropped (rolled back), it vanishes from the serving set and
 * servingEpicState becomes 'none'. This distinguishes a genuine rolled-back delta
 * from a live-but-inert epic ('open' state).
 *
 * An 'open' serving epic — however inert — is NOT a rolled-back replan and must
 * fall through to the fingerprint debounce. A statically red epic (all leaves base-red-parked)
 * takes the bypass on every tick otherwise, causing unbounded self-excitation
 * (incident 2026-07-23 20:45-21:20: expected 1 node, got 20).
 *
 * The 'none' arm stays bounded by CONDUCTOR_SERVE_RETRY_CAP, which is what prevents
 * the bypass from becoming an unbounded excitation of its own.
 */
export function isRolledBackReplanGap(c: {
  action: string;
  servingEpicState: 'landed' | 'open' | 'none';
  servingEpicLive: boolean;
}): boolean {
  return c.action === 'discover' && c.servingEpicState === 'none' && !c.servingEpicLive;
}

/**
 * FILEABLE SERVE GAP: a `discover` criterion for which a NEW serving epic is genuinely needed,
 * because no serving epic todo is still OPEN (every one of them is done or dropped, or there
 * never was one).
 *
 * This is the SAME line isRolledBackReplanGap draws, widened by exactly one step — and the
 * widening is what the two incidents force:
 *
 *  - 2026-07-23 20:45-21:20 (self-excitation): the serving epic is OPEN and statically red. A
 *    conductor pass against it CORRECTLY files nothing: an open epic is already assigned to this
 *    criterion, so filing a second one is duplicate spend. Nothing is fileable ⇒ the pass must
 *    settle into the fingerprint debounce after ONE node. This is the case that must NOT re-arm;
 *    treating "filed nothing" as suspicious here bought 2 nodes where the incident allows 1.
 *  - 949dda42 (2026-08-14, the empty conduct): the serving epics are CLOSED (`open: false`,
 *    landed in git but not proving the criterion), so the criterion still derives `discover` with
 *    servingEpicState 'open' — the state says "an epic exists", the todo says "and it is dead".
 *    A NEW epic IS needed here, so a pass that files nothing has failed, and must re-arm.
 *
 * servingEpicState alone cannot separate those two: BOTH read 'open' (a done-but-not-proving epic
 * still sits in the serving set). The separating fact is whether any serving epic todo is still
 * open, which is why it is passed in explicitly — this predicate stays pure and store-free like
 * its neighbours.
 *
 * isRolledBackReplanGap ⊆ isFileableServeGap: with no serving epic at all there is no open one.
 * Both re-arm paths stay bounded — the 'none' arm by CONDUCTOR_SERVE_RETRY_CAP, this one by
 * CONDUCTOR_EMPTY_CONDUCT_CAP.
 */
export function isFileableServeGap(
  c: { action: string; servingEpicLive: boolean },
  hasOpenServingEpic: boolean,
): boolean {
  return c.action === 'discover' && !c.servingEpicLive && !hasOpenServingEpic;
}

/**
 * A hollow-landed done epic doesn't burn the serve cap (LS-1).
 */
export function isHollowDone(e: Todo, allTodos: readonly Todo[]): boolean {
  return e.status === 'done' && (
    e.hollowLandedAt != null ||
    isHollowLand(e, allTodos.filter((t) => t.parentId === e.id && !isEpic(t)))
  );
}

/**
 * Serve-cap refund: does this epic count toward the anti-thrash cap?
 * An epic counts iff it made a genuine attempt (has no leaf children, OR has a
 * settled leaf, OR a node actually spent under it).
 */
export function countsTowardServeCap(
  e: Todo,
  allTodos: readonly Todo[],
  capRuns: readonly Pick<LeafRunSummary, 'leafId' | 'epicId' | 'finalOutcome' | 'nodesSpent' | 'attempts' | 'reason'>[],
  ledgerUnavailable: boolean,
): boolean {
  const leaves = allTodos.filter((t) => t.parentId === e.id && !isEpic(t));
  if (leaves.length === 0) return true;
  if (ledgerUnavailable) return true;
  const leafIds = new Set(leaves.map((t) => t.id));
  const attributable = capRuns.filter((r) => r.epicId === e.id || (r.leafId != null && leafIds.has(r.leafId)));
  if (attributable.length > 0 && attributable.every((r) => isZeroBurnGateHold(r))) return false;
  const isGenuineAttempt = (
    r: Pick<LeafRunSummary, 'leafId' | 'epicId' | 'finalOutcome' | 'nodesSpent' | 'attempts'> | undefined,
  ) => r == null || (r.attempts ?? 0) >= 1 || (r.nodesSpent ?? 0) > 0;
  const runsByLeafId = new Map(
    capRuns.filter((r) => r.leafId != null).map((r) => [r.leafId as string, r]),
  );
  if (leaves.some((t) =>
    (t.acceptanceStatus === 'accepted' || t.acceptanceStatus === 'rejected') &&
    isGenuineAttempt(runsByLeafId.get(t.id)),
  )) return true;
  return capRuns.some((r) => r.epicId === e.id && (
    r.finalOutcome === 'accepted' || r.finalOutcome === 'rejected'
  ) && isGenuineAttempt(r));
}

/**
 * Fail-closed freshness check: has the serving epic landed a DIFFERENT, NEWER commit
 * than the one the last verdict was measured against? Sha strings aren't orderable, so
 * the land RECORD timestamp is the ordering signal and sha inequality is the
 * 'different commit' signal. Any missing input ⇒ false (today's behaviour).
 */
export function servingLandIsNewerThanVerdict(c: {
  verifiedAt: number | null;
  verifiedAtSha?: string | null;
  servingEpicLandSha?: string | null;
  servingEpicLandedAt?: number | null;
}): boolean {
  return (
    c.verifiedAt != null &&
    c.verifiedAtSha != null &&
    c.servingEpicLandSha != null &&
    c.servingEpicLandSha !== c.verifiedAtSha &&
    c.servingEpicLandedAt != null &&
    c.servingEpicLandedAt > c.verifiedAt
  );
}

/**
 * Fail-closed: the serving epic's descendant leaves all settled (no unfinished leaf) at a
 * time NEWER than the last recorded verdict, even though the epic itself hasn't landed.
 * Landing is a separate concern (forward-integrate/land cadence) from whether the WORK is
 * done — a criterion whose serving work is complete still owes a fresh verdict, not another
 * escalate/discover thrash cycle. Any missing input ⇒ false.
 */
export function servingWorkCompletedAfterVerdict(c: {
  met: boolean;
  verifiedAt: number | null;
  servingWorkCompletedAt?: number | null;
}): boolean {
  return (
    !c.met &&
    c.verifiedAt != null &&
    c.servingWorkCompletedAt != null &&
    c.servingWorkCompletedAt > c.verifiedAt
  );
}

/**
 * Fail-closed: a NOT-met criterion has a pending recheck enqueued (its evidence was touched
 * by a land or direct commit, and the recheck gate is watching for the work to complete).
 * A pending recheck means the criterion is being actively re-evaluated, not idle in escalate.
 * Any missing input ⇒ false.
 */
export function recheckPendingAfterVerdict(c: {
  met: boolean;
  recheckPendingAt?: number | null;
}): boolean {
  return !c.met && c.recheckPendingAt != null;
}

/**
 * Fail-safe: implementation shipped, awaiting a live-observation window.
 * Null or expired measurementPendingUntil returns false (serve-inert, but falls through to discover).
 */
export function awaitingObservation(c: { measurementPendingUntil?: number | null }, now: number): boolean {
  return c.measurementPendingUntil != null && c.measurementPendingUntil > now;
}
