/**
 * rebet-briefing.ts — pure re-bet briefing planner for a mission that has crossed
 * its budget (mission-loop.ts's `over-budget` arm).
 *
 * This module is a PLANNER in the `profile-approve.ts` mould: all money math and
 * the recommendation are computed from a plain `RebetFacts` object by a pure
 * function (`planRebetBriefing`). It is now STRICTLY pure — every import is
 * type-only, so it opens no store and, load-bearingly, sits OUTSIDE the
 * mission-store ↔ conductor-pass import cycle. `mission-budget-gate.ts` is the
 * one module that reads the store for these facts and wires the result into an
 * escalation; a second store-reading collector used to live here
 * (`collectRebetFacts`) with zero callers, and its value imports of
 * mission-store/mission-cost/ledger-stats were what dragged this planner into
 * that cycle (TDZ on `REBET_OPTIONS` at import time). One collector, no cycle.
 */
import { CRITERION_SERVE_CAP } from './harness-caps.ts';
import type { CriterionAction } from './mission-store.ts';
import type { JsonRenderSpec, UiElement } from './escalation-ui-schema';
import type { EscalationOption } from './supervisor-store.ts';

/** The escalation kind for a mission-over-budget re-bet briefing. */
export const REBET_KIND = 'mission-over-budget-rebet';

/**
 * Build the `createEscalation` conditionKey for a re-bet crossing. Deliberately
 * NOT `conditionIdentity()` (`supervisor-store.ts:755`, which keys
 * `${kind}:${subject[0]}` and would collapse every crossing of one mission into
 * one key) — this key is one-per-(mission, budget) crossing. The `toFixed(2)`
 * normalization is PINNED: a sub-cent budget bump deliberately does NOT re-arm.
 */
export function rebetConditionKey(missionId: string, budgetUsd: number | null): string {
  return `rebet:${missionId}:${budgetUsd == null ? 'none' : budgetUsd.toFixed(2)}`;
}

/** Per-criterion facts the briefing reasons over. */
export interface RebetCriterionFact {
  id: string;
  text: string;
  action: CriterionAction;
  met: boolean;
  verifiedAt: number | null;
  servedEpicCount: number;
}

/** The plain facts object `planRebetBriefing` reasons over — no store access. */
export interface RebetFacts {
  missionId: string;
  budgetUsd: number | null;
  spendUsd: number;
  costPerAcceptedChange: number | null;
  perCriterion: RebetCriterionFact[];
}

/** The three re-bet options — ids EQUAL the recommendation literals, so
 *  `recommendedOptionId` can never name a missing option
 *  (`supervisor-store.ts:851` silently drops an unmatched `recommended`). */
export const REBET_OPTIONS = ['raise', 'park-and-reshape', 'drop-criteria'] as const;
export type RebetOption = (typeof REBET_OPTIONS)[number];

export interface RebetBriefing extends RebetFacts {
  costPerCriterion: number;
  estimatedCostToConverge: number;
  suggestedBudgetUsd: number;
  recommendation: RebetOption;
  options: EscalationOption[];
  recommendedOptionId: string;
  ui: JsonRenderSpec;
}

/**
 * THE single definition of the three answerable re-bet options. Both the planner here and
 * the `mission-rebet.ts` façade render from this one function, so the option ids/labels a
 * human sees on the card can never drift between the two surfaces (an id drift would make
 * `recommendedOptionId` name a missing option, which `supervisor-store.ts` silently drops).
 */
export function rebetOptions(suggestedBudgetUsd: number): EscalationOption[] {
  return [
    {
      id: 'raise',
      label: `Raise budget to $${suggestedBudgetUsd.toFixed(2)}`,
      detail: 'Fund the estimated remaining cost to converge and keep going.',
    },
    {
      id: 'park-and-reshape',
      label: 'Park and reshape',
      detail: 'Estimated cost to converge exceeds the loop economics — pause and re-scope the mission.',
    },
    {
      id: 'drop-criteria',
      label: 'Drop stalled criteria',
      detail: `One or more criteria hit the serve cap (${CRITERION_SERVE_CAP}) without converging — drop them and continue.`,
    },
  ];
}

