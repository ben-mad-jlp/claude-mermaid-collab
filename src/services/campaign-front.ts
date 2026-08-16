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
