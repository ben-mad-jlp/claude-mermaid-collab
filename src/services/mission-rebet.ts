/**
 * mission-rebet.ts — pure façade over `rebet-briefing.ts`'s `planRebetBriefing`.
 *
 * `planRebetBriefing` already owns the money math and the 2x/serve-cap
 * recommendation precedence (LOCKED at rebet-briefing.ts:140-150). This module
 * does not re-derive that arithmetic — it adapts a `MissionSpend`-shaped input
 * plus an injected `acceptedChanges` count into the planner's facts shape, and
 * renders a CompareTable-bearing UI spec the planner's own `ui` does not have.
 * No DB, no `Date.now()`, no store reads — every input is injected.
 */
import { CRITERION_SERVE_CAP } from './harness-caps.ts';
import type { MissionSpend } from './ledger-stats.ts';
import type { JsonRenderSpec, UiElement } from './escalation-ui-schema';
import { planRebetBriefing, REBET_KIND, REBET_OPTIONS, type RebetOption } from './rebet-briefing.ts';
import type { CriterionAction } from './mission-store.ts';

/** The escalation kind for a mission-over-budget re-bet briefing. */
export const OVER_BUDGET_REBET_KIND = REBET_KIND;

export const REBET_RAISE_OPTION = 'raise' as const;
export const REBET_PARK_OPTION = 'park-and-reshape' as const;
export const REBET_DROP_OPTION = 'drop-criteria' as const;

// The four constants above are the single source of truth for these literals;
// assert they stay in lockstep with `REBET_OPTIONS` rather than silently drift.
const _assertRaise: (typeof REBET_OPTIONS)[0] = REBET_RAISE_OPTION;
const _assertPark: (typeof REBET_OPTIONS)[1] = REBET_PARK_OPTION;
const _assertDrop: (typeof REBET_OPTIONS)[2] = REBET_DROP_OPTION;
void _assertRaise;
void _assertPark;
void _assertDrop;

/** Structural subset of what `listCriteriaWithActions` (mission-store.ts:1246)
 *  returns, so a caller can pass those rows straight through. */
export interface RebetInputCriterion {
  id: string;
  text: string;
  met: boolean;
  action: CriterionAction;
  servedEpicCount: number;
}

export interface RebetInput {
  spend: MissionSpend;
  budgetUsd: number | null;
  criteria: RebetInputCriterion[];
  acceptedChanges: number;
}

export interface RebetRemainingState {
  id: string;
  text: string;
  met: boolean;
  action: CriterionAction;
  servedEpicCount: number;
  serveCapped: boolean;
}

export interface RebetEconomics {
  spendUsd: number;
  budgetUsd: number | null;
  perCriterion: RebetRemainingState[];
  costPerAcceptedChange: number;
  costPerCriterion: number;
  estimatedCostToConverge: number;
  recommendation: RebetOption;
  rationale: string;
}

/**
 * Adapt `RebetInput` into `planRebetBriefing`'s facts shape and delegate the
 * money math + recommendation to it — the 2x rule is evaluated in exactly one
 * place (rebet-briefing.ts:144).
 */
export function buildRebetBriefing(input: RebetInput): RebetEconomics {
  const costPerAcceptedChange = input.spend.costUsd / Math.max(1, input.acceptedChanges);

  const planned = planRebetBriefing({
    missionId: input.spend.missionId,
    budgetUsd: input.budgetUsd,
    spendUsd: input.spend.costUsd,
    costPerAcceptedChange,
    // `verifiedAt: c.met ? 1 : null` is load-bearing: the planner's `isResolved`
    // (rebet-briefing.ts:130) is `met && verifiedAt != null`. This module's
    // contract keys `costPerCriterion` on the *met* count alone, so the
    // synthetic non-null stamp makes the planner's `resolvedCount` equal the
    // met count exactly. The value is a constant, never a timestamp — the
    // planner never reads it as time.
    perCriterion: input.criteria.map((c) => ({
      id: c.id,
      text: c.text,
      action: c.action,
      met: c.met,
      verifiedAt: c.met ? 1 : null,
      servedEpicCount: c.servedEpicCount,
    })),
  });

  const perCriterion: RebetRemainingState[] = input.criteria.map((c) => ({
    id: c.id,
    text: c.text,
    met: c.met,
    action: c.action,
    servedEpicCount: c.servedEpicCount,
    serveCapped: !c.met && c.servedEpicCount >= CRITERION_SERVE_CAP,
  }));

  const rationale = buildRationale(planned.recommendation, {
    estimatedCostToConverge: planned.estimatedCostToConverge,
    costPerCriterion: planned.costPerCriterion,
    perCriterion,
    suggestedBudgetUsd: planned.suggestedBudgetUsd,
  });

  return {
    spendUsd: input.spend.costUsd,
    budgetUsd: input.budgetUsd,
    perCriterion,
    costPerAcceptedChange,
    costPerCriterion: planned.costPerCriterion,
    estimatedCostToConverge: planned.estimatedCostToConverge,
    recommendation: planned.recommendation,
    rationale,
  };
}

