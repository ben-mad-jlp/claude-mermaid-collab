/**
 * campaign-forge.ts — validate-then-write campaign forging with ref→id resolution.
 *
 * forgeCampaign validates the entire campaign before writing any row, and aggregates
 * every offending probe into one InvalidCampaignError. If validation passes, it assigns
 * pre-determined ids to probes and calls createCampaign once with ref-resolved dependsOn.
 *
 * The key invariant: createCampaign receives probes with both `id` and `dependsOn`
 * already resolved to real probe ids (never refs), so a partially-written campaign
 * is impossible (a single BEGIN/COMMIT).
 *
 * forgeCampaignFromGoal is an async sibling that optionally derives probes from a goal
 * statement using an LLM, allowing campaigns to be forged from ambiguous descriptions.
 */

import { randomUUID } from 'node:crypto';
import { validateCampaign, type ProbeForgeInput, type CampaignOffender } from './campaign-validate';
import { createCampaign, type CampaignRow, type ProbeInput } from './campaign-store';
import { deriveProbeSet, type DeriveResult } from './campaign-derive';
import type { JudgmentLLM } from './judgment-llm';

/**
 * Forge-time error: aggregates every offending probe and names them in the message.
 * No cap, no truncation tail (unlike UncitableMissionCriteriaError) — with two bad
 * probes both refs must be substrings of err.message.
 */
export class InvalidCampaignError extends Error {
  readonly code = 'invalid-campaign';

  constructor(public readonly offenders: CampaignOffender[]) {
    const offenderLines = offenders
      .map((o) => `  ${o.ref}: ${o.reason}`)
      .join('\n');
    super(`invalid-campaign: ${offenders.length} probe(s) failed validation:\n${offenderLines}`);
    this.name = 'InvalidCampaignError';
  }
}

/**
 * Forge-time error: thrown when a campaign has no probes and no goal to derive them from.
 * This is thrown before any store call, so no row is written.
 */
export class EmptyCampaignError extends Error {
  readonly code = 'empty-campaign';

  constructor(title: string) {
    super(`empty-campaign: campaign "${title}" has no probes and no goal to derive them from`);
    this.name = 'EmptyCampaignError';
  }
}

/**
 * Forge a campaign with validation-then-write and ref→id resolution.
 *
 * Strict order, no exceptions:
 * 0. If no probes are provided and no goal is given, throw EmptyCampaignError immediately.
 * 1. Validate the entire campaign via validateCampaign. If !verdict.ok, throw
 *    InvalidCampaignError immediately — zero rows are written.
 * 2. Pre-assign one randomUUID() per ProbeForgeInput, keyed by ref, building a
 *    Map<string,string> ref→id.
 * 3. Call createCampaign once with each probe mapped to { id, kind, environment,
 *    command, dependsOn: (p.dependsOn ?? []).map(ref => refToId.get(ref)!),
 *    declaredPaths }.
 *    The asserts field (if present) is stripped before handing the probe to the store.
 */
export function forgeCampaign(
  project: string,
  input: { title: string; goal?: string; probes?: ProbeForgeInput[] },
): CampaignRow {
  // Step 0: Reject empty campaigns before any store call.
  if (!input.probes || input.probes.length === 0) {
    throw new EmptyCampaignError(input.title);
  }

  // Step 1: Validate the entire campaign. If verdict fails, throw immediately
  // before any row is written.
  const verdict = validateCampaign(input as { title: string; goal?: string; probes: ProbeForgeInput[] });
  if (!verdict.ok) {
    throw new InvalidCampaignError(verdict.offenders);
  }

  // Step 2: Pre-assign probe ids, keyed by ref.
  const refToId = new Map<string, string>();
  for (const probe of input.probes) {
    refToId.set(probe.ref, randomUUID());
  }

  // Step 3: Call createCampaign once with ref-resolved dependsOn.
  // Each probe's asserts is stripped; only kind, environment, command,
  // resolved dependsOn, and declaredPaths are passed to the store.
  const storeProbes: ProbeInput[] = input.probes.map((p) => ({
    id: refToId.get(p.ref)!,
    kind: p.kind,
    environment: p.environment,
    command: p.command,
    dependsOn: (p.dependsOn ?? []).map((ref) => refToId.get(ref)!),
    declaredPaths: p.declaredPaths ?? [],
  }));

  return createCampaign(project, { title: input.title, goal: input.goal, probes: storeProbes });
}

/**
 * Result type for forgeCampaignFromGoal: either a forged campaign or a list of questions.
 */
export type ForgeCampaignResult =
  | { kind: 'campaign'; campaign: CampaignRow }
  | { kind: 'questions'; questions: string[] };

/**
 * Async entry point for forging a campaign, optionally deriving probes from a goal.
 *
 * Three arms in order:
 * 1. If probes are supplied, forge synchronously via forgeCampaign (same path as always).
 * 2. If no probes but a goal exists and an LLM is provided, derive the probes and
 *    forge them through the same validate→refToId→createCampaign path.
 * 3. Otherwise, throw EmptyCampaignError before touching the store.
 *
 * Derived probes are validated the same way supplied ones are, so an invalid derivation
 * raises InvalidCampaignError and writes nothing.
 */
export async function forgeCampaignFromGoal(
  project: string,
  input: { title: string; goal?: string; probes?: ProbeForgeInput[] },
  opts?: { llm?: JudgmentLLM },
): Promise<ForgeCampaignResult> {
  // Arm 1: Probes supplied.
  if (input.probes?.length) {
    return {
      kind: 'campaign',
      campaign: forgeCampaign(project, input as { title: string; goal?: string; probes: ProbeForgeInput[] }),
    };
  }

  // Arm 2: No probes, but goal and LLM are available.
  if (input.goal?.trim() && opts?.llm) {
    const derived = await deriveProbeSet(input.goal, { llm: opts.llm });

    if (derived.kind === 'probes') {
      // Derived probes go through the SAME validation path as supplied ones.
      return {
        kind: 'campaign',
        campaign: forgeCampaign(project, {
          title: input.title,
          goal: input.goal,
          probes: derived.probes,
        }),
      };
    }

    // Derivation returned questions, not probes — no store call.
    return {
      kind: 'questions',
      questions: derived.questions,
    };
  }

  // Arm 3: No probes, no goal, or no LLM.
  throw new EmptyCampaignError(input.title);
}
