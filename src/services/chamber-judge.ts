/**
 * chamber-judge.ts — Scheduled completion convene for campaign closure via chamber judge.
 *
 * The judge mode arm convenes the chamber without a forgeInput, forcing a pure decision
 * on campaign completion. The chamber's decision is recorded as a completion verdict,
 * and a human-actionable card is raised only when the chamber reaches 'inaction' and
 * no card already exists for the same condition.
 */

import { execFileSync } from 'node:child_process';
import { runChamber, CHAMBER_GENERALS, type ChamberLLMFactory } from './chamber.ts';
import type { JudgmentLLM } from './judgment-llm.ts';
import {
  getCampaign,
  recordCampaignCompletion,
  type ChamberDecisionRecord,
  type CompletionVerdict,
} from './campaign-store.ts';
import {
  listOpenEscalations as liveListOpenEscalations,
  createEscalation as liveCreateEscalation,
} from './supervisor-store.ts';

export const CHAMBER_QUESTION_KIND = 'chamber-question';

/**
 * Derive the condition key for a chamber question card.
 * Pure function of the campaign id only — no time, uuid, counter.
 * Matches the pattern of campaignLivenessConditionKey minus the probe tuple hash.
 */
export function chamberQuestionConditionKey(campaignId: string): string {
  return `${CHAMBER_QUESTION_KIND}:${campaignId}`;
}

/**
 * Injectable dependencies for runChamberCompletionArm.
 */
export interface ChamberJudgeDeps {
  /** Convene the chamber in judge or decision mode. Defaults to the live runChamber. */
  runChamber?: typeof runChamber;
  /** Retrieve a campaign by id. Defaults to getCampaign. */
  getCampaign?: typeof getCampaign;
  /** Record a campaign completion verdict. Defaults to recordCampaignCompletion. */
  recordCampaignCompletion?: typeof recordCampaignCompletion;
  /** List open escalations for a project/kind filter. Defaults to listOpenEscalations. */
  listOpenEscalations?: typeof liveListOpenEscalations;
  /** Create an escalation card. Defaults to createEscalation. */
  createEscalation?: typeof liveCreateEscalation;
  /** Resolve the current commit sha. Defaults to defaultCommitSha. */
  commitSha?: () => string;
  /** The LLM client or factory for the chamber. */
  llm?: JudgmentLLM | ChamberLLMFactory;
  /** Mission forge function, required by ChamberDeps but never invoked in judge mode. */
  forgeMission?: (project: string, input: any) => Promise<any>;
}

/**
 * Result of running the chamber completion arm.
 */
export interface ChamberJudgeArmResult {
  /** Whether the chamber convened (ran a decision phase). */
  convened: boolean;
  /** The completion verdict recorded, or null if the arm did not complete. */
  verdict: CompletionVerdict | null;
  /** Whether a question card was raised. */
  raised: boolean;
  /** The condition key for this campaign, or null if the arm did not complete. */
  conditionKey: string | null;
}

/**
 * Resolve the current commit sha in the project root.
 * Never throws, never returns empty string. Returns 'unknown' on any error.
 */
function defaultCommitSha(project: string): string {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: project,
      encoding: 'utf-8',
      timeout: 5000,
    })
      .trim();
    return sha.length > 0 ? sha : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Run the chamber completion arm: convene the chamber in judge mode and record a verdict.
 *
 * Behaviour:
 * 1. Retrieve the campaign; return empty result if not found or if goal is null.
 * 2. Convene the chamber with no forgeInput (judge mode only).
 * 3. Map the decision outcome to a CompletionVerdict ('decision' → 'done', 'inaction' → 'not-done').
 * 4. Record exactly one completion verdict row.
 * 5. If the outcome is 'inaction', check for an open card with the same conditionKey;
 *    raise a new card only if none exists.
 *
 * @param project — The project tracking root.
 * @param campaignId — The campaign whose completion to judge.
 * @param session — The session context.
 * @param deps — Injectable IO. All default to live implementations.
 */
export async function runChamberCompletionArm(
  project: string,
  campaignId: string,
  session: string,
  deps: ChamberJudgeDeps = {},
): Promise<ChamberJudgeArmResult> {
  try {
    const runChamberFn = deps.runChamber ?? runChamber;
    const getCampaignFn = deps.getCampaign ?? getCampaign;
    const recordCompletionFn = deps.recordCampaignCompletion ?? recordCampaignCompletion;
    const listOpenEscFn = deps.listOpenEscalations ?? liveListOpenEscalations;
    const createEscFn = deps.createEscalation ?? liveCreateEscalation;
    const commitShaFn = deps.commitSha ?? (() => defaultCommitSha(project));
    const llm = deps.llm;
    const forgeMissionFn = deps.forgeMission ?? (async () => null);

    // Step 1: Retrieve the campaign; return empty result if not found or if goal is null.
    const campaign = getCampaignFn(project, campaignId);
    if (campaign == null || campaign.goal == null) {
      return { convened: false, verdict: null, raised: false, conditionKey: null };
    }

    // Step 2: Convene the chamber in judge mode (no forgeInput).
    const sha = commitShaFn();
    const result = await runChamberFn(
      project,
      {
        campaignId,
        sessionId: session,
        decidedAtSha: sha,
        llm,
        // Notably: no forgeInput, which forces decision mode only.
      },
      { forgeMission: forgeMissionFn },
    );

    const decision = result.decision as ChamberDecisionRecord;

    // Step 3: Map the decision outcome to a CompletionVerdict.
    const verdict: CompletionVerdict = decision.outcome === 'decision' ? 'done' : 'not-done';

    // Step 4: Record exactly one completion verdict row.
    recordCompletionFn(project, {
      campaignId,
      judge: 'chamber',
      verdict,
      ruledAtSha: decision.decidedAtSha,
      rationale: decision.refiningGuidance ?? decision.strongestDissent ?? null,
      citedLenses: [...CHAMBER_GENERALS],
    });

    // Step 5: Raise a question card only when the outcome is 'inaction' and no open card exists.
    const conditionKey = chamberQuestionConditionKey(campaignId);
    let raised = false;

    if (decision.outcome === 'inaction') {
      // Check if an open card for this condition already exists.
      const openCards = listOpenEscFn({ project, kind: CHAMBER_QUESTION_KIND });
      const existingCard = openCards.some((e) => e.conditionKey === conditionKey);

      if (!existingCard) {
        // Raise the card.
        createEscFn({
          project,
          session,
          kind: CHAMBER_QUESTION_KIND,
          todoId: null,
          operatorGated: true,
          audience: 'human',
          conditionKey,
          conditionTuple: [CHAMBER_QUESTION_KIND, campaignId],
          questionText: `Campaign "${campaignId}" could not be ruled complete by the chamber. Dissent: ${decision.strongestDissent ?? 'none recorded'}`,
        });
        raised = true;
      }
    }

    return { convened: true, verdict, raised, conditionKey };
  } catch {
    // fail-open outermost: do not sink the campaign scheduling loop.
    return { convened: false, verdict: null, raised: false, conditionKey: null };
  }
}
