// Runs via `bun test` — pure module, no DB access.
import { describe, it, expect } from 'bun:test';
import { CRITERION_SERVE_CAP } from '../harness-caps.ts';
import { validateUiSpec } from '../escalation-ui-schema';
import type { MissionSpend } from '../ledger-stats.ts';
import {
  buildRebetBriefing,
  buildRebetUiSpec,
  REBET_DROP_OPTION,
  REBET_PARK_OPTION,
  REBET_RAISE_OPTION,
  type RebetInput,
  type RebetInputCriterion,
} from '../mission-rebet.ts';

function crit(overrides: Partial<RebetInputCriterion> = {}): RebetInputCriterion {
  return {
    id: overrides.id ?? 'c1',
    text: overrides.text ?? 'criterion',
    met: overrides.met ?? false,
    action: overrides.action ?? 'discover',
    servedEpicCount: overrides.servedEpicCount ?? 0,
  };
}

function spend(overrides: Partial<MissionSpend> = {}): MissionSpend {
  return {
    missionId: 'm1',
    costUsd: 10,
    nodesSpent: 5,
    rows: 5,
    byBucket: { leaves: 5, conductor: 0, planner: 0, forge: 0, verify: 0, other: 0 },
    ...overrides,
  };
}

function input(overrides: Partial<RebetInput> = {}): RebetInput {
  return {
    spend: spend(),
    budgetUsd: 10,
    criteria: [],
    acceptedChanges: 5,
    ...overrides,
  };
}

describe('buildRebetBriefing — 2x boundary', () => {
  it('exactly 2x estimate (not greater) with 2 unmet + 1 met stays raise', () => {
    const briefing = buildRebetBriefing(
      input({
        criteria: [
          crit({ id: 'met1', met: true }),
          crit({ id: 'unmet1', met: false }),
          crit({ id: 'unmet2', met: false }),
        ],
      }),
    );
    expect(briefing.estimatedCostToConverge).toBe(2 * briefing.costPerCriterion);
    expect(briefing.recommendation).toBe(REBET_RAISE_OPTION);
  });

  it('greater than 2x estimate with 3 unmet + 1 met is park-and-reshape', () => {
    const briefing = buildRebetBriefing(
      input({
        criteria: [
          crit({ id: 'met1', met: true }),
          crit({ id: 'unmet1', met: false }),
          crit({ id: 'unmet2', met: false }),
          crit({ id: 'unmet3', met: false }),
        ],
      }),
    );
    expect(briefing.estimatedCostToConverge).toBeGreaterThan(2 * briefing.costPerCriterion);
    expect(briefing.recommendation).toBe(REBET_PARK_OPTION);
  });
});

describe('buildRebetBriefing — serve-cap arm', () => {
  it('a serve-capped unmet criterion under a <=2x estimate yields drop-criteria', () => {
    const briefing = buildRebetBriefing(
      input({
        criteria: [
          crit({ id: 'met1', met: true }),
          crit({ id: 'capped', met: false, servedEpicCount: CRITERION_SERVE_CAP }),
        ],
      }),
    );
    expect(briefing.estimatedCostToConverge).toBeLessThanOrEqual(2 * briefing.costPerCriterion);
    expect(briefing.recommendation).toBe(REBET_DROP_OPTION);
    const capped = briefing.perCriterion.find((c) => c.id === 'capped');
    expect(capped?.serveCapped).toBe(true);
  });
});

describe('buildRebetBriefing — zero-division safety', () => {
  it('acceptedChanges: 0 with no met criteria stays finite', () => {
    const briefing = buildRebetBriefing(
      input({
        acceptedChanges: 0,
        criteria: [crit({ id: 'unmet1', met: false }), crit({ id: 'unmet2', met: false })],
      }),
    );
    expect(Number.isFinite(briefing.costPerAcceptedChange)).toBe(true);
    expect(Number.isFinite(briefing.costPerCriterion)).toBe(true);
    expect(Number.isFinite(briefing.estimatedCostToConverge)).toBe(true);
  });
});

describe('buildRebetUiSpec', () => {
  it('produces a validatable spec whose CompareTable row count equals the criterion count', () => {
    const criteria = [
      crit({ id: 'c1', met: true }),
      crit({ id: 'c2', met: false }),
      crit({ id: 'c3', met: false, servedEpicCount: CRITERION_SERVE_CAP }),
    ];
    const briefing = buildRebetBriefing(input({ criteria }));
    const ui = buildRebetUiSpec(briefing);
    const validated = validateUiSpec(ui);
    expect(validated).not.toBeNull();

    const table = ui.elements.find((e) => e.type === 'CompareTable');
    expect(table && 'rows' in table ? table.rows.length : -1).toBe(criteria.length);
  });
});
