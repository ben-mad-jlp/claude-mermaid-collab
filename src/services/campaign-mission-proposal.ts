/**
 * campaign-mission-proposal.ts — LLM-based mission proposal approval gate via panel of lenses.
 *
 * A panel of independent lenses inspects a proposed mission goal BEFORE any work is spawned.
 * Each lens focuses on a different aspect of the proposal quality. An objection from any lens
 * rejects the proposal; unanimous silence approves it. The proposal ruling and all objections
 * are persisted BEFORE the mission is forged, making the record an immutable audit trail of
 * the gate decision.
 */

import type { JudgmentLLM } from './judgment-llm.ts';
import {
  getCampaign,
  recordMissionProposal,
  listMissionProposals,
  listProposalObjections,
  type CampaignRow,
  type MissionProposalRecord,
  type ProposalObjectionRecord,
  type ProposalObjectionInput,
  type ProposalRuling,
} from './campaign-store.ts';

export interface CampaignLens {
  name: string;
  focus: string;
}

/**
 * Internal shape carried between LLM call and panel rule.
 * The LLM reply is parsed into this shape before being cast to ProposalObjectionInput.
 */
interface ProposalLensObjection {
  lens: string;
  objection: string | null;
  reasoning: string;
}

/**
 * Panel of three lenses that independently assess a mission proposal.
 * Each lens focuses on a different aspect of the proposal:
 * - goal-clarity: is the proposed goal a closeable objective or a vague aspiration?
 * - duplication: is this already done or already covered by existing probes and prior proposals?
 * - refuter: strongest case that spawning this mission is wrong work.
 */
export const PROPOSAL_LENSES: readonly CampaignLens[] = [
  {
    name: 'goal-clarity',
    focus: 'Examine whether the proposed mission goal is a concrete, closeable objective or a vague aspiration. Is it clear what done looks like?',
  },
  {
    name: 'duplication',
    focus: 'Examine whether this proposed mission duplicates work already done or already covered by existing campaign probes and prior proposals. Is the work already addressed?',
  },
  {
    name: 'refuter',
    focus: 'Construct the strongest possible case that spawning this mission is wrong work. What facts or absences would prove the proposal should be rejected? Does that case hold up?',
  },
] as const;

/**
 * Build the system and user prompts for a proposal lens.
 * The user prompt contains the proposed goal (verbatim) alongside the campaign title/goal.
 * The system string names the reply contract {"objection":string|null, "reasoning":string}.
 */
export function buildProposalLensPrompt(
  lens: CampaignLens,
  campaign: CampaignRow,
  proposedGoal: string,
): { system: string; user: string } {
  const system = `You are a mission proposal reviewer. You will be given a campaign context and a proposed mission goal. Your task is to determine if there is an objection to approving this proposal.

Respond with a single JSON object in this format:
{"objection":string|null,"reasoning":string}

Rules:
- objection may be null (no objection) or a string (the objection to this proposal).
- reasoning is a brief explanation of your assessment.
- If you cannot determine your position with confidence, provide an objection explaining why.

LENS: ${lens.name}
FOCUS: ${lens.focus}`;

  const campaignSection = campaign.goal
    ? `Campaign Title: ${campaign.title}
Campaign Goal: ${campaign.goal}`
    : `Campaign Title: ${campaign.title}
Campaign Goal: (none)`;

  const user = `${campaignSection}

Proposed Mission Goal:
${proposedGoal}

Based on the campaign context and the proposed goal above, is there an objection to approving this proposal?

LENS: ${lens.name}
FOCUS: ${lens.focus}`;

  return { system, user };
}

/**
 * Pure function that rules on a panel of proposal objections.
 * Returns 'approved' only when the array is empty (no objections from any lens).
 * Returns 'rejected' otherwise. The rationale names each objecting lens and embeds
 * its objection and reasoning verbatim.
 */
export function ruleProposalPanel(
  objections: ProposalObjectionInput[],
): { ruling: ProposalRuling; rationale: string } {
  const ruling: ProposalRuling = objections.length === 0 ? 'approved' : 'rejected';

  if (objections.length === 0) {
    return {
      ruling: 'approved',
      rationale: 'Panel approved: no objections from any lens.',
    };
  }

  const reasoningLines = objections
    .map((obj) => `  ${obj.lens}: ${obj.objection || '(no objection text)'}\n    Reasoning: ${obj.reasoning || '(no reasoning)'}`)
    .join('\n');

  const rationale = `Panel rejected: objections raised by ${objections.length} lens(es)\n\nLens objections:\n${reasoningLines}`;

  return { ruling, rationale };
}

