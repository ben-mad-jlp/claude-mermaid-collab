/**
 * campaign-liveness-card.ts — raise a card when a campaign front is unsatisfied.
 *
 * Mirrors conductor-verify-owed-arm.ts structurally. Scans a campaign's front probes
 * and raises ONE operatorGated human card keyed by the same condition-key when:
 * - The front contains unsatisfied (fail or not-run) probes, AND
 * - No linked mission for this campaign is currently open.
 *
 * Fail OPEN throughout: a throwing store read or createEscalation must never sink
 * the caller. Matches the discipline in conductor-verify-owed-arm.ts.
 */

import { createHash } from 'node:crypto';
import { campaignFront as liveCampaignFront } from './campaign-front.ts';
import { listOpenLinkedMissions as liveListOpenLinkedMissions } from './campaign-pass.ts';
import {
  listOpenEscalations as liveListOpenEscalations,
  createEscalation as liveCreateEscalation,
  type Escalation,
} from './supervisor-store.ts';

export const CAMPAIGN_FRONT_UNSATISFIED_KIND = 'campaign-front-unsatisfied';

/**
 * Hash a sorted tuple of probe ids for condition-key derivation.
 * Order-insensitive, content-sensitive.
 */
function hashTuple(subject: string[]): string {
  return createHash('sha256').update([...subject].sort().join('\0')).digest('hex').slice(0, 16);
}

/**
 * Derive the condition key for a campaign front observation.
 * Combines campaignId + sorted probe ids hash, ensuring repeat observations
 * of the same front are byte-identical.
 */
export function campaignLivenessConditionKey(campaignId: string, probeIds: string[]): string {
  const hash = hashTuple(probeIds);
  return `${CAMPAIGN_FRONT_UNSATISFIED_KIND}:${campaignId}:${hash}`;
}

/**
 * Injectable dependencies for runCampaignLivenessArm.
 */
export interface CampaignLivenessArmDeps {
  /** Derive the front of a campaign. Defaults to the live campaignFront implementation. */
  campaignFront?: typeof liveCampaignFront;
  /** List open linked missions for a campaign. Defaults to listOpenLinkedMissions. */
  listOpenLinkedMissions?: typeof liveListOpenLinkedMissions;
  /** List open escalations for a project/kind filter. Defaults to listOpenEscalations. */
  listOpenEscalations?: typeof liveListOpenEscalations;
  /** Create or bump an escalation. Defaults to createEscalation. */
  createEscalation?: typeof liveCreateEscalation;
  /** Current time in milliseconds. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Result of running the campaign liveness arm.
 */
export interface CampaignLivenessArmResult {
  /** Unsatisfied probe ids in the front. */
  unsatisfied: string[];
  /** Whether createEscalation was called this pass. */
  raised: boolean;
  /** Whether the call bumped an already-open row rather than minting a new one. */
  bumped: boolean;
  /** The shared condition key for this front, or null when nothing is unsatisfied. */
  conditionKey: string | null;
}

const EMPTY_RESULT: CampaignLivenessArmResult = {
  unsatisfied: [],
  raised: false,
  bumped: false,
  conditionKey: null,
};

/**
 * Scan a campaign's front probes and raise (or bump) a liveness card when the front
 * is unsatisfied and no linked mission is already open.
 *
 * @param project — The project tracking root.
 * @param campaignId — The campaign whose front to scan.
 * @param session — The session context, forwarded into the escalation record.
 * @param deps — Injectable IO. All default to live implementations.
 */
export async function runCampaignLivenessArm(
  project: string,
  campaignId: string,
  session: string,
  deps: CampaignLivenessArmDeps = {},
): Promise<CampaignLivenessArmResult> {
  try {
    const getCampaignFront = deps.campaignFront ?? liveCampaignFront;
    const getOpenLinkedMissions = deps.listOpenLinkedMissions ?? liveListOpenLinkedMissions;
    const getOpenEscalations = deps.listOpenEscalations ?? liveListOpenEscalations;
    const createEsc = deps.createEscalation ?? liveCreateEscalation;

    // Derive the front and filter to unsatisfied probes.
    const front = getCampaignFront(project, campaignId);
    const probeIds = front
      .filter((p) => p.verdict === 'fail' || p.verdict === 'not-run')
      .map((p) => p.id);

    // No unsatisfied probes → nothing to raise.
    if (probeIds.length === 0) return EMPTY_RESULT;

    // Check if a linked mission is already open.
    const openMissions = getOpenLinkedMissions(project, campaignId);
    if (openMissions.length >= 1) {
      return EMPTY_RESULT;
    }

    // Derive the condition key from the unsatisfied set.
    const conditionKey = campaignLivenessConditionKey(campaignId, probeIds);

    // Check if an open card for this condition already exists.
    const openCards = getOpenEscalations({ project, kind: CAMPAIGN_FRONT_UNSATISFIED_KIND });
    const existingCard = openCards.some(
      (e) =>
        e.conditionKey === conditionKey ||
        (e.conditionKey != null &&
          e.conditionKey.startsWith(`${CAMPAIGN_FRONT_UNSATISFIED_KIND}:${campaignId}:`)),
    );

    if (existingCard) {
      return { unsatisfied: probeIds, raised: false, bumped: false, conditionKey };
    }

    // Raise the card.
    const result = createEsc({
      project,
      session,
      kind: CAMPAIGN_FRONT_UNSATISFIED_KIND,
      todoId: null,
      operatorGated: true,
      audience: 'human',
      conditionKey,
      conditionTuple: [CAMPAIGN_FRONT_UNSATISFIED_KIND, campaignId, ...probeIds],
      questionText: `Campaign "${campaignId}" has ${probeIds.length} unsatisfied front probe(s): ${probeIds.join(', ')}`,
    });

    return { unsatisfied: probeIds, raised: true, bumped: !result.isNew, conditionKey };
  } catch {
    // fail-open outermost: a throwing store read or createEscalation must not sink the pass.
    return EMPTY_RESULT;
  }
}
