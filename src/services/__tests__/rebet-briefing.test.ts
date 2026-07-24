// Runs via `bun test` — pure planner, no DB access.
import { describe, it, expect } from 'bun:test';
import { CRITERION_SERVE_CAP } from '../harness-caps.ts';
import { validateUiSpec } from '../escalation-ui-schema';
import { REBET_OPTIONS, planRebetBriefing, rebetConditionKey, type RebetFacts } from '../rebet-briefing';

function crit(overrides: Partial<RebetFacts['perCriterion'][number]> = {}): RebetFacts['perCriterion'][number] {
  return {
    id: overrides.id ?? 'c1',
    text: overrides.text ?? 'criterion',
    action: overrides.action ?? 'discover',
    met: overrides.met ?? false,
    verifiedAt: overrides.verifiedAt ?? null,
    servedEpicCount: overrides.servedEpicCount ?? 0,
  };
}

function baseFacts(overrides: Partial<RebetFacts> = {}): RebetFacts {
  return {
    missionId: 'm1',
    budgetUsd: 10,
    spendUsd: 10,
    costPerAcceptedChange: 2,
    perCriterion: [],
    ...overrides,
  };
}

describe('rebetConditionKey', () => {
  it('is identical for same mission + same budget', () => {
    expect(rebetConditionKey('m1', 10)).toBe(rebetConditionKey('m1', 10));
  });

  it('differs for a different budget', () => {
    expect(rebetConditionKey('m1', 10)).not.toBe(rebetConditionKey('m1', 20));
  });

  it('differs for a different mission', () => {
    expect(rebetConditionKey('m1', 10)).not.toBe(rebetConditionKey('m2', 10));
  });

  it('renders a null budget as "none"', () => {
    expect(rebetConditionKey('m1', null)).toBe('rebet:m1:none');
  });
});

describe('planRebetBriefing — 2x boundary', () => {
  // 1 resolved criterion, spendUsd = 10 -> costPerCriterion = 10.
  const resolved = crit({ id: 'resolved', met: true, verifiedAt: 100 });

  it('is NOT park-and-reshape at exactly 2x (equality stays off the reshape arm)', () => {
    const facts = baseFacts({
      spendUsd: 10,
      perCriterion: [resolved, crit({ id: 'r1' }), crit({ id: 'r2' })], // 2 remaining -> est = 20 = 2*10
    });
    const plan = planRebetBriefing(facts);
    expect(plan.costPerCriterion).toBe(10);
    expect(plan.estimatedCostToConverge).toBe(20);
    expect(plan.recommendation).not.toBe('park-and-reshape');
  });

  it('is park-and-reshape once strictly over 2x', () => {
    const facts = baseFacts({
      spendUsd: 10,
      perCriterion: [resolved, crit({ id: 'r1' }), crit({ id: 'r2' }), crit({ id: 'r3' })], // 3 remaining -> est = 30 > 20
    });
    const plan = planRebetBriefing(facts);
    expect(plan.estimatedCostToConverge).toBeGreaterThan(2 * plan.costPerCriterion);
    expect(plan.recommendation).toBe('park-and-reshape');
  });
});

describe('planRebetBriefing — serve-cap arm', () => {
  const resolved = crit({ id: 'resolved', met: true, verifiedAt: 100 });

  it('recommends drop-criteria when a criterion is serve-capped and unmet, with <=2 remaining', () => {
    const facts = baseFacts({
      spendUsd: 10,
      perCriterion: [resolved, crit({ id: 'capped', servedEpicCount: CRITERION_SERVE_CAP, met: false })],
    });
    const plan = planRebetBriefing(facts);
    expect(plan.estimatedCostToConverge).toBeLessThanOrEqual(2 * plan.costPerCriterion);
    expect(plan.recommendation).toBe('drop-criteria');
  });

  it('does not recommend drop-criteria once that same criterion is met and verified', () => {
    const facts = baseFacts({
      spendUsd: 10,
      perCriterion: [
        resolved,
        crit({ id: 'capped', servedEpicCount: CRITERION_SERVE_CAP, met: true, verifiedAt: 200 }),
      ],
    });
    const plan = planRebetBriefing(facts);
    expect(plan.recommendation).not.toBe('drop-criteria');
  });
});

describe('planRebetBriefing — options', () => {
  const resolved = crit({ id: 'resolved', met: true, verifiedAt: 100 });

  it('always returns the three ids in the fixed order', () => {
    const plan = planRebetBriefing(baseFacts({ perCriterion: [resolved] }));
    expect(plan.options.map((o) => o.id)).toEqual([...REBET_OPTIONS]);
  });

  it('recommendedOptionId names an actual option for every arm', () => {
    const raisePlan = planRebetBriefing(baseFacts({ spendUsd: 10, perCriterion: [resolved] }));
    expect(raisePlan.recommendation).toBe('raise');
    expect(raisePlan.options.some((o) => o.id === raisePlan.recommendedOptionId)).toBe(true);

    const reshapePlan = planRebetBriefing(
      baseFacts({
        spendUsd: 10,
        perCriterion: [resolved, crit({ id: 'r1' }), crit({ id: 'r2' }), crit({ id: 'r3' })],
      }),
    );
    expect(reshapePlan.recommendation).toBe('park-and-reshape');
    expect(reshapePlan.options.some((o) => o.id === reshapePlan.recommendedOptionId)).toBe(true);

    const dropPlan = planRebetBriefing(
      baseFacts({
        spendUsd: 10,
        perCriterion: [resolved, crit({ id: 'capped', servedEpicCount: CRITERION_SERVE_CAP, met: false })],
      }),
    );
    expect(dropPlan.recommendation).toBe('drop-criteria');
    expect(dropPlan.options.some((o) => o.id === dropPlan.recommendedOptionId)).toBe(true);
  });
});

describe('planRebetBriefing — ui', () => {
  const resolved = crit({ id: 'resolved', met: true, verifiedAt: 100 });

  it('produces a valid ui spec for the raise arm', () => {
    const plan = planRebetBriefing(baseFacts({ spendUsd: 10, perCriterion: [resolved] }));
    expect(validateUiSpec(plan.ui)).not.toBeNull();
  });

  it('produces a valid ui spec for the park-and-reshape arm', () => {
    const plan = planRebetBriefing(
      baseFacts({
        spendUsd: 10,
        perCriterion: [resolved, crit({ id: 'r1' }), crit({ id: 'r2' }), crit({ id: 'r3' })],
      }),
    );
    expect(validateUiSpec(plan.ui)).not.toBeNull();
  });

  it('produces a valid ui spec for the drop-criteria arm', () => {
    const plan = planRebetBriefing(
      baseFacts({
        spendUsd: 10,
        perCriterion: [resolved, crit({ id: 'capped', servedEpicCount: CRITERION_SERVE_CAP, met: false })],
      }),
    );
    expect(validateUiSpec(plan.ui)).not.toBeNull();
  });
});
