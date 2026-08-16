/**
 * campaign-scheduling.ts — Throttle + project-level fan-out runner for the campaign pass.
 *
 * Supplies the two things the daemon needs to call the landed campaign pass with a single
 * argument: a per-project throttle clock, and a fan-out runner over every campaign of a project.
 *
 * Modeled on repair-mission-pass.ts:25-50 throttle pattern, with campaign-specific naming
 * and the documented repair-forge-family cadence (5 minutes).
 */

import { listCampaigns } from './campaign-store.js';
import { runCampaignPass, type CampaignPassResult, type CampaignPassDeps } from './campaign-pass.js';

/** Minimum spacing between campaign passes for a single project. */
export const CAMPAIGN_PASS_INTERVAL_MS = 300_000; // 5 min

/** Default session id when the caller passes none (mirrors REPAIR_FORGE_SESSION). */
export const CAMPAIGN_PASS_SESSION = '__auto_campaign_pass__';

/** Module-local throttle map, not exported. */
const lastCampaignPassMs = new Map<string, number>();

/**
 * Throttle gate for runCampaignPassForProject. Returns true (and stamps the map as a side
 * effect) when the pass is due for `project`; false while a previous run is within
 * CAMPAIGN_PASS_INTERVAL_MS. First call for a project always runs. `now` is injectable
 * for deterministic tests.
 *
 * Side effect: a `true` return stamps the map; a `false` return does not advance the clock.
 */
export function shouldRunCampaignPass(project: string, now: number = Date.now()): boolean {
  const last = lastCampaignPassMs.get(project);
  if (last !== undefined && now - last < CAMPAIGN_PASS_INTERVAL_MS) return false;
  lastCampaignPassMs.set(project, now);
  return true;
}

/**
 * Test seam: clear the per-project throttle clock (all projects, or one).
 */
export function _resetCampaignPassThrottle(project?: string): void {
  if (project === undefined) lastCampaignPassMs.clear();
  else lastCampaignPassMs.delete(project);
}

/** Injectable dependencies for runCampaignPassForProject. */
export interface CampaignSchedulingDeps {
  /** List campaigns for a project. Default: listCampaigns. */
  listCampaigns?: typeof listCampaigns;
  /** Run the campaign pass for one campaign. Default: runCampaignPass. */
  runCampaignPass?: typeof runCampaignPass;
  /** Injectable dependencies for runCampaignPass. */
  passDepsFn?: (project: string, campaignId: string, session: string) => CampaignPassDeps;
}

/**
 * Run the campaign pass for every campaign of a project, sequentially with await.
 *
 * Reads the campaign rows, iterates sequentially, and wraps each await in its own try/catch.
 * On a throw: console.warn naming project + campaign id + the error, then continue to the
 * next campaign. The arrays stay index-aligned: campaigns collects ids whose pass resolved;
 * a thrown campaign contributes to neither array but does not stop the loop. A throw out of
 * listCampaigns itself yields { campaigns: [], results: [] }.
 *
 * Front derivation, grouping, and forging remain owned by the landed runCampaignPass in
 * campaign-pass.ts; this module only schedules and fans out.
 *
 * @param project The project path.
 * @param opts Optional overrides: session (default: CAMPAIGN_PASS_SESSION), deps (test seams).
 * @returns An object with campaigns (list of ids that resolved) and results (their outcomes).
 */
export async function runCampaignPassForProject(
  project: string,
  opts?: { session?: string; deps?: CampaignSchedulingDeps },
): Promise<{ campaigns: string[]; results: CampaignPassResult[] }> {
  const session = opts?.session ?? CAMPAIGN_PASS_SESSION;
  const deps = opts?.deps ?? {};

  const listCampaignsFn = deps.listCampaigns ?? listCampaigns;
  const runCampaignPassFn = deps.runCampaignPass ?? runCampaignPass;
  const passDepsFn = deps.passDepsFn ?? ((_p: string, _cid: string, _s: string) => ({}));

  const campaigns: string[] = [];
  const results: CampaignPassResult[] = [];

  try {
    const campaignRows = listCampaignsFn(project);

    // Iterate sequentially with await, wrapping each in try/catch for fail-open per-campaign.
    for (const row of campaignRows) {
      try {
        const passResult = await runCampaignPassFn(project, row.id, session, passDepsFn(project, row.id, session));
        campaigns.push(row.id);
        results.push(passResult);
      } catch (err) {
        // Fail-open: one campaign's failure doesn't stop the loop.
        console.warn(
          `campaign pass failed for project ${project} campaign ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    // Fail-open: a throw from listCampaigns yields empty result.
    console.warn(
      `campaign pass failed to list campaigns for project ${project}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { campaigns: [], results: [] };
  }

  return { campaigns, results };
}
