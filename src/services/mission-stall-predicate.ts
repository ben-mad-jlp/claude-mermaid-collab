/**
 * mission-stall-predicate.ts — Pure stall conjunction + condition-key hash + stableForTicks tracker.
 *
 * Zero imports beyond node:crypto. Exports the stall eligibility check (evaluateMissionStall),
 * the order-independent condition-key hash (missionStallConditionKey, reusing the hashTuple
 * pattern from supervisor-store.ts), and a module-level tracker for stableForTicks counts
 * (noteStallObservation / clearStallObservation).
 *
 * Pure w.r.t. time and DB: no Date.now(), no store, no side effects beyond the module-level
 * observation map. This whole module unit-tests directly.
 */

import { createHash } from 'node:crypto';

/**
 * Facts needed to evaluate the stall conjunction. Gathered from derived mission status,
 * in-flight counters, budget state, and the escalation store; produced by the caller,
 * never injected into this pure module. The conjunction is all-or-nothing.
 */
export interface MissionStallFacts {
  missionActive: boolean;
  unmetCriteria: number;
  serveableGaps: number;
  awaitingVerify: number;
  verifyInFlight: number;
  epicsBuilding: number;
  leavesRunning: number;
  landInFlight: number;
  integrating: number;
  recycling: number;
  budgetPaused: boolean;
  baseRedCooldown: boolean;
  blockedCriterionIds: string[];
  hasOpenCardForKey: boolean;
  /** Optional: when present, enables the new stuck arm. When absent, the legacy conjunction
   *  remains unchanged and byte-identical. Union of escalate-action ids, discover-stuck ids,
   *  and verify-owed ids, computed by the caller. */
  stuckCriterionIds?: string[];
  /** Optional: the verify-owed subset of stuckCriterionIds, carried so the raise site can
   *  rebuild the same conditionKey the facts builder used. */
  verifyOwedCriterionIds?: string[];
}

/**
 * In-flight counter keys, in the order they appear in MissionStallFacts.
 * Used by the conjunction so a test can flip each key independently
 * without editing the stall logic itself.
 */
export const IN_FLIGHT_COUNTER_KEYS: (keyof MissionStallFacts)[] = [
  'serveableGaps',
  'awaitingVerify',
  'verifyInFlight',
  'epicsBuilding',
  'leavesRunning',
  'landInFlight',
  'integrating',
  'recycling',
];

/**
 * The five counters that still veto a raise in the stuck arm (when stuckCriterionIds
 * is present). Excludes serveableGaps, awaitingVerify, and verifyInFlight because a
 * verify owed on a landed epic IS awaiting-verify: counting it would veto the card
 * we need to raise.
 */
export const STUCK_BLOCKING_COUNTER_KEYS: (keyof MissionStallFacts)[] = [
  'epicsBuilding',
  'leavesRunning',
  'landInFlight',
  'integrating',
  'recycling',
];

/**
 * Criterion facts needed to evaluate verify-owed. Narrow input type, keeps the
 * predicate module free of a mission-store import.
 */
export interface VerifyOwedCriterion {
  id: string;
  action: string;
  servingEpicState: 'landed' | 'open' | 'none';
  servingEpicLandedAt?: number | null;
  servingWorkCompletedAt?: number | null;
}

/**
 * Pure predicate: true iff the criterion has a verify-owed action on a landed serving
 * epic, and the landed/completed time is at least thresholdMs in the past.
 * Both timestamps null/undefined ⇒ false (fail closed: unmeasurable age must not card).
 */
export function isVerifyOwedPastThreshold(
  c: VerifyOwedCriterion,
  now: number,
  thresholdMs: number,
): boolean {
  if (c.action !== 'verify') return false;
  if (c.servingEpicState !== 'landed') return false;

  const timestamp = c.servingEpicLandedAt ?? c.servingWorkCompletedAt;
  if (timestamp == null || !Number.isFinite(timestamp)) return false;

  return now - timestamp >= thresholdMs;
}

/**
 * Condition key for a verify-owed raise: mission id + sorted hash of criterion ids.
 * Element order never changes the key; tuple content does. Reuses hashTuple locally.
 */
export function verifyOwedConditionKey(missionId: string, criterionIds: string[]): string {
  const hash = hashTuple(criterionIds);
  return `verify-owed:${missionId}:${hash}`;
}

