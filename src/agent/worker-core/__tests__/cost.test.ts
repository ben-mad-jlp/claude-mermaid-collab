import { describe, it, expect } from 'vitest';
import { estimateCostUsd, knownPricing, newCostLedger, addToLedger } from '../cost';

describe('cost ledger', () => {
  it('prices a known model by input/output tokens', () => {
    // claude-sonnet-4-6 = $3/$15 per Mtok → 1M in + 1M out = $18
    expect(estimateCostUsd('claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(18, 6);
    // 1000 in / 500 out → 3*0.001 + 15*0.0005 = 0.0105
    expect(estimateCostUsd('claude-sonnet-4-6', { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.0105, 9);
  });

  it('treats an unknown model as $0 + flags it (never a silent price)', () => {
    expect(knownPricing('made-up-model')).toBe(false);
    expect(estimateCostUsd('made-up-model', { inputTokens: 1000, outputTokens: 1000 })).toBe(0);
    expect(knownPricing('claude-sonnet-4-6')).toBe(true);
  });

  it('accumulates a per-run ledger across models', () => {
    const l = newCostLedger();
    addToLedger(l, 'grok-build-0.1', { inputTokens: 10_000, outputTokens: 2_000 });
    addToLedger(l, 'claude-sonnet-4-6', { inputTokens: 5_000, outputTokens: 1_000 });
    addToLedger(l, 'mystery', { inputTokens: 100, outputTokens: 100 });
    expect(l.byModel['claude-sonnet-4-6'].usd).toBeCloseTo((5000 * 3 + 1000 * 15) / 1e6, 9);
    expect(l.byModel['mystery'].unknownPrice).toBe(true);
    expect(l.totalUsd).toBeCloseTo(
      (10_000 * 0.2 + 2_000 * 0.5) / 1e6 + (5_000 * 3 + 1_000 * 15) / 1e6,
      9,
    );
  });
});
