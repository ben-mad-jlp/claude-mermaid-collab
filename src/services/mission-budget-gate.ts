/**
 * mission-budget-gate.ts — WIRING for the over-budget re-bet briefing.
 *
 * `mission-rebet.ts` (the briefing + UI spec) and `rebet-briefing.ts` (the money math,
 * the option vocabulary and the condition key) were both built and then never called by
 * anything: mission a6ab522b crossed its $50 ceiling, `planMissionLoopStep` returned
 * `{ kind: 'none', reason: 'over-budget' }`, and the mission sat DEAD for 1h45m. This
 * module is the missing caller. It does NOT re-derive any of that arithmetic.
 *
 * The contract it imposes:
 *  - When the AUTHORITATIVE mission spend (`getMissionSpend`, the same reader
 *    `collectMissionStatusFacts` uses to derive `over-budget`) crosses `budgetUsd`, ONE
 *    decision card is raised carrying the briefing's three answerable options and its UI
 *    spec — and then the mission stops spending.
 *  - EXACTLY ONE card per crossing, enforced by the escalation store's condition-key dedup
 *    keyed on (mission, ceiling crossed): repeated ticks at the same ceiling bump
 *    `recurrenceCount` in place; raising the budget and later crossing the NEW ceiling
 *    mints a fresh card.
 *  - The briefing itself costs NOTHING to produce — it is pure arithmetic over store reads,
 *    no LLM node. So "the briefing is exempt from the over-budget gate" is satisfied by
 *    construction rather than by an exemption flag someone could forget to honour, and
 *    "bounded — at most one per crossing" is the condition key, not a prompt instruction.
 *  - Every entry point fails OPEN: a fault anywhere in here must never break a conductor
 *    tick or a mission-loop pass.
 */
import { getMission, listCriteriaWithActions, setMissionBudget } from './mission-store.ts';
import { getMissionSpend } from './ledger-stats.ts';
import { getMissionCost } from './mission-cost.ts';
import {
  buildRebetBriefing,
  buildRebetOptions,
  buildRebetUiSpec,
  OVER_BUDGET_REBET_KIND,
  REBET_RAISE_OPTION,
  type RebetInput,
  type RebetEconomics,
} from './mission-rebet.ts';
import { rebetConditionKey } from './rebet-briefing.ts';
import { createEscalation } from './supervisor-store.ts';

export { OVER_BUDGET_REBET_KIND };

export interface RebetGateDeps {
  getMission?: typeof getMission;
  getMissionSpend?: typeof getMissionSpend;
  getMissionCost?: typeof getMissionCost;
  listCriteriaWithActions?: typeof listCriteriaWithActions;
  createEscalation?: typeof createEscalation;
  setMissionBudget?: typeof setMissionBudget;
}

/**
 * Read the re-bet briefing inputs from the store. `spend` comes from `getMissionSpend` —
 * the SAME authoritative mission-spend surface `deriveMissionStatus` reads to decide
 * `over-budget`; there is deliberately no second spend query in this file. Deps injectable
 * so tests never need a live ledger.
 */
export function collectRebetInput(project: string, missionId: string, deps: RebetGateDeps = {}): RebetInput {
  const mission = (deps.getMission ?? getMission)(project, missionId);
  if (!mission) throw new Error(`mission not found: ${missionId}`);

  const spend = (deps.getMissionSpend ?? getMissionSpend)(project, missionId);

  // An accounting read must not sink the briefing (same defensive posture as
  // rebet-briefing.collectRebetFacts): with no accept tally, cost-per-accepted-change
  // prices against the whole spend via mission-rebet's max(1, …).
  let acceptedChanges = 0;
  try {
    acceptedChanges = (deps.getMissionCost ?? getMissionCost)(project, missionId).leaves.accepted;
  } catch {
    acceptedChanges = 0;
  }

  const criteria = (deps.listCriteriaWithActions ?? listCriteriaWithActions)(project, missionId).map((c) => ({
    id: c.id,
    text: c.text,
    met: c.met,
    action: c.action,
    servedEpicCount: c.servedEpicCount,
  }));

  return { spend, budgetUsd: mission.budgetUsd ?? null, criteria, acceptedChanges };
}

export interface RebetCardResult {
  /** A card exists for this crossing (raised now, or already open and bumped). */
  raised: boolean;
  /** True only when THIS call minted the card (isNew from the store's keyed dedup). */
  isNew: boolean;
  /** The briefing that was rendered onto the card, when one was rendered. */
  briefing?: RebetEconomics;
  /** Why nothing was raised, when raised is false. */
  skipped?: 'not-over-budget' | 'error';
}

