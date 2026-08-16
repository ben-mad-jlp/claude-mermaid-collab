/**
 * campaign-rig-fault.ts — classify and card a rig fault when member count mismatches.
 *
 * A rig probe runs against a live application with a project open. The reset must verify
 * that the opened member count matches the on-disk manifest count. If they diverge, the rig
 * is in a fault state and the probe verdict (pass/fail) is unreliable — the run outcome is
 * 'rig-fault', the prior probe verdict is preserved untouched, and an operator card is raised.
 *
 * The rig-fault verdict is a RUN OUTCOME, not a stored probe state. It leaves the probe's
 * stored verdict (ProbeVerdict) unchanged so the campaign_probe.verdict CHECK constraint
 * (which only allows 'not-run', 'pass', 'fail') is never violated.
 */

import type {
  RecordedVerdict,
  RigRunVerdict,
} from './campaign-store.ts';
import type { RigResetRecord } from './campaign-rig-reset.ts';
import {
  recordProbeVerdict as liveRecordProbeVerdict,
  type ProbeVerdictInput,
} from './campaign-store.ts';
import {
  listOpenEscalations as liveListOpenEscalations,
  createEscalation as liveCreateEscalation,
  type Escalation,
} from './supervisor-store.ts';

export const CAMPAIGN_RIG_FAULT_KIND = 'campaign-rig-fault';

/**
 * Pure classifier: returns 'rig-fault' when the opened member count differs from
 * the manifest count, else returns the probe outcome unchanged.
 *
 * The mismatch dominates BOTH outcomes — a mismatched reset with probeOutcome === 'pass'
 * still yields 'rig-fault'.
 */
export function classifyRigRun(reset: RigResetRecord, probeOutcome: RecordedVerdict): RigRunVerdict {
  if (reset.openedMemberCount !== reset.manifestCount) {
    return 'rig-fault';
  }
  return probeOutcome;
}

/**
 * Derive the condition key for a rig fault observation.
 * Pure function of probeId and the two counts — no timestamp, uuid, random value, or counter.
 * Shape: ${CAMPAIGN_RIG_FAULT_KIND}:${probeId}:${openedMemberCount}:${manifestCount}
 */
export function rigFaultConditionKey(
  probeId: string,
  openedMemberCount: number,
  manifestCount: number,
): string {
  return `${CAMPAIGN_RIG_FAULT_KIND}:${probeId}:${openedMemberCount}:${manifestCount}`;
}

/**
 * Injectable dependencies for runRigFaultArm.
 */
export interface CampaignRigFaultArmDeps {
  /** Record a probe verdict with provenance. Defaults to the live implementation. */
  recordProbeVerdict?: typeof liveRecordProbeVerdict;
  /** List open escalations for a project/kind filter. Defaults to listOpenEscalations. */
  listOpenEscalations?: typeof liveListOpenEscalations;
  /** Create or bump an escalation. Defaults to createEscalation. */
  createEscalation?: typeof liveCreateEscalation;
  /** Current time in milliseconds. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Result of running the rig fault arm.
 */
export interface CampaignRigFaultArmResult {
  /** The classified run outcome (pass, fail, or rig-fault). */
  verdict: RigRunVerdict;
  /** Whether createEscalation was called this pass (a new rig-fault card was raised). */
  raised: boolean;
  /** The condition key for this rig fault, or null when no fault. */
  conditionKey: string | null;
  /** Whether the probe verdict was recorded (false on rig-fault, true otherwise). */
  recorded: boolean;
}

/**
 * Classify a rig run and handle card raising when a mismatch is detected.
 *
 * 1. Classifies the run: 'rig-fault' if counts mismatch, else the probe outcome.
 * 2. If not rig-fault: records the verdict and returns.
 * 3. If rig-fault: preserves the prior verdict (no recordProbeVerdict call), raises a card
 *    if one isn't already open for this condition key, and returns.
 *
 * @param project — The project tracking root.
 * @param probeId — The probe being run.
 * @param reset — The rig reset record with counts and sha.
 * @param probeOutcome — The probe's actual outcome (pass or fail).
 * @param session — The session context, forwarded into the escalation record.
 * @param deps — Injectable IO. All default to live implementations.
 */
export async function runRigFaultArm(
  project: string,
  probeId: string,
  reset: RigResetRecord,
  probeOutcome: RecordedVerdict,
  session: string,
  deps: CampaignRigFaultArmDeps = {},
): Promise<CampaignRigFaultArmResult> {
  // Compute verdict before the try block so catch can still report it defensively.
  const verdict = classifyRigRun(reset, probeOutcome);

  try {
    const recordProbe = deps.recordProbeVerdict ?? liveRecordProbeVerdict;
    const getOpenEscalations = deps.listOpenEscalations ?? liveListOpenEscalations;
    const createEsc = deps.createEscalation ?? liveCreateEscalation;

    // Not rig-fault: record the verdict normally and return.
    if (verdict !== 'rig-fault') {
      const input: ProbeVerdictInput = {
        probeId,
        verdict,
        environment: 'rig',
        commitSha: reset.commitSha,
      };
      recordProbe(project, input);
      return { verdict, raised: false, conditionKey: null, recorded: true };
    }

    // Rig-fault: derive the condition key and check for an existing open card.
    const { openedMemberCount, manifestCount } = reset;
    const conditionKey = rigFaultConditionKey(probeId, openedMemberCount, manifestCount);

    // Check if an open card for this condition already exists.
    const openCards = getOpenEscalations({ project, kind: CAMPAIGN_RIG_FAULT_KIND });
    const existingCard = openCards.some((e: Escalation) => e.conditionKey === conditionKey);

    if (existingCard) {
      // Card already open for this mismatch — don't raise again.
      return { verdict, raised: false, conditionKey, recorded: false };
    }

    // Raise a new card.
    const conditionTuple = [
      CAMPAIGN_RIG_FAULT_KIND,
      probeId,
      String(openedMemberCount),
      String(manifestCount),
    ];
    const questionText = `Rig fault for probe "${probeId}": opened member count ${openedMemberCount} ≠ manifest count ${manifestCount}`;

    createEsc({
      project,
      session,
      kind: CAMPAIGN_RIG_FAULT_KIND,
      questionText,
      todoId: null,
      operatorGated: true,
      audience: 'human',
      conditionKey,
      conditionTuple,
    });

    return { verdict, raised: true, conditionKey, recorded: false };
  } catch {
    // fail-open outermost: a throwing store read or createEscalation must not sink the pass.
    // Return the verdict (computed before the try), raised: false, and recorded: false.
    return { verdict, raised: false, conditionKey: null, recorded: false };
  }
}
