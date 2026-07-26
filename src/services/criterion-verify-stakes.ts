/**
 * criterion-verify-stakes — pure classifier for high-stakes criterion verification.
 * When a criterion's evidence may be contested (land-reopened, human-objected,
 * or burning through serving epics), the verify process escalates to a panel
 * (multiple independent checkers) instead of a single verdict.
 */

import { CRITERION_PANEL_SERVE_THRESHOLD } from './harness-caps.ts';

export type VerifyStakesTrigger = 'reopened-by-land' | 'contested-card' | 'serve-burn';

export const HIGH_STAKES_TRIGGERS: readonly VerifyStakesTrigger[] = [
  'reopened-by-land',
  'contested-card',
  'serve-burn',
];

/** Escalation kinds that indicate a human or conductor is contesting this
 *  criterion's work (OPEN decision/blocker cards mean active dispute). */
export const CONTESTED_CARD_KINDS: readonly string[] = ['decision', 'blocker'];

export const PANEL_CHECKER_COUNT = 3;

export interface VerifyStakesInput {
  /** Count of land-driven reopens (MissionCriterion.reopenCount). */
  reopenCount: number;
  /** The landedSha of the most recent reopen, or null. */
  lastReopenSha: string | null;
  /** The reason column of the criterion's mission_recheck row, or null
   *  when there is no pending recheck. */
  pendingRecheckReason: string | null;
  /** LIFETIME count of serving epics for this criterion (MissionCriterionFacts.servedEpicCount). */
  servedEpicCount: number;
  /** Open escalation kinds for this criterion (e.g. ['decision', 'blocker']). */
  openCardKinds: readonly string[];
}

export interface VerifyStakesResult {
  /** True when a high-stakes trigger fired — panel review is activated. */
  panel: boolean;
  /** Which trigger matched (if panel===true), or null. */
  trigger: VerifyStakesTrigger | null;
  /** Number of independent checkers to use: PANEL_CHECKER_COUNT on panel===true,
   *  1 on the default (no-trigger) path. */
  checkerCount: number;
}

export function classifyVerifyStakes(input: VerifyStakesInput): VerifyStakesResult {
  // Defensive: treat non-finite / negative counts as 0.
  const reopenCount = Number.isFinite(input.reopenCount) && input.reopenCount >= 0 ? input.reopenCount : 0;
  const servedEpicCount = Number.isFinite(input.servedEpicCount) && input.servedEpicCount >= 0 ? input.servedEpicCount : 0;

  // First match wins in HIGH_STAKES_TRIGGERS order.

  // 1. reopened-by-land: A land has invalidated the previous evidence.
  if (
    input.pendingRecheckReason === 'land-diff-intersects-evidence' ||
    (reopenCount > 0 && input.lastReopenSha != null)
  ) {
    return { panel: true, trigger: 'reopened-by-land', checkerCount: PANEL_CHECKER_COUNT };
  }

  // 2. contested-card: A human/conductor is actively disputing this criterion.
  if (input.openCardKinds.some((k) => CONTESTED_CARD_KINDS.includes(k))) {
    return { panel: true, trigger: 'contested-card', checkerCount: PANEL_CHECKER_COUNT };
  }

  // 3. serve-burn: The criterion is approaching CRITERION_SERVE_CAP.
  if (servedEpicCount >= CRITERION_PANEL_SERVE_THRESHOLD) {
    return { panel: true, trigger: 'serve-burn', checkerCount: PANEL_CHECKER_COUNT };
  }

  // No trigger matched — default single-checker path.
  return { panel: false, trigger: null, checkerCount: 1 };
}