function buildRationale(
  recommendation: RebetOption,
  facts: {
    estimatedCostToConverge: number;
    costPerCriterion: number;
    perCriterion: RebetRemainingState[];
    suggestedBudgetUsd: number;
  },
): string {
  if (recommendation === REBET_PARK_OPTION) {
    return `Estimated cost to converge ($${facts.estimatedCostToConverge.toFixed(2)}) exceeds 2x the cost per criterion ($${(2 * facts.costPerCriterion).toFixed(2)}) — recommend parking and reshaping.`;
  }
  if (recommendation === REBET_DROP_OPTION) {
    const cappedIds = facts.perCriterion.filter((c) => c.serveCapped).map((c) => c.id);
    return `Criteria ${cappedIds.join(', ')} hit the serve cap (${CRITERION_SERVE_CAP}) without converging — recommend dropping stalled criteria.`;
  }
  return `Cost to converge ($${facts.estimatedCostToConverge.toFixed(2)}) looks affordable — recommend raising the budget to $${facts.suggestedBudgetUsd.toFixed(2)}.`;
}

/**
 * Render a CompareTable-bearing UI spec for a re-bet briefing. Always exactly
 * six elements regardless of criterion count — a `CompareTable` is ONE element
 * no matter its row count, so this never risks `MAX_ELEMENTS` (40,
 * escalation-ui-schema.ts:20) on a large mission.
 */
export function buildRebetUiSpec(briefing: RebetEconomics): JsonRenderSpec {
  const metCount = briefing.perCriterion.filter((c) => c.met).length;

  const elements: UiElement[] = [
    { type: 'Heading', text: 'Mission over budget — re-bet decision', level: 2 },
    {
      type: 'KeyValue',
      pairs: [
        { key: 'spend', value: `$${briefing.spendUsd.toFixed(2)}` },
        { key: 'budget', value: briefing.budgetUsd == null ? 'n/a' : `$${briefing.budgetUsd.toFixed(2)}` },
        { key: 'cost/criterion', value: `$${briefing.costPerCriterion.toFixed(2)}` },
        { key: 'cost/accepted-change', value: `$${briefing.costPerAcceptedChange.toFixed(2)}` },
        { key: 'estimate-to-converge', value: `$${briefing.estimatedCostToConverge.toFixed(2)}` },
        { key: 'met', value: `${metCount}/${briefing.perCriterion.length}` },
      ],
    },
    {
      type: 'CompareTable',
      columns: ['criterion', 'met', 'served', 'action'],
      rows: briefing.perCriterion.map((c) => [c.text, String(c.met), String(c.servedEpicCount), c.action]),
    },
    {
      type: 'OptionButton',
      optionId: REBET_RAISE_OPTION,
      label: 'Raise budget',
      ...(briefing.recommendation === REBET_RAISE_OPTION ? { recommended: true } : {}),
    },
    {
      type: 'OptionButton',
      optionId: REBET_PARK_OPTION,
      label: 'Park and reshape',
      ...(briefing.recommendation === REBET_PARK_OPTION ? { recommended: true } : {}),
    },
    {
      type: 'OptionButton',
      optionId: REBET_DROP_OPTION,
      label: 'Drop stalled criteria',
      ...(briefing.recommendation === REBET_DROP_OPTION ? { recommended: true } : {}),
    },
  ];

  return { elements };
}
