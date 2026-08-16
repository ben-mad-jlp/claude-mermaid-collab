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
 */

import { randomUUID } from 'node:crypto';
import { validateCampaign, type ProbeForgeInput, type CampaignOffender } from './campaign-validate';
import { createCampaign, type CampaignRow, type ProbeInput } from './campaign-store';

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
 * Forge a campaign with validation-then-write and ref→id resolution.
 *
 * Strict order, no exceptions:
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
  input: { title: string; probes: ProbeForgeInput[] },
): CampaignRow {
  // Step 1: Validate the entire campaign. If verdict fails, throw immediately
  // before any row is written.
  const verdict = validateCampaign(input);
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

  return createCampaign(project, { title: input.title, probes: storeProbes });
}
