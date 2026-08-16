/**
 * campaign-completion-judge.ts — LLM-based campaign completion verdict via panel of lenses.
 *
 * The judge is the first place in the campaign layer where an LLM rules on anything;
 * every existing campaign verdict is arithmetic over probe exit codes. The whole point
 * is that it can only ever *close* a campaign on an explicit, well-formed `done` —
 * every other outcome (throw, empty reply, garbage, out-of-union verdict) becomes a
 * stored `not-done`, so an inconclusive judge leaves the campaign running.
 *
 * A panel of independent lenses inspects the campaign from different angles and votes.
 * The verdict is 'done' only when at least two lenses vote 'done'; otherwise 'not-done'.
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
  type CompletionLensInput,
  type CompletionVerdict,
} from './campaign-store.ts';

export interface JudgeCampaignOpts {
  llm: JudgmentLLM;
  judge: string;
  ruledAtSha: string;
  artifactsRead?: string[];
}

/**
 * A lens is an independent perspective on campaign completion.
 * Each lens focuses on a different aspect of the evidence.
 */
export interface CampaignLens {
  name: string;
  focus: string;
}

/**
 * A lens's examination: the verdict it reached, its reasoning,
 * and the artifacts and commands it consulted.
 */
export interface LensExamination {
  verdict: CompletionVerdict;
  reasoning: string;
  artifactsRead: string[];
  commandsRun: string[];
}

/**
 * Panel of three lenses that independently assess campaign completion.
 * Each lens focuses on a different object of inspection:
 * - goal-met: does the goal text match the probe results?
 * - evidence-quality: are the recorded verdicts and evidence reliable?
 * - refuter: what is the strongest case that the goal is NOT met?
 */
export const CAMPAIGN_LENSES: readonly CampaignLens[] = [
  {
    name: 'goal-met',
    focus: 'Examine whether the campaign goal (the stated objective) is actually satisfied by the recorded probe results. Does the goal text match what the probes demonstrate?',
  },
  {
    name: 'evidence-quality',
    focus: 'Examine the provenance and reliability of the recorded verdicts. Are the verdicts credible? Is there evidence backing each verdict? When was each verdict recorded and on what commit?',
  },
  {
    name: 'refuter',
    focus: 'Construct the strongest possible case that the campaign goal is NOT met. What facts or absences would prove the goal is unmet? Does that case hold up?',
  },
] as const;

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
{"verdict":"done"|"not-done","rationale":string,"artifactsRead":string[],"commandsRun":string[]}

Rules:
- Green probes are necessary but not sufficient — the goal is what is being judged.
- A campaign with no goal cannot be ruled done.
- If you cannot determine completeness with confidence, respond with "not-done".
- List the artifacts you read (file paths, logs, etc.) in artifactsRead and the commands you examined in commandsRun. Name what you examined.`;

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
 * Build a per-lens prompt by combining the shared completion context
 * with the lens identity and focus. The lens name and focus appear in both
 * system and user strings so an LLM can branch on the lens name if needed.
 */
export function buildLensPrompt(
  lens: CampaignLens,
  campaign: CampaignRow,
  probes: CampaignProbe[],
  verdictsByProbe: Map<string, ProbeVerdictRecord[]>,
): { system: string; user: string } {
  const { system: sharedSystem, user: sharedUser } = buildCompletionPrompt(campaign, probes, verdictsByProbe);

  const lensContext = `

