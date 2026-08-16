/**
 * campaign-reconcile.ts — advance probes to pass when their linked mission's criteria are all met.
 *
 * The campaign reconcile pass is the return leg: when a mission forged from failing probes
 * converges (all its criteria are met), this module advances the linked probe(s) to 'pass'.
 */
import { execFileSync } from 'node:child_process';
import type { CampaignProbe } from './campaign-store';
import { listProbes, recordProbeVerdict } from './campaign-store';
import { getProbeMissionLink } from './campaign-pass';
import { listCriteria } from './mission-store';

/** Injectable dependencies for reconcileCampaignProbes. */
export interface CampaignReconcileDeps {
  /** List probes for a campaign. Defaults to the live listProbes implementation. */
  listProbes?: typeof listProbes;
  /** Get a probe's linked mission, or null. Defaults to the live getProbeMissionLink implementation. */
  getProbeMissionLink?: typeof getProbeMissionLink;
  /** List criteria for a mission. Defaults to the live listCriteria implementation. */
  listCriteria?: typeof listCriteria;
  /** Record a probe verdict. Defaults to the live recordProbeVerdict implementation. */
  recordProbeVerdict?: typeof recordProbeVerdict;
  /** Get the current commit sha. Defaults to running `git rev-parse HEAD` in the project. */
  commitSha?: () => string;
  /** Get the current time in milliseconds. Defaults to Date.now. */
  now?: () => number;
}

/** Result of reconcileCampaignProbes: partitions probes into advanced and unchanged. */
export interface CampaignReconcileResult {
  /** Probes whose verdict was advanced to 'pass'. */
  advanced: string[];
  /** Probes left unchanged (unlinked, unmet criteria, or errors). */
  unchanged: string[];
}

/**
 * Advance probes to pass when their linked mission's criteria are all met.
 *
 * For each probe in the campaign:
 * - If verdict is already 'pass', push to unchanged.
 * - If no link exists to a mission, push to unchanged.
 * - If the mission has zero criteria, push to unchanged (anti-vacuous).
 * - If any active criterion is unmet, push to unchanged.
 * - If all active (non-dropped) criteria are met:
 *   - Record the probe's verdict as 'pass' with the probe's own environment.
 *   - Push to advanced.
 *
 * Per-probe error handling: a throw in any step (link read, criteria list, verdict record)
 * lands that probe in unchanged and continues the loop (fail-open). Outermost try/catch
 * returns empty result on a catastrophic throw (e.g. database connection failure).
 */
export async function reconcileCampaignProbes(
  project: string,
  campaignId: string,
  deps?: CampaignReconcileDeps,
): Promise<CampaignReconcileResult> {
  try {
    const listProbesFn = deps?.listProbes ?? listProbes;
    const getLinkFn = deps?.getProbeMissionLink ?? getProbeMissionLink;
    const listCriteriaFn = deps?.listCriteria ?? listCriteria;
    const recordVerdictFn = deps?.recordProbeVerdict ?? recordProbeVerdict;
    const getCommitSha = deps?.commitSha ?? (() => {
      try {
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: project,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        return sha || 'unknown';
      } catch {
        return 'unknown';
      }
    });
    const getNow = deps?.now ?? (() => Date.now());

    const advanced: string[] = [];
    const unchanged: string[] = [];

    const probes = listProbesFn(project, campaignId);

    for (const probe of probes) {
      try {
        // Step 1: Skip probes already at pass.
        if (probe.verdict === 'pass') {
          unchanged.push(probe.id);
          continue;
        }

        // Step 2: Get the probe's mission link.
        const link = getLinkFn(project, probe.id);
        if (!link) {
          unchanged.push(probe.id);
          continue;
        }

        // Step 3: Get the mission's criteria.
        const criteria = listCriteriaFn(project, link.missionId);

        // Anti-vacuous guard: require a non-empty criteria list AND at least one non-dropped criterion.
        if (criteria.length === 0) {
          unchanged.push(probe.id);
          continue;
        }

        const active = criteria.filter((c) => c.status !== 'dropped');
        if (active.length === 0) {
          unchanged.push(probe.id);
          continue;
        }

        // Step 4: Advance only when every active criterion is met.
        if (!active.every((c) => c.met === true)) {
          unchanged.push(probe.id);
          continue;
        }

        // Step 5: Record the probe's verdict as 'pass'.
        const commitSha = getCommitSha();
        const evidence = `mission ${link.missionId}: ${active.length} criteria met`;
        recordVerdictFn(project, {
          probeId: probe.id,
          verdict: 'pass',
          environment: probe.environment,
          commitSha,
          evidence,
        });

        advanced.push(probe.id);
      } catch {
        // Per-probe error: land in unchanged and continue the loop.
        unchanged.push(probe.id);
      }
    }

    return { advanced, unchanged };
  } catch {
    // Outermost catch: catastrophic failure — return empty result.
    return { advanced: [], unchanged: [] };
  }
}
