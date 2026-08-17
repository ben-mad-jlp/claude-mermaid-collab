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
import { NODE_PROFILE } from './leaf-node-profile.ts';
import { resolveNodeProvider, resolveNodeModel } from './node-provider.ts';

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
  lens: string;
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
 * Build the system and user prompts for the campaign completion commander.
 * The commander reads the lens arguments (verdict, reasoning, evidence) and rules on the strength
 * of the arguments, not by vote count. One well-argued dissent can defeat concurring lenses.
 *
 * The system instructs the commander to respond with a JSON object containing:
 * - verdict: 'done' | 'not-done'
 * - rationale: string (the commander's reasoning)
 * - citedLenses: string[] (names of lenses the commander relied on)
 *
 * The user prompt contains the campaign goal (verbatim) and, per lens, the lens name,
 * verdict, full reasoning, and the artifacts/commands examined.
 */
export function buildCommanderPrompt(
  campaign: CampaignRow,
  lensExaminations: LensExamination[],
): { system: string; user: string } {
  const system = `You are a COMMANDER ruling on campaign completion based on the lens arguments presented to you.

Respond with a single JSON object in this format:
{"verdict":"done"|"not-done","rationale":string,"citedLenses":string[]}

Rules:
- The verdict is decided by the STRENGTH OF THE ARGUMENTS, not by vote count or majority rule.
- One well-argued dissent can defeat concurring lenses if the dissent's reasoning is sound.
- The commander rules on the quality of the evidence and reasoning, not on how many lenses voted one way.
- The rationale must explain WHY you ruled as you did, citing the lens arguments that drove your decision.
- citedLenses should name only those lens names whose arguments you actually relied on in your reasoning.
- If you cannot determine completeness with confidence, respond with "not-done".`;

  const goalSection = campaign.goal
    ? `Campaign Goal:
${campaign.goal}`
    : `Campaign Goal: (none — a goalless campaign cannot be ruled done)`;

  // Build the lens arguments section.
  const lensArguments = lensExaminations
    .map((exam) => {
      const artifactsSection = exam.artifactsRead.length > 0
        ? `\n  Artifacts Read: ${exam.artifactsRead.join(', ')}`
        : '';
      const commandsSection = exam.commandsRun.length > 0
        ? `\n  Commands Run: ${exam.commandsRun.join(', ')}`
        : '';

      return `Lens: ${exam.lens}
  Verdict: ${exam.verdict}
  Reasoning: ${exam.reasoning || '(no reasoning provided)'}${artifactsSection}${commandsSection}`;
    })
    .join('\n\n');

  const user = `${goalSection}

Lens Arguments:
${lensArguments}

Based on the lens arguments above, rule on whether this campaign is complete.`;

  return { system, user };
}

/**
 * Resolve the commander node's model and effort from NODE_PROFILE.
 * Reads NODE_PROFILE.commander and resolves through the provider/model chain.
 */
export function resolveCommanderProfile(
  project?: string,
): { provider: string; model: string; effort: string } {
  const profile = NODE_PROFILE.commander;
  const provider = resolveNodeProvider(project, 'commander', profile.allowedTools);
  const model = resolveNodeModel(project, 'commander', provider as any, profile.model);
  return { provider, model, effort: profile.effort };
}

/**
 * Rule on campaign completion based on lens arguments via the commander LLM.
 * The commander reads the full lens arguments (verdict, reasoning, evidence) and rules
 * on the strength of the reasoning, not by vote count.
 *
 * Returns { verdict, rationale, citedLenses, model }. On any error (throw, empty reply,
 * unparseable JSON, out-of-union verdict), degrades to verdict 'not-done' with rationale
 * 'judge-inconclusive: ${reason}' and empty citedLenses.
 */
export async function ruleByCommander(
  lensExaminations: LensExamination[],
  opts: {
    llm: JudgmentLLM;
    project?: string;
    campaign: CampaignRow;
  },
): Promise<{ verdict: CompletionVerdict; rationale: string; citedLenses: string[]; model: string }> {
  const profile = resolveCommanderProfile(opts.project);
  const { system, user } = buildCommanderPrompt(opts.campaign, lensExaminations);

  try {
    const reply = await opts.llm.complete(system, user);

    if (!reply || !reply.trim()) {
      throw new Error('empty reply from commander');
    }

    // Extract the first JSON object from the reply, tolerating prose or markdown fences.
    const jsonMatch = reply.match(/\{[^{}]*(?:"[^"]*"[^{}]*)*\}/);
    if (!jsonMatch) {
      throw new Error('no JSON object found in commander reply');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.verdict !== 'done' && parsed.verdict !== 'not-done') {
      throw new Error(`invalid verdict: ${parsed.verdict}`);
    }

    // Keep only lens names that actually exist in lensExaminations.
    const validLensNames = new Set(lensExaminations.map((e) => e.lens));
    const citedLenses: string[] = [];
    if (Array.isArray(parsed.citedLenses)) {
      for (const name of parsed.citedLenses) {
        if (typeof name === 'string' && validLensNames.has(name)) {
          citedLenses.push(name);
        }
      }
    }

    return {
      verdict: parsed.verdict,
      rationale: parsed.rationale || `commander ruled: ${parsed.verdict}`,
      citedLenses,
      model: profile.model,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      verdict: 'not-done',
      rationale: `judge-inconclusive: ${reason}`,
      citedLenses: [],
      model: profile.model,
    };
  }
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
 * Judge a campaign's completion status via a panel of lenses and a commander.
 * Reads campaign state, builds a prompt, calls the injected LLM once per lens,
 * then passes the lens arguments to the commander for a ruling, and persists the verdict.
 *
 * Store reads (getCampaign, listProbes, listProbeVerdicts) run outside the try/catch
 * so a genuine store failure surfaces as a throw rather than becoming a silent not-done.
 *
 * Each lens's LLM call and parse are wrapped in their own try/catch: every error path —
 * network failure, empty reply, unparseable JSON, verdict outside {done,not-done} —
 * resolves to verdict: 'not-done' with reasoning: 'judge-inconclusive: ${reason}'.
 *
 * All lens verdicts (including dissenters and inconclusive lenses) are passed to the commander,
 * which reads the full arguments and rules on the strength of the reasoning, not by vote count.
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
      lens: lens.name,
      verdict: lensVerdict,
      reasoning: lensReasoning,
      artifactsRead: lensArtifactsRead,
      commandsRun: lensCommandsRun,
    });
  }

  // Rule by commander: the commander reads the lens arguments and rules on the strength of the reasoning.
  const commanderRuling = await ruleByCommander(lensExaminations, {
    llm: opts.llm,
    project: project,
    campaign,
  });

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
    verdict: commanderRuling.verdict,
    ruledAtSha: opts.ruledAtSha,
    rationale: commanderRuling.rationale,
    lenses: lensVerdicts,
    citedLenses: commanderRuling.citedLenses,
    artifactsRead,
    commandsRun,
  });
}
