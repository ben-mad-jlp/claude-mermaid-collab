/**
 * campaign-completion-judge.ts — LLM-based campaign completion verdict.
 *
 * The judge is the first place in the campaign layer where an LLM rules on anything;
 * every existing campaign verdict is arithmetic over probe exit codes. The whole point
 * is that it can only ever *close* a campaign on an explicit, well-formed `done` —
 * every other outcome (throw, empty reply, garbage, out-of-union verdict) becomes a
 * stored `not-done`, so an inconclusive judge leaves the campaign running.
 */

import type { JudgmentLLM } from './judgment-llm.ts';
import {
  getCampaign,
  listProbes,
  listProbeVerdicts,
  recordCampaignCompletion,
  type CampaignCompletionRecord,
  type CampaignRow,
  type CampaignProbe,
  type ProbeVerdictRecord,
} from './campaign-store.ts';

export interface JudgeCampaignOpts {
  llm: JudgmentLLM;
  judge: string;
  ruledAtSha: string;
}

/**
 * Build the system and user prompts for the campaign completion judge.
 * The user prompt contains the campaign goal (verbatim) and enumerates every probe
 * with its id, kind, command, environment, and all recorded verdict records.
 */
export function buildCompletionPrompt(
  campaign: CampaignRow,
  probes: CampaignProbe[],
  verdictsByProbe: Map<string, ProbeVerdictRecord[]>,
): { system: string; user: string } {
  const system = `You are a campaign completion judge. You will be given a campaign goal and a set of probe verdicts. Your task is to determine whether the campaign's goal has been met.

Respond with a single JSON object in this format:
{"verdict":"done"|"not-done","rationale":string}

Rules:
- Green probes are necessary but not sufficient — the goal is what is being judged.
- A campaign with no goal cannot be ruled done.
- If you cannot determine completeness with confidence, respond with "not-done".`;

  const probeDetails = probes
    .map((probe) => {
      const verdicts = verdictsByProbe.get(probe.id) || [];
      const verdictLines = verdicts
        .map((v) => `  - ${v.verdict} (${v.environment} @ ${v.commitSha}): ${v.evidence || '(no evidence)'}`)
        .join('\n');

      return `Probe: ${probe.id}
  Kind: ${probe.kind}
  Command: ${probe.command || '(no command)'}
  Environment: ${probe.environment}
  Recorded Verdicts:
${verdictLines}`;
    })
    .join('\n\n');

  const goalSection = campaign.goal
    ? `Campaign Goal:
${campaign.goal}`
    : `Campaign Goal: (none — a goalless campaign cannot be ruled done)`;

  const user = `${goalSection}

${probeDetails}

Based on the goal and probe results above, is this campaign complete?`;

  return { system, user };
}

/**
 * Judge a campaign's completion status. Reads campaign state, builds a prompt,
 * calls the injected LLM, and persists the verdict.
 *
 * Store reads (getCampaign, listProbes, listProbeVerdicts) run outside the try/catch
 * so a genuine store failure surfaces as a throw rather than becoming a silent not-done.
 *
 * The LLM call and parse are wrapped in try/catch: every error path — network failure,
 * empty reply, unparseable JSON, verdict outside {done,not-done} — resolves to
 * verdict: 'not-done' with rationale: 'judge-inconclusive: ${reason}'.
 *
 * Every path persists exactly once via recordCampaignCompletion and returns that record.
 */
export async function judgeCampaignCompletion(
  project: string,
  campaignId: string,
  opts: JudgeCampaignOpts,
): Promise<CampaignCompletionRecord> {
  // Read state synchronously — these are outside the try/catch so a genuine
  // store failure surfaces as a throw, not a silent not-done.
  const campaign = getCampaign(project, campaignId);
  if (!campaign) {
    throw new Error(`campaign not found: ${campaignId}`);
  }

  const probes = listProbes(project, campaignId);
  const verdictsByProbe = new Map<string, ProbeVerdictRecord[]>();
  for (const probe of probes) {
    verdictsByProbe.set(probe.id, listProbeVerdicts(project, probe.id));
  }

  // Build the prompt from the read state.
  const { system, user } = buildCompletionPrompt(campaign, probes, verdictsByProbe);

  // Call the LLM and parse the response. Every error path becomes not-done.
  let verdict: 'done' | 'not-done' = 'not-done';
  let rationale = '';

  try {
    const reply = await opts.llm.complete(system, user);

    if (!reply || !reply.trim()) {
      throw new Error('empty reply from judge');
    }

    // Extract the first JSON object from the reply, tolerating prose or markdown fences.
    const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
    if (!jsonMatch) {
      throw new Error('no JSON object found in judge reply');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.verdict !== 'done' && parsed.verdict !== 'not-done') {
      throw new Error(`invalid verdict: ${parsed.verdict}`);
    }

    verdict = parsed.verdict;
    rationale = parsed.rationale || `judge ruled: ${verdict}`;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    verdict = 'not-done';
    rationale = `judge-inconclusive: ${reason}`;
  }

  // Persist exactly once and return the stored record.
  return recordCampaignCompletion(project, {
    campaignId,
    judge: opts.judge,
    verdict,
    ruledAtSha: opts.ruledAtSha,
    rationale,
  });
}
