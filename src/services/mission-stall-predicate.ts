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
 * Evaluate the stall conjunction. All arms must hold:
 *  - missionActive === true
 *  - unmetCriteria >= 1
 *  - all in-flight counters === 0
 *  - budgetPaused === false
 *  - baseRedCooldown === false
 *  - blockedCriterionIds.length >= 1
 *  - hasOpenCardForKey === false
 *
 * When stalled, return { stalled: true, conditionKey, blockedCriterionIds }.
 * When not stalled, return { stalled: false, conditionKey: null, blockedCriterionIds }.
 */
export function evaluateMissionStall(
  facts: MissionStallFacts,
  missionId: string,
): {
  stalled: boolean;
  conditionKey: string | null;
  blockedCriterionIds: string[];
} {
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
