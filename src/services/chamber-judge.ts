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
  listChamberDecisions,
  listProbeVerdicts,
  type ChamberDecisionRecord,
  type CompletionVerdict,
} from './campaign-store.ts';
import { campaignFront, computeFrontFingerprint } from './campaign-front.ts';
import {
  listOpenEscalations as liveListOpenEscalations,
  createEscalation as liveCreateEscalation,
} from './supervisor-store.ts';

export const CHAMBER_QUESTION_KIND = 'chamber-question';

/** Hard ceiling on chamber convenes per campaign per rolling 24h, across BOTH arms
 *  (completion judge + mission forge — the count is over all chamber_decision rows).
 *  A convene is a full multi-general LLM deliberation; this breaker exists so a
 *  debounce bug can never again burn deliberations back-to-back for hours.
 *  Override with MERMAID_CHAMBER_CONVENES_PER_DAY. */
export const CHAMBER_CONVENES_PER_DAY_DEFAULT = 6;

function chamberConvenesPerDay(): number {
  const raw = Number(process.env.MERMAID_CHAMBER_CONVENES_PER_DAY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : CHAMBER_CONVENES_PER_DAY_DEFAULT;
}

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
  /** Derive the campaign front (all probes). Defaults to the live campaignFront. */
  campaignFront?: typeof campaignFront;
  /** List recorded verdicts for a probe. Defaults to the live listProbeVerdicts. */
  listProbeVerdicts?: typeof listProbeVerdicts;
  /** List chamber decisions for a campaign. Defaults to the live listChamberDecisions. */
  listChamberDecisions?: typeof listChamberDecisions;
  /** Clock, for the daily convene budget window. Defaults to Date.now. */
  now?: () => number;
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
  /** Why a non-convened arm declined, when it declined deliberately (not an error). */
  skipped?: 'unchanged-front' | 'convene-budget-exhausted';
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

    const frontFn = deps.campaignFront ?? campaignFront;
    const verdictsFn = deps.listProbeVerdicts ?? listProbeVerdicts;
    const listDecisionsFn = deps.listChamberDecisions ?? listChamberDecisions;
    const nowFn = deps.now ?? Date.now;

    // Step 1: Retrieve the campaign; return empty result if not found or if goal is null.
    const campaign = getCampaignFn(project, campaignId);
    if (campaign == null || campaign.goal == null) {
      return { convened: false, verdict: null, raised: false, conditionKey: null };
    }

    // Step 1a: Debounce on unchanged evidence. The completion judgment is a pure function
    // of the campaign's probe evidence; if no probe verdict has changed since the last
    // recorded decision, a re-convene can only restate it. The fingerprint covers the
    // front (not-run + failing probes with satisfied deps); an all-pass campaign
    // fingerprints as '' and debounces once a decision has recorded that state.
    // This arm previously convened unconditionally every pass: ~12 back-to-back opus
    // deliberations in one morning, and the tick they ran in starved leaf claims for hours.
    const fingerprint = computeFrontFingerprint(frontFn(project, campaignId), (id) => {
      const vs = verdictsFn(project, id);
      return vs.length > 0 ? vs[vs.length - 1].commitSha : null;
    });
    const decisions = listDecisionsFn(project, campaignId);
    const latest = decisions.length > 0 ? decisions[decisions.length - 1] : undefined;
    if (latest && latest.frontFingerprint != null && latest.frontFingerprint === fingerprint) {
      return { convened: false, verdict: null, raised: false, conditionKey: null, skipped: 'unchanged-front' };
    }

    // Step 1b: Hard budget breaker — even with a changed front, never exceed N convenes
    // per campaign per rolling 24h. The debounce is the correctness gate; this is the
    // spend ceiling that holds when the debounce (or a probe re-executor) misbehaves.
    const windowStart = nowFn() - 24 * 60 * 60 * 1000;
    const recentCount = decisions.filter((d) => d.createdAt >= windowStart).length;
    if (recentCount >= chamberConvenesPerDay()) {
      console.warn(
        `[chamber-judge] campaign ${campaignId.slice(0, 8)} convene budget exhausted (${recentCount} in 24h, cap ${chamberConvenesPerDay()}) — skipping completion convene`,
      );
      return { convened: false, verdict: null, raised: false, conditionKey: null, skipped: 'convene-budget-exhausted' };
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
        frontFingerprint: fingerprint,
        // Notably: no forgeInput, which forces decision mode only.
      },
      { forgeMission: forgeMissionFn },
    );

    const decision = result.decision as ChamberDecisionRecord;

    // Step 3: Map the decision outcome to a CompletionVerdict.
    const verdict: CompletionVerdict = decision.outcome === 'decision' ? 'done' : 'not-done';

    // Step 4: Record exactly one completion verdict row. The examined evidence is the
    // persisted deliberation itself plus the probe front it judged — the store refuses a
    // verdict citing nothing (this call threw for every live convene until it cited these,
    // so chamber decisions accumulated while campaign_completion_verdict stayed empty).
    recordCompletionFn(project, {
      campaignId,
      judge: 'chamber',
      verdict,
      ruledAtSha: decision.decidedAtSha,
      rationale: decision.refiningGuidance ?? decision.strongestDissent ?? null,
      citedLenses: [...CHAMBER_GENERALS],
      artifactsRead: [
        `chamber_decision:${decision.id}`,
        `campaign-front-fingerprint:${fingerprint === '' ? '(all probes pass)' : fingerprint}`,
      ],
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