/**
 * Evaluate the stall conjunction. Two modes:
 *
 * LEGACY MODE (stuckCriterionIds absent):
 *  All arms must hold (byte-identical to prior behaviour):
 *  - missionActive === true
 *  - unmetCriteria >= 1
 *  - all in-flight counters === 0
 *  - budgetPaused === false
 *  - baseRedCooldown === false
 *  - blockedCriterionIds.length >= 1
 *  - hasOpenCardForKey === false
 *
 * STUCK ARM (stuckCriterionIds present):
 *  Raise on stuckCriterionIds.length >= 1 alone, vetoed by:
 *  - missionActive === false
 *  - budgetPaused === true
 *  - baseRedCooldown === true
 *  - hasOpenCardForKey === true
 *  - any STUCK_BLOCKING_COUNTER_KEYS counter > 0
 *  (notably: serveableGaps, awaitingVerify, verifyInFlight are NOT veto conditions)
 *
 * When stalled, return { stalled: true, conditionKey, blockedCriterionIds, stuckCriterionIds }.
 * When not stalled, return { stalled: false, conditionKey: null, blockedCriterionIds, stuckCriterionIds }.
 */
export function evaluateMissionStall(
  facts: MissionStallFacts,
  missionId: string,
): {
  stalled: boolean;
  conditionKey: string | null;
  blockedCriterionIds: string[];
  stuckCriterionIds?: string[];
} {
  // LEGACY MODE: stuckCriterionIds absent
  if (facts.stuckCriterionIds === undefined) {
    const allInFlightZero = IN_FLIGHT_COUNTER_KEYS.every((k) => facts[k] === 0);

    const stalled =
      facts.missionActive &&
      facts.unmetCriteria >= 1 &&
      allInFlightZero &&
      !facts.budgetPaused &&
      !facts.baseRedCooldown &&
      facts.blockedCriterionIds.length >= 1 &&
      !facts.hasOpenCardForKey;

    if (!stalled) {
      return {
        stalled: false,
        conditionKey: null,
        blockedCriterionIds: facts.blockedCriterionIds,
      };
    }

    return {
      stalled: true,
      conditionKey: missionStallConditionKey(missionId, facts.blockedCriterionIds),
      blockedCriterionIds: facts.blockedCriterionIds,
    };
  }

  // STUCK ARM: stuckCriterionIds present
  const stuckBlockingZero = STUCK_BLOCKING_COUNTER_KEYS.every((k) => facts[k] === 0);

  const stalled =
    facts.missionActive &&
    facts.stuckCriterionIds.length >= 1 &&
    stuckBlockingZero &&
    !facts.budgetPaused &&
    !facts.baseRedCooldown &&
    !facts.hasOpenCardForKey;

  if (!stalled) {
    return {
      stalled: false,
      conditionKey: null,
      blockedCriterionIds: facts.blockedCriterionIds,
      stuckCriterionIds: facts.stuckCriterionIds,
    };
  }

  return {
    stalled: true,
    conditionKey: missionStallConditionKey(missionId, facts.stuckCriterionIds),
    blockedCriterionIds: facts.blockedCriterionIds,
    stuckCriterionIds: facts.stuckCriterionIds,
  };
}

/**
 * Hash the FULL blocked-criterion-id tuple, sorted (order-insensitive, content-sensitive).
 * Reuses the hashTuple pattern from supervisor-store.ts locally (zero cross-module import).
 */
function hashTuple(subject: string[]): string {
  return createHash('sha256').update([...subject].sort().join('\0')).digest('hex').slice(0, 16);
}

/**
 * Durable condition identity for a stall: mission id + sorted hash of blocked criterion ids.
 * Element order in the criterion id list never changes the hash; tuple content does.
 */
export function missionStallConditionKey(missionId: string, blockedCriterionIds: string[]): string {
  const hash = hashTuple(blockedCriterionIds);
  return `mission-stalled:${missionId}:${hash}`;
}

/**
 * Stable-for-ticks tracker: module-level Map keyed by `${project} ${missionId}`.
 * Entries store { key: conditionKey, count: number }. The count increments
 * while the same condition persists; resets to 1 when the condition changes.
 */
const stallObservations = new Map<string, { key: string; count: number }>();

function observationKey(project: string, missionId: string): string {
  return `${project} ${missionId}`;
}

/**
 * Feed the stableForTicks clock with this tick's condition for one mission.
 * If no entry exists or the condition changed, start a fresh count at 1.
 * Otherwise increment the existing count and return it.
 * Always returns the resulting count.
 */
export function noteStallObservation(project: string, missionId: string, conditionKey: string): number {
  const key = observationKey(project, missionId);
  const existing = stallObservations.get(key);

  if (!existing || existing.key !== conditionKey) {
    stallObservations.set(key, { key: conditionKey, count: 1 });
    return 1;
  }

  existing.count++;
  return existing.count;
}

/**
 * End the stableForTicks observation for one mission. Called when the mission
 * demonstrates forward progress (nudged, conducted, or otherwise driven).
 * Unconditionally deletes the entry; this is the reset seam.
 */
export function clearStallObservation(project: string, missionId: string): void {
  stallObservations.delete(observationKey(project, missionId));
}

/** Test seam: clear all observations. */
export function _resetStallObservations(): void {
  stallObservations.clear();
}
