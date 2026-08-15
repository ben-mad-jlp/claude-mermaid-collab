/**
 * conductor-verify-owed-arm — conductor-side observer for verify-owed criteria.
 *
 * `verifyOwedConditionKey` and `isVerifyOwedPastThreshold` (mission-stall-predicate.ts)
 * had no non-test caller in src/: the conductor never observed a verify-owed criterion
 * on its own cadence, so the debounce (conductor-pass.ts:1076) could block the only actor
 * that might move a verify-action criterion forward. This arm scans
 * listCriteriaWithActions on every conductor pass, selects criteria past the verify-owed
 * threshold via the shared pure predicate, and raises ONE operatorGated human backstop
 * card keyed by the SAME condition-key function the mission-loop's raise path uses — so
 * both actors observing the same condition collapse into one escalation row instead of
 * two rivals.
 *
 * Fail OPEN throughout: a throwing store read, predicate call, or createEscalation must
 * never sink the conductor pass. Matches the discipline in conductor-verify-panel-arm.ts.
 */
import { listCriteriaWithActions } from './mission-store.js';
import { listOpenEscalations, createEscalation, type Escalation } from './supervisor-store.js';
import { VERIFY_OWED_BACKSTOP_MS } from './harness-caps.js';
import { isVerifyOwedPastThreshold, verifyOwedConditionKey } from './mission-stall-predicate.js';

export const VERIFY_OWED_BACKSTOP_KIND = 'verify-owed-backstop';

export interface VerifyOwedArmDeps {
  /** Gates the dedup classification for the raise. Defaults to supervisor-store.listOpenEscalations. */
  listOpenEscalations?: () => Escalation[];
  /** Creates/bumps the backstop card. Defaults to createEscalation. */
  createEscalation?: typeof createEscalation;
  /** Current time. Defaults to Date.now. */
  now?: () => number;
  /** Age threshold past which a landed verify-action criterion is "owed". Defaults to
   *  VERIFY_OWED_BACKSTOP_MS. */
  thresholdMs?: number;
  /** Test seam: overrides the criteria-with-actions read. Defaults to the same
   *  listCriteriaWithActions import the panel arm uses. */
  listCriteriaWithActions?: typeof listCriteriaWithActions;
}

export interface VerifyOwedArmResult {
  /** Criterion ids past the verify-owed threshold this pass. */
  owed: string[];
  /** Whether createEscalation was called this pass (owed.length > 0). */
  raised: boolean;
  /** Whether the call bumped an already-open row rather than minting a new one. */
  bumped: boolean;
  /** The shared condition key for this mission's owed set, or null when nothing is owed. */
  conditionKey: string | null;
}

const EMPTY_RESULT: VerifyOwedArmResult = { owed: [], raised: false, bumped: false, conditionKey: null };

/**
 * Scan one mission's criteria for verify-owed staleness and raise (or bump) the shared
 * backstop card. Never short-circuits the conductor pass: this arm only observes and
 * raises a card, it never returns a pass result itself.
 *
 * @param project — The project tracking root.
 * @param missionId — The mission whose criteria to scan.
 * @param session — The session context, forwarded into the escalation record.
 * @param deps — Injectable IO. All default to live implementations.
 */
export async function runVerifyOwedArm(
  project: string,
  missionId: string,
  session: string,
  deps: VerifyOwedArmDeps = {},
): Promise<VerifyOwedArmResult> {
  try {
    const listCriteria = deps.listCriteriaWithActions ?? listCriteriaWithActions;
    const now = deps.now ?? Date.now;
    const thresholdMs = deps.thresholdMs ?? VERIFY_OWED_BACKSTOP_MS;

    const criteria = listCriteria(project, missionId);
    const nowMs = now();

    const owed: string[] = [];
    for (const c of criteria) {
      try {
        if (isVerifyOwedPastThreshold(c, nowMs, thresholdMs)) owed.push(c.id);
      } catch {
        // fail-open per-criterion: one malformed row must not sink the scan.
      }
    }

    if (owed.length === 0) return EMPTY_RESULT;

    const conditionKey = verifyOwedConditionKey(missionId, owed);

    const listOpen = deps.listOpenEscalations ?? listOpenEscalations;
    const bumped = listOpen().some((e) => e.conditionKey === conditionKey && e.status === 'open');

    const createEsc = deps.createEscalation ?? createEscalation;
    createEsc({
      project,
      session,
      kind: VERIFY_OWED_BACKSTOP_KIND,
      todoId: missionId,
      operatorGated: true,
      audience: 'human',
      conditionKey,
      conditionTuple: ['verify-owed', missionId, ...owed],
      questionText: `Mission "${missionId}" has ${owed.length} criterion(criteria) owed a verify ` +
        `(ids: ${owed.join(', ')}) — landed but unverified for at least ${Math.round(thresholdMs / 60000)} minute(s).`,
    });

    return { owed, raised: true, bumped, conditionKey };
  } catch {
    // fail-open outermost: a throwing store read or createEscalation must not sink the pass.
    return EMPTY_RESULT;
  }
}
