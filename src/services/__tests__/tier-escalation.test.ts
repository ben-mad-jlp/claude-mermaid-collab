import { describe, test, expect } from 'bun:test';
import { planTierEscalation, TIER_CEILING_MODEL, MAX_TIER_BUMPS, type TierEscalationInput } from '../tier-escalation';
import { type LeafWallHistory } from '../leaf-wall-history';

/** Builder for clean LeafWallHistory with optional overrides. */
function hist(over: Partial<LeafWallHistory> = {}): LeafWallHistory {
  return {
    leafId: 'L1',
    priorRuns: 0,
    hardWallCount: 0,
    lastReasonClass: 'none',
    repeatedWall: false,
    suspectGate: false,
    priorImplementModels: [],
    ...over,
  };
}

describe('planTierEscalation', () => {
  test('sonnet + repeatedWall → opus, bumped:true', () => {
    const input: TierEscalationInput = {
      currentModel: 'sonnet',
      attempt: 1,
      wall: hist({
        repeatedWall: true,
        lastReasonClass: 'review-fail',
        hardWallCount: 2,
      }),
    };
    const result = planTierEscalation(input);
    expect(result.model).toBe('opus');
    expect(result.bumped).toBe(true);
    expect(result.atCeiling).toBe(true);
  });

  test('sonnet + suspectGate → opus, bumped:true', () => {
    const input: TierEscalationInput = {
      currentModel: 'sonnet',
      attempt: 1,
      wall: hist({
        suspectGate: true,
        lastReasonClass: 'suspect-gate',
      }),
    };
    const result = planTierEscalation(input);
    expect(result.model).toBe('opus');
    expect(result.bumped).toBe(true);
  });

  test('haiku + same-wall-twice → sonnet', () => {
    const input: TierEscalationInput = {
      currentModel: 'haiku',
      attempt: 1,
      wall: hist({
        lastReasonClass: 'same-wall-twice',
        hardWallCount: 2,
      }),
    };
    const result = planTierEscalation(input);
    expect(result.model).toBe('sonnet');
    expect(result.bumped).toBe(true);
  });

  test('opus + repeatedWall → opus, bumped:false, atCeiling:true', () => {
    const input: TierEscalationInput = {
      currentModel: 'opus',
      attempt: 1,
      wall: hist({
        repeatedWall: true,
        lastReasonClass: 'review-fail',
      }),
    };
    const result = planTierEscalation(input);
    expect(result.model).toBe('opus');
    expect(result.bumped).toBe(false);
    expect(result.atCeiling).toBe(true);
  });

  test('grok-build-0.1 + repeatedWall → unchanged, bumped:false', () => {
    const input: TierEscalationInput = {
      currentModel: 'grok-build-0.1',
      attempt: 1,
      wall: hist({
        repeatedWall: true,
        lastReasonClass: 'review-fail',
      }),
    };
    const result = planTierEscalation(input);
    expect(result.model).toBe('grok-build-0.1');
    expect(result.bumped).toBe(false);
    expect(result.ceilingWalled).toBe(false);
  });

  test('priorImplementModels already at MAX_TIER_BUMPS → bumped:false', () => {
    const input: TierEscalationInput = {
      currentModel: 'haiku',
      attempt: 1,
      wall: hist({
        repeatedWall: true,
        lastReasonClass: 'review-fail',
        priorImplementModels: ['sonnet', 'sonnet', 'opus'],
      }),
    };
    const result = planTierEscalation(input);
    expect(result.bumped).toBe(false);
  });

  test('prior opus run + repeatedWall → ceilingWalled:true', () => {
    const input: TierEscalationInput = {
      currentModel: 'sonnet',
      attempt: 1,
      wall: hist({
        repeatedWall: true,
        lastReasonClass: 'review-fail',
        hardWallCount: 2,
        priorImplementModels: ['haiku', 'opus'],
      }),
    };
    const result = planTierEscalation(input);
    expect(result.ceilingWalled).toBe(true);
  });

  test('clean history → unchanged, bumped:false', () => {
    const input: TierEscalationInput = {
      currentModel: 'haiku',
      attempt: 1,
      wall: hist(),
    };
    const result = planTierEscalation(input);
    expect(result.model).toBe('haiku');
    expect(result.bumped).toBe(false);
    expect(result.reason).toBe('no-wall-signal');
  });
});