/**
 * PURE re-bet briefing planner — no store/DB access, no `Date.now()`, no
 * time-varying state anywhere (the one-per-crossing guarantee lives in the
 * KEY, not in the planner — a time-varying key would re-arm every tick).
 */
export function planRebetBriefing(facts: RebetFacts): RebetBriefing {
  const { missionId, budgetUsd, spendUsd, costPerAcceptedChange, perCriterion } = facts;

  const isResolved = (c: RebetCriterionFact) => c.met && c.verifiedAt != null;
  const resolvedCount = perCriterion.filter(isResolved).length;
  const remaining = perCriterion.filter((c) => !isResolved(c));

  // max(1, …) is the zero-resolved fallback: with nothing resolved yet, spend
  // per criterion is priced against the WHOLE spend rather than dividing by 0.
  const costPerCriterion = spendUsd / Math.max(1, resolvedCount);
  const estimatedCostToConverge = remaining.length * costPerCriterion;
  const suggestedBudgetUsd = (budgetUsd ?? spendUsd) + estimatedCostToConverge;

  // LOCKED precedence. Rule 1 is absolute and wins any overlap: reshape
  // subsumes dropping, so a serve-capped criterion under a >2× estimate still
  // reads park-and-reshape, not drop-criteria.
  let recommendation: RebetOption;
  if (estimatedCostToConverge > 2 * costPerCriterion) {
    recommendation = 'park-and-reshape';
  } else if (perCriterion.some((c) => c.servedEpicCount >= CRITERION_SERVE_CAP && !c.met)) {
    recommendation = 'drop-criteria';
  } else {
    recommendation = 'raise';
  }

  const options = rebetOptions(suggestedBudgetUsd);
  const recommendedOptionId = recommendation;

  const calloutText =
    recommendation === 'park-and-reshape'
      ? `Estimated cost to converge ($${estimatedCostToConverge.toFixed(2)}) exceeds 2x the cost per criterion ($${(2 * costPerCriterion).toFixed(2)}) — recommend parking and reshaping.`
      : recommendation === 'drop-criteria'
        ? `A criterion has been served ${CRITERION_SERVE_CAP}+ times without converging — recommend dropping stalled criteria.`
        : `Cost to converge looks affordable — recommend raising the budget to $${suggestedBudgetUsd.toFixed(2)}.`;

  const ui: JsonRenderSpec = {
    elements: [
      { type: 'Heading', text: `Mission ${missionId} is over budget — re-bet decision`, level: 2 },
      {
        type: 'KeyValue',
        pairs: [
          { key: 'spend', value: `$${spendUsd.toFixed(2)}` },
          { key: 'budget', value: budgetUsd == null ? 'n/a' : `$${budgetUsd.toFixed(2)}` },
          { key: 'cost/criterion', value: `$${costPerCriterion.toFixed(2)}` },
          {
            key: 'cost/accepted-change',
            value: costPerAcceptedChange == null ? 'n/a' : `$${costPerAcceptedChange.toFixed(2)}`,
          },
          { key: 'estimate-to-converge', value: `$${estimatedCostToConverge.toFixed(2)}` },
          { key: 'criteria resolved', value: `${resolvedCount}/${perCriterion.length}` },
        ],
      },
      {
        type: 'Callout',
        tone: recommendation === 'raise' ? 'info' : 'warning',
        text: calloutText,
      },
      ...(options.map((o) => ({
        type: 'OptionButton',
        optionId: o.id,
        label: o.label,
        ...(o.id === recommendedOptionId ? { recommended: true } : {}),
      })) as UiElement[]),
    ],
  };

  return {
    missionId,
    budgetUsd,
    spendUsd,
    costPerAcceptedChange,
    perCriterion,
    costPerCriterion,
    estimatedCostToConverge,
    suggestedBudgetUsd,
    recommendation,
    options,
    recommendedOptionId,
    ui,
  };
}
