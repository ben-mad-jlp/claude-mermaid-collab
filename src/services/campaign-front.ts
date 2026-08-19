/**
 * campaign-front.ts — derive the front of a campaign's dependency graph.
 *
 * The front is the set of probes that are ready to run: either not-run or failing,
 * whose dependencies have all passed. This is a pure derivation over the stored
 * dependency graph.
 */
import type { CampaignProbe, ProbeVerdict } from './campaign-store.ts';
import { listProbes } from './campaign-store.ts';

/**
 * Derive the front of a campaign's dependency graph.
 *
 * A probe is in the front iff:
 * 1. Its own verdict is 'not-run' or 'fail' (not 'pass'), AND
 * 2. Every probe it depends on (by id) exists in the input set and has verdict 'pass'.
 *
 * Input order is preserved in the output.
 *
 * @param probes The set of campaign probes to filter.
 * @returns The probes in the front, in input order.
 */
export function deriveFront(probes: CampaignProbe[]): CampaignProbe[] {
  // Build a map keyed by probe id for O(1) dependency resolution.
  const probeMap = new Map<string, CampaignProbe>();
  for (const probe of probes) {
    probeMap.set(probe.id, probe);
  }

  // Filter to probes that are ready to run: their own verdict is not 'pass',
  // and all their dependencies have passed. A missing dependency (undefined?.verdict)
  // is not 'pass', so the probe is excluded.
  return probes.filter((probe) =>
    probe.verdict !== 'pass' &&
    probe.dependsOn.every((id) => probeMap.get(id)?.verdict === 'pass')
  );
}

/**
 * Derive the front of a stored campaign.
 *
 * This is a convenience wrapper around deriveFront that reads the campaign's probes
 * from the store and returns their front.
 *
 * @param project The project root.
 * @param campaignId The campaign id.
 * @returns The probes in the front.
 */
export function campaignFront(project: string, campaignId: string): CampaignProbe[] {
  return deriveFront(listProbes(project, campaignId));
}

/**
 * Compute a deterministic fingerprint of the failing probes and their verdict shas.
 *
 * The fingerprint is used to debounce campaign convenes: if the failing set or any
 * probe's latest verdict sha changes, the fingerprint changes. The fingerprint is
 * computed from probe ids and verdict shas only; it never includes wall-clock or
 * insertion-order components.
 *
 * Empty input yields an empty string.
 *
 * @param failing The set of failing probes.
 * @param latestVerdictSha Callback to retrieve the latest verdict sha for a probe.
 *   Returns null if no verdict sha exists; this is rendered as 'none'.
 * @returns A pipe-delimited fingerprint string, lexicographically sorted by probe id.
 */
export function computeFrontFingerprint(
  failing: CampaignProbe[],
  latestVerdictSha: (probeId: string) => string | null,
): string {
  if (failing.length === 0) {
    return '';
  }

  // Sort a copy by id lexicographically.
  const sorted = [...failing].sort((a, b) => a.id.localeCompare(b.id));

  // Map each probe to `${id}@${sha ?? 'none'}` and join with |.
  const tokens = sorted.map((p) => `${p.id}@${latestVerdictSha(p.id) ?? 'none'}`);
  return tokens.join('|');
}