/**
 * THE over-budget final act: raise exactly one re-bet decision card for `missionId`.
 *
 * No-ops (`not-over-budget`) unless the mission actually has a ceiling and the authoritative
 * spend has reached it — so a caller may invoke this unconditionally. FAILS OPEN: any throw
 * is swallowed into `{ raised: false, skipped: 'error' }`.
 */
export function raiseOverBudgetRebetCard(
  project: string,
  missionId: string,
  session: string,
  missionTitle: string,
  deps: RebetGateDeps = {},
): RebetCardResult {
  try {
    const input = collectRebetInput(project, missionId, deps);
    if (input.budgetUsd == null || input.spend.costUsd < input.budgetUsd) {
      return { raised: false, isNew: false, skipped: 'not-over-budget' };
    }

    const briefing = buildRebetBriefing(input);
    const options = buildRebetOptions(briefing);
    const ui = buildRebetUiSpec(briefing);

    const res = (deps.createEscalation ?? createEscalation)({
      project,
      session,
      kind: OVER_BUDGET_REBET_KIND,
      todoId: missionId,
      operatorGated: true,
      // One card per (mission, CEILING CROSSED). Raising the ceiling changes the key, so a
      // later crossing of the NEW ceiling is a fresh card rather than a suppressed duplicate.
      conditionKey: rebetConditionKey(missionId, input.budgetUsd),
      conditionTuple: ['rebet', missionId, input.budgetUsd.toFixed(2)],
      options,
      recommended: briefing.recommendation,
      ui,
      questionText:
        `Mission "${missionTitle}" (${missionId}) is OVER BUDGET — spend $${briefing.spendUsd.toFixed(2)} ` +
        `has crossed its $${input.budgetUsd.toFixed(2)} ceiling, so the conductor has STOPPED spending on it. ` +
        `${briefing.perCriterion.filter((c) => c.met).length}/${briefing.perCriterion.length} criteria met; ` +
        `estimated $${briefing.estimatedCostToConverge.toFixed(2)} more to converge. ${briefing.rationale} ` +
        `Answer this card to re-bet: raise the budget, park and reshape, or drop the stalled criteria.`,
    });

    return { raised: true, isNew: res?.isNew === true, briefing };
  } catch {
    // fail OPEN — a broken card path must never break the tick that called it.
    return { raised: false, isNew: false, skipped: 'error' };
  }
}

export interface RebetDecisionResult {
  applied: 'raised' | 'noop';
  /** The new ceiling, when the decision raised it. */
  budgetUsd?: number;
  /** Human-readable outcome (also what the caller can log). */
  note: string;
}

/**
 * Apply a human's answer to a re-bet card.
 *
 * `raise` moves `budgetUsd` to the briefing's suggested ceiling THROUGH `setMissionBudget`
 * — the store's only supported budget-mutation surface (the same one `update_mission` uses),
 * so the change is validated and lands in the autonomy audit ring attributed to the human.
 * There is deliberately no raw UPDATE anywhere in this file.
 *
 * The suggested ceiling is RE-DERIVED here rather than stashed on the card: the card is a
 * question, not a promise, and re-deriving guarantees the funded number matches the spend at
 * the moment the human answers.
 *
 * `park-and-reshape` and `drop-criteria` are deliberately NOT auto-applied — parking and
 * criterion surgery are judgment calls that change what the mission IS; the card records the
 * human's answer and the conductor/human acts on it. This returns `noop` for them rather
 * than pretending to have done something.
 */
export function applyRebetDecision(
  project: string,
  missionId: string,
  optionId: string | null,
  deps: RebetGateDeps & { actor?: string; reason?: string } = {},
): RebetDecisionResult {
  if (optionId !== REBET_RAISE_OPTION) {
    return { applied: 'noop', note: `re-bet option "${optionId ?? 'none'}" needs a human/conductor action; no budget change` };
  }
  const input = collectRebetInput(project, missionId, deps);
  const briefing = buildRebetBriefing(input);
  const next = Math.max(briefing.suggestedBudgetUsd, input.spend.costUsd + 0.01);
  const row = (deps.setMissionBudget ?? setMissionBudget)(project, missionId, Number(next.toFixed(2)), {
    actor: deps.actor ?? 'human:rebet-card',
    reason: deps.reason ?? 'over-budget re-bet: raise',
  });
  return {
    applied: 'raised',
    budgetUsd: row.budgetUsd ?? undefined,
    note: `budget raised to $${(row.budgetUsd ?? next).toFixed(2)}`,
  };
}
