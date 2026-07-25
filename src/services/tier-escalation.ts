/**
 * Pure tier-escalation decision module — no DB, no async, no side effects.
 * Decides whether to escalate an implement model based on wall history.
 */

import { type LeafWallHistory, type WallReasonClass, isHardWall } from './leaf-wall-history';

export const TIER_CEILING_MODEL = 'opus';
export const MAX_TIER_BUMPS = 2;

export interface TierEscalationInput {
  wall: LeafWallHistory;
  currentModel: string;
  attempt: number;
}

export interface TierEscalationPlan {
  model: string;
  bumped: boolean;
  reason: string;
  atCeiling: boolean;
  ceilingWalled: boolean;
}

/** Map a Claude model to its next tier. Haiku→Sonnet, Sonnet→Opus, else unchanged. */
function nextTier(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('haiku')) {
    return 'sonnet';
  }
  if (lower.includes('sonnet')) {
    return 'opus';
  }
  return model;
}

export function planTierEscalation(input: TierEscalationInput): TierEscalationPlan {
  const { wall, currentModel, attempt } = input;

  // 1. Non-Claude lane short-circuit: grok and composer pass through unchanged
  const nonClaudePattern = /(^|[^a-z])(grok|composer)[-_]/i;
  if (nonClaudePattern.test(currentModel.toLowerCase())) {
    return {
      model: currentModel,
      bumped: false,
      reason: 'non-claude-lane',
      atCeiling: false,
      ceilingWalled: false,
    };
  }

  // 2. Derive wall signals once
  const walled =
    wall.repeatedWall ||
    wall.lastReasonClass === 'same-wall-twice' ||
    wall.suspectGate;

  const hardWalled =
    wall.repeatedWall ||
    isHardWall(wall.lastReasonClass);

  const ceilingWalled =
    hardWalled &&
    wall.priorImplementModels.some((m) =>
      m.toLowerCase().includes(TIER_CEILING_MODEL)
    );

  // Count distinct escalated tiers (sonnet or opus) in priorImplementModels
  const escalatedTiers = new Set<string>();
  for (const model of wall.priorImplementModels) {
    const lower = model.toLowerCase();
    if (lower.includes('sonnet') || lower.includes('opus')) {
      lower.includes('opus') ? escalatedTiers.add('opus') : escalatedTiers.add('sonnet');
    }
  }
  const bumpsUsed = escalatedTiers.size;

  // 3. No wall signal → unchanged
  if (!walled) {
    return {
      model: currentModel,
      bumped: false,
      reason: 'no-wall-signal',
      atCeiling: false,
      ceilingWalled: false,
    };
  }

  // 4. Already at ceiling tier → unchanged
  const isCeiling = currentModel.toLowerCase().includes(TIER_CEILING_MODEL);
  if (isCeiling) {
    return {
      model: currentModel,
      bumped: false,
      reason: 'at-ceiling',
      atCeiling: true,
      ceilingWalled,
    };
  }

  // 5. Bump budget exhausted → unchanged
  if (bumpsUsed >= MAX_TIER_BUMPS) {
    return {
      model: currentModel,
      bumped: false,
      reason: 'bump-budget-exhausted',
      atCeiling: false,
      ceilingWalled,
    };
  }

  // 6. Unrecognised/unladdered model → unchanged
  const next = nextTier(currentModel);
  if (next === currentModel) {
    return {
      model: currentModel,
      bumped: false,
      reason: 'unladdered-model',
      atCeiling: false,
      ceilingWalled,
    };
  }

  // 7. Otherwise → bump to next tier
  const isNextCeiling = next.toLowerCase().includes(TIER_CEILING_MODEL);
  return {
    model: next,
    bumped: true,
    reason: `tier-bump:${currentModel}->${next} attempt=${attempt}`,
    atCeiling: isNextCeiling,
    ceilingWalled,
  };
}
