/**
 * conductor-verify-panel-arm — the conductor's auto-fire arm for EVERY verify-action criterion.
 *
 * For every criterion with action === 'verify', this arm spawns the panel runner
 * DETERMINISTICALLY in the conductor pass itself, BEFORE any conductor node is invoked.
 * classifyVerifyStakes decides how many distinct-model lenses that run uses: 1 lens
 * (checkerCount) on the default low-stakes path, 3 distinct-model lenses when the criterion
 * is high-stakes (land-reopened, contested-carded, or serve-burning). Both levels go through
 * the SAME panel plumbing — there is no separate single-checker code path. Criteria whose
 * panel run finishes with unchanged-sha (already verified at this sha) are recorded and fall
 * through as skipped; the conductor's expensive node is never spent on criteria already
 * known-verified.
 *
 * Fail OPEN: one panel run fault must not sink the pass, and an unresolved criterion must not
 * be miscounted as held (which implies the panel positively recorded not-met). A throw lands
 * in skipped; a panel run that yields only skipped falls through so the pass proceeds as normal.
 */
import { listCriteriaWithActions } from './mission-store.js';
import { collectVerifyStakesInput } from './criterion-verify-facts.js';
import { classifyVerifyStakes } from './criterion-verify-stakes.js';
import { runCriterionVerifyPanel, type RunPanelDeps } from './criterion-verify-panel-runner.js';
import { listOpenEscalations, type Escalation } from './supervisor-store.js';
import { CONDUCTOR_VERIFY_BATCH_MAX } from './harness-caps.js';

export interface VerifyPanelArmDeps {
  /** Panel runner: resolves criterion, classifies stakes, spawns lenses in parallel,
   *  records verdicts via set_mission_criterion. Defaults to runCriterionVerifyPanel. */
  runPanel?: typeof runCriterionVerifyPanel;
  /** Retained for shape parity with sibling arms (conductor-infra-arm.ts); unused today. */
  listOpenEscalations?: () => Escalation[];
  /** Current HEAD sha for unchanged-sha guard. If omitted, headSha inside RunPanelDeps
   *  defaults to repo HEAD. */
  headSha?: () => string;
  /** Ceiling on how many verify-action criteria this pass will run through runPanel.
   *  Defaults to CONDUCTOR_VERIFY_BATCH_MAX. Injectable for tests without env vars. */
  batchMax?: number;
}

export interface VerifyPanelArmResult {
  /** Criterion ids whose panel run recorded a met verdict (all three lenses PASS by majority). */
  paneled: string[];
  /** Criterion ids whose panel run recorded a not-met verdict (majority FAIL or dissent).
   *  Excludes infra-degraded panels (no lens produced a parseable verdict) — those land in
   *  skipped instead, since held implies the panel positively recorded not-met. */
  held: string[];
  /** Criterion ids skipped (unchanged-sha, or panel run threw / degraded). */
  skipped: string[];
  /** Criterion ids NOT processed this pass because the batch ceiling was hit — explicitly
   *  deferred to a later pass, never silently dropped. They stay first in
   *  listCriteriaWithActions' stable order since they weren't advanced, so the next pass
   *  reaches them first once earlier criteria resolve to non-'verify' actions. */
  carried?: string[];
}

/**
 * Run the panel arm for one mission: auto-fire every high-stakes criterion's three-lens
 * verify panel, record the verdicts immediately, and report which criteria were resolved.
 *
 * Each criterion's panel run is handled in its own try/catch — one bad panel run must
 * never sink the pass (fail-open discipline matching conductor-infra-arm.ts:366-368).
 * A criterion whose panel run succeeds but returns skipped (unchanged-sha) is recorded
 * and falls through; the pass proceeds as normal (the conductor node is never spent on
 * already-known criteria).
 *
 * @param project — The project tracking root.
 * @param missionId — The mission whose verify criteria to panel.
 * @param session — The session context (accepted for shape parity; unused by this arm).
 * @param deps — Injectable IO (runPanel, headSha). All default to live implementations.
 * @returns { paneled, held, skipped } — criterion ids bucketed by outcome.
 */
export async function runVerifyPanelArm(
  project: string,
  missionId: string,
  session: string,
  deps: VerifyPanelArmDeps = {},
): Promise<VerifyPanelArmResult> {
  try {
    const runPanel = deps.runPanel ?? runCriterionVerifyPanel;

    // Criteria with action === 'verify': candidates for panel staging.
    const criteriaWithActions = listCriteriaWithActions(project, missionId);
    const verifyCriteria = criteriaWithActions.filter((c) => c.action === 'verify');

    if (verifyCriteria.length === 0) return { paneled: [], held: [], skipped: [], carried: [] };

    // Bound this pass to batchMax runPanel invocations; the rest carry to the next pass.
    // Positional slice over listCriteriaWithActions' stable order — no re-sorting.
    const batchMax = deps.batchMax ?? CONDUCTOR_VERIFY_BATCH_MAX;
    const toProcess = verifyCriteria.slice(0, batchMax);
    const carriedIds = verifyCriteria.slice(batchMax).map((c) => c.id);

    const result: VerifyPanelArmResult = { paneled: [], held: [], skipped: [], carried: carriedIds };

    // For each verify criterion, classify stakes and run panel if panel===true.
    for (const criterion of toProcess) {
      try {
        const stakes = classifyVerifyStakes(collectVerifyStakesInput(project, criterion.id));

        // Run the panel deterministically, before the conductor node, for EVERY
        // verify-action criterion — 1 lens on the default low-stakes path, 3 distinct-model
        // lenses when stakes.panel is true.
        try {
          const panelResult = await runPanel(project, criterion.id, {
            headSha: deps.headSha,
            lensCount: stakes.checkerCount,
          });

          // Bucket by outcome.
          if (panelResult.skipped) {
            result.skipped.push(criterion.id);
          } else if (panelResult.outcome === 'infra-degraded') {
            result.skipped.push(criterion.id);
          } else if (panelResult.met) {
            result.paneled.push(criterion.id);
          } else {
            result.held.push(criterion.id);
          }
        } catch {
          // fail-open: panel run threw (a lens node failed, a store error, etc.).
          // Never crash the pass. Record in skipped (not held, which implies the panel
          // ran and recorded not-met).
          result.skipped.push(criterion.id);
        }
      } catch {
        // fail-open per criterion: a classify/stakes throw must not sink the rest.
      }
    }

    return result;
  } catch {
    // fail-open outermost: the arm's body threw (listCriteriaWithActions failed, etc.).
    // Return a no-op result and let the pass continue.
    return { paneled: [], held: [], skipped: [], carried: [] };
  }
}
