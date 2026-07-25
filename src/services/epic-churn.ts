import { EPIC_CHURN_REJECT_THRESHOLD } from './harness-caps';
import type { LeafRunSummary } from './ledger-stats';

export interface EpicOutcomeSummary {
  rejectedCount: number;
  blockedCount: number;
  acceptedCount: number;
  distinctReasons: string[];
}

/** Normalize a reason string by trimming, lowercasing, collapsing whitespace runs to
 *  single spaces, and replacing hex sha/uuid tokens with `<sha>`. Returns null when
 *  the normalized result is empty. */
export function normaliseReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toLowerCase();
  if (!trimmed) return null;
  const collapsed = trimmed.replace(/\s+/g, ' ');
  const withShasNormalized = collapsed.replace(/\b[0-9a-f]{7,40}\b/g, '<sha>');
  return withShasNormalized || null;
}

/** Summarize leaf run outcomes by rejection/block/accept counts and deduplicated
 *  reasons (from rejected+blocked leaves only). Order of distinctReasons is
 *  first-seen (stable for diffable prompts). */
export function summariseEpicOutcomes(runs: LeafRunSummary[]): EpicOutcomeSummary {
  let rejectedCount = 0;
  let blockedCount = 0;
  let acceptedCount = 0;
  const reasonSet = new Map<string, boolean>(); // tracks first-seen order
  const reasonOrder: string[] = [];

  for (const r of runs) {
    if (r.finalOutcome === 'rejected') {
      rejectedCount += 1;
      const normalized = normaliseReason(r.reason);
      if (normalized && !reasonSet.has(normalized)) {
        reasonSet.set(normalized, true);
        reasonOrder.push(normalized);
      }
    } else if (r.finalOutcome === 'blocked') {
      blockedCount += 1;
      const normalized = normaliseReason(r.reason);
      if (normalized && !reasonSet.has(normalized)) {
        reasonSet.set(normalized, true);
        reasonOrder.push(normalized);
      }
    } else if (r.finalOutcome === 'accepted') {
      acceptedCount += 1;
    }
  }

  return {
    rejectedCount,
    blockedCount,
    acceptedCount,
    distinctReasons: reasonOrder,
  };
}

export type EpicChurnInput = { runs: LeafRunSummary[] } | EpicOutcomeSummary;

/** Detect if an epic is churning (producing rejection loops). Churning when
 *  rejected + blocked >= threshold AND zero accepted leaves (proof the epic is
 *  producing rules out churn regardless of rejection count). */
export function detectEpicChurn(input: EpicChurnInput): {
  churning: boolean;
  rejectedCount: number;
  acceptedCount: number;
  distinctReasons: string[];
} {
  const summary = 'runs' in input ? summariseEpicOutcomes(input.runs) : input;
  const churning =
    summary.rejectedCount + summary.blockedCount >= EPIC_CHURN_REJECT_THRESHOLD &&
    summary.acceptedCount === 0;
  return {
    churning,
    rejectedCount: summary.rejectedCount,
    acceptedCount: summary.acceptedCount,
    distinctReasons: summary.distinctReasons,
  };
}

/** Build a prompt fragment guiding decomposition to avoid prior rejection patterns.
 *  Computes a ceiling strictly below priorLeafCount and lists distinct reasons to avoid. */
export function buildTighterDecompositionHint(input: {
  priorEpicTitle: string;
  priorLeafCount: number;
  distinctReasons: string[];
}): string {
  // maxLeaves = Math.max(1, Math.min(priorLeafCount - 1, Math.ceil(priorLeafCount / 2)))
  // This ensures maxLeaves < priorLeafCount for every priorLeafCount >= 2.
  // When priorLeafCount <= 1, the result clamps to 1 (no smaller decomposition exists).
  const maxLeaves = Math.max(
    1,
    Math.min(input.priorLeafCount - 1, Math.ceil(input.priorLeafCount / 2)),
  );

  const reasonsText =
    input.distinctReasons.length > 0
      ? input.distinctReasons.map((r) => `- ${r}`).join('\n')
      : '- (no recorded rejection reasons)';

  return `The prior epic "${input.priorEpicTitle}" (${input.priorLeafCount} leaves) has been rejected repeatedly. Decompose into strictly smaller, single-concern leaves — each addressing ONE file or ONE invariant only. at most ${maxLeaves} leaves in the new epic.

Reasons to avoid repeating:
${reasonsText}`;
}