LENS: ${lens.name}
FOCUS: ${lens.focus}`;

  const system = sharedSystem + lensContext;
  const user = sharedUser + lensContext;

  return { system, user };
}

/**
 * Gather and deduplicate the examined evidence from probes and lenses.
 * Returns a pure aggregation of all artifacts read and commands run by the judge.
 *
 * Order is: seed artifacts, then probe references (probe:<id> for each probe shown),
 * then evidence from probe verdicts, then lens-reported artifacts; similarly for commands.
 * Duplicates are removed preserving first-seen order; blank/whitespace entries are dropped.
 */
export function gatherExaminedEvidence(
  lensExaminations: LensExamination[],
  probes: CampaignProbe[],
  verdictsByProbe: Map<string, ProbeVerdictRecord[]>,
  opts: JudgeCampaignOpts,
): { artifactsRead: string[]; commandsRun: string[] } {
  const seen = new Set<string>();
  const artifactsRead: string[] = [];
  const commandsRun: string[] = [];

  const addArtifact = (a: string) => {
    const trimmed = a.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      artifactsRead.push(trimmed);
    }
  };

  const addCommand = (c: string) => {
    const trimmed = c.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      commandsRun.push(trimmed);
    }
  };

  // Seed with optional caller-supplied artifacts.
  if (opts.artifactsRead) {
    for (const a of opts.artifactsRead) {
      addArtifact(a);
    }
  }

  // Add probe references for every probe shown to the judge.
  for (const probe of probes) {
    addArtifact(`probe:${probe.id}`);
  }

  // Add evidence from every probe verdict recorded.
  for (const probe of probes) {
    const verdicts = verdictsByProbe.get(probe.id) || [];
    for (const verdict of verdicts) {
      if (verdict.evidence) {
        addArtifact(verdict.evidence);
      }
    }
  }

  // Add commands from every probe shown to the judge.
  for (const probe of probes) {
    if (probe.command) {
      addCommand(probe.command);
    }
  }

  // Add lens-reported evidence.
  for (const exam of lensExaminations) {
    for (const a of exam.artifactsRead) {
      addArtifact(a);
    }
    for (const c of exam.commandsRun) {
      addCommand(c);
    }
  }

  return { artifactsRead, commandsRun };
}

/**
 * Pure function that rules on a panel of lens verdicts.
 * Returns 'done' only when at least two lenses vote 'done'; otherwise 'not-done'.
 * The rationale names the concurring and dissenting lenses and embeds each lens's
 * reasoning verbatim.
 */
export function rulePanel(lensVerdicts: CompletionLensInput[]): { verdict: CompletionVerdict; rationale: string } {
  const doneVerdicts = lensVerdicts.filter((lv) => lv.verdict === 'done');
  const notDoneVerdicts = lensVerdicts.filter((lv) => lv.verdict === 'not-done');

  const verdict: CompletionVerdict = doneVerdicts.length >= 2 ? 'done' : 'not-done';

  const doneNames = doneVerdicts.map((lv) => lv.lens).join(', ');
  const notDoneNames = notDoneVerdicts.map((lv) => lv.lens).join(', ');

  const reasoningLines = lensVerdicts.map((lv) => `  ${lv.lens}: ${lv.reasoning || '(no reasoning provided)'}`).join('\n');

  let rationale = `Panel ruled: ${verdict}\nConcurring lenses: ${doneNames || '(none)'}\nDissenting lenses: ${notDoneNames || '(none)'}\n\nLens reasoning:\n${reasoningLines}`;

  return { verdict, rationale };
}

/**
 * Judge a campaign's completion status via a panel of lenses.
 * Reads campaign state, builds a prompt, calls the injected LLM once per lens,
 * and persists the verdict.
 *
 * Store reads (getCampaign, listProbes, listProbeVerdicts) run outside the try/catch
 * so a genuine store failure surfaces as a throw rather than becoming a silent not-done.
 *
 * Each lens's LLM call and parse are wrapped in their own try/catch: every error path —
 * network failure, empty reply, unparseable JSON, verdict outside {done,not-done} —
 * resolves to verdict: 'not-done' with reasoning: 'judge-inconclusive: ${reason}'.
 *
 * All lens verdicts (including dissenters and inconclusive lenses) are passed to rulePanel,
 * which votes based on the majority of 'done' verdicts (>=2 required).
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

  // Call the judge once per lens. Each lens is evaluated independently;
  // failing lenses degrade to not-done rather than failing the whole pass.
  const lensVerdicts: CompletionLensInput[] = [];
  const lensExaminations: LensExamination[] = [];

  for (const lens of CAMPAIGN_LENSES) {
    const { system, user } = buildLensPrompt(lens, campaign, probes, verdictsByProbe);

    let lensVerdict: CompletionVerdict = 'not-done';
    let lensReasoning = '';
    let lensArtifactsRead: string[] = [];
    let lensCommandsRun: string[] = [];

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

      lensVerdict = parsed.verdict;
      lensReasoning = parsed.rationale || `${lens.name} ruled: ${lensVerdict}`;

      // Parse examination evidence: keep only string entries, default to empty array.
      if (Array.isArray(parsed.artifactsRead)) {
        lensArtifactsRead = parsed.artifactsRead.filter((e: any) => typeof e === 'string');
      }
      if (Array.isArray(parsed.commandsRun)) {
        lensCommandsRun = parsed.commandsRun.filter((e: any) => typeof e === 'string');
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      lensVerdict = 'not-done';
      lensReasoning = `judge-inconclusive: ${reason}`;
      // On error, examination evidence remains empty
    }

    lensVerdicts.push({
      lens: lens.name,
      verdict: lensVerdict,
      reasoning: lensReasoning,
    });

    lensExaminations.push({
      verdict: lensVerdict,
      reasoning: lensReasoning,
      artifactsRead: lensArtifactsRead,
      commandsRun: lensCommandsRun,
    });
  }

  // Apply the panel rule: done only at >=2 done verdicts.
  const panelRuling = rulePanel(lensVerdicts);

  // Gather the examined evidence from probes and lenses, fail if empty.
  const { artifactsRead, commandsRun } = gatherExaminedEvidence(
    lensExaminations,
    probes,
    verdictsByProbe,
    opts,
  );

  // Persist exactly once and return the stored record, with the evidence the judge examined.
  // Do not catch recordCampaignCompletion's refusal on empty evidence — let it throw.
  return recordCampaignCompletion(project, {
    campaignId,
    judge: opts.judge,
    verdict: panelRuling.verdict,
    ruledAtSha: opts.ruledAtSha,
    rationale: panelRuling.rationale,
    lenses: lensVerdicts,
    artifactsRead,
    commandsRun,
  });
}