/**
 * Rule on a mission proposal via a panel of lenses.
 * Reads campaign state, builds a prompt per lens, calls the injected LLM once per lens,
 * and persists the ruling and any objections.
 *
 * Store reads (getCampaign) run outside try/catch so a genuine store failure surfaces
 * as a throw rather than becoming a silent rejection.
 *
 * Each lens's LLM call and parse are wrapped in their own try/catch: every error path —
 * network failure, empty reply, unparseable JSON, non-string/non-null objection field —
 * resolves to an objection with text "proposal-inconclusive: ${reason}" attributed to that lens.
 * This makes the panel fail-CLOSED to rejection: an inconclusive lens is a rejection reason.
 *
 * The proposal record (with ruling and rationale) is persisted exactly once via recordMissionProposal,
 * with all objection rows inserted in the same transaction. Returns the recorded proposal
 * together with the list of persisted objection records.
 */
export async function ruleMissionProposal(
  project: string,
  args: {
    campaignId: string;
    proposedGoal: string;
    llm: JudgmentLLM;
    judge: string;
    ruledAtSha: string;
  },
): Promise<{ record: MissionProposalRecord; objections: ProposalObjectionRecord[] }> {
  // Read campaign state outside try/catch so store failures surface as throws.
  const campaign = getCampaign(project, args.campaignId);
  if (!campaign) {
    throw new Error(`campaign not found: ${args.campaignId}`);
  }

  // Call the judge once per lens. Each lens is evaluated independently;
  // failing lenses degrade to an objection rather than failing the whole pass.
  const lensObjections: ProposalLensObjection[] = [];

  for (const lens of PROPOSAL_LENSES) {
    const { system, user } = buildProposalLensPrompt(lens, campaign, args.proposedGoal);

    let lensObjection: string | null = null;
    let lensReasoning = '';

    try {
      const reply = await args.llm.complete(system, user);

      if (!reply || !reply.trim()) {
        throw new Error('empty reply from judge');
      }

      // Extract the first JSON object from the reply, tolerating prose or markdown fences.
      const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
      if (!jsonMatch) {
        throw new Error('no JSON object found in judge reply');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate objection field: must be null or string.
      if (parsed.objection !== null && typeof parsed.objection !== 'string') {
        throw new Error(`invalid objection field: expected null|string, got ${typeof parsed.objection}`);
      }

      lensObjection = parsed.objection;
      lensReasoning = parsed.reasoning || `${lens.name} assessment`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      lensObjection = `proposal-inconclusive: ${reason}`;
      lensReasoning = `Judge could not determine assessment: ${reason}`;
    }

    lensObjections.push({
      lens: lens.name,
      objection: lensObjection,
      reasoning: lensReasoning,
    });
  }

  // Convert lens objections to persistable format: omit lenses with no objection.
  const objectionsToRecord: ProposalObjectionInput[] = lensObjections
    .filter((lo) => lo.objection !== null)
    .map((lo) => ({
      lens: lo.lens,
      objection: lo.objection!,
      reasoning: lo.reasoning,
    }));

  // Apply the panel rule.
  const panelRuling = ruleProposalPanel(objectionsToRecord);

  // Persist exactly once via recordMissionProposal.
  const record = recordMissionProposal(project, {
    campaignId: args.campaignId,
    proposedGoal: args.proposedGoal,
    ruling: panelRuling.ruling,
    ruledAtSha: args.ruledAtSha,
    rationale: panelRuling.rationale,
    objections: objectionsToRecord,
  });

  // Retrieve persisted objections.
  const objections = listProposalObjections(project, record.id);

  return { record, objections };
}

/**
 * Rule on a mission proposal, then forge a mission only if the ruling is 'approved'.
 * The proposal record is committed before deps.forgeMission becomes reachable,
 * making the audit trail immutable and establishing the order guarantee: ruling before spawn.
 */
export async function ruleThenForgeMission(
  project: string,
  args: {
    campaignId: string;
    proposedGoal: string;
    llm: JudgmentLLM;
    judge: string;
    ruledAtSha: string;
    forgeInput: any; // ForgeMissionInput
  },
  deps: {
    forgeMission: (project: string, input: any) => Promise<any>; // ForgeMissionResult
  },
): Promise<{
  proposal: MissionProposalRecord;
  objections: ProposalObjectionRecord[];
  forged: any | null;
}> {
  // Rule first.
  const { record: proposal, objections } = await ruleMissionProposal(project, {
    campaignId: args.campaignId,
    proposedGoal: args.proposedGoal,
    llm: args.llm,
    judge: args.judge,
    ruledAtSha: args.ruledAtSha,
  });

  // Forge only if approved.
  let forged: any = null;
  if (proposal.ruling === 'approved') {
    forged = await deps.forgeMission(project, args.forgeInput);
  }

  return { proposal, objections, forged };
}
