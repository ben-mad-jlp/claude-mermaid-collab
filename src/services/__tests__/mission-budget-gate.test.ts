import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it — these tests exercise
// the REAL condition-key dedup, which is the "exactly one card per crossing" guarantee.
const SUP_DIR = mkdtempSync(join(tmpdir(), 'rebet-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { applyRebetDecision, collectRebetInput, raiseOverBudgetRebetCard } from '../mission-budget-gate';
import { OVER_BUDGET_REBET_KIND, REBET_DROP_OPTION, REBET_PARK_OPTION, REBET_RAISE_OPTION } from '../mission-rebet';
import { rebetConditionKey } from '../rebet-briefing';
import { getEscalation, listOpenEscalations, _closeDb } from '../supervisor-store';
import type { MissionSpend } from '../ledger-stats';

beforeAll(() => { _closeDb(); });
afterAll(() => { _closeDb(); rmSync(SUP_DIR, { recursive: true, force: true }); delete process.env.MERMAID_SUPERVISOR_DIR; });

const PROJECT = '/tmp/rebet-project';

/** A fake mission world. No mock.module anywhere — every reader is an injected dep, so
 *  nothing leaks into other test files in this single-process suite. */
function world(over: { budgetUsd?: number | null; costUsd?: number; met?: number; total?: number; served?: number } = {}) {
  const budgetUsd = over.budgetUsd === undefined ? 50 : over.budgetUsd;
  const total = over.total ?? 4;
  const met = over.met ?? 1;
  let currentBudget: number | null = budgetUsd;
  const spend = { missionId: 'M', costUsd: over.costUsd ?? 62.5 } as unknown as MissionSpend;
  const setCalls: Array<{ project: string; todoId: string; budgetUsd: number | null; actor: string }> = [];
  return {
    setCalls,
    get budget() { return currentBudget; },
    deps: {
      getMission: ((_p: string, _id: string) => ({ todoId: 'M', budgetUsd: currentBudget })) as never,
      getMissionSpend: ((_p: string, _id: string) => spend) as never,
      getMissionCost: ((_p: string, _id: string) => ({ leaves: { accepted: 3 } })) as never,
      listCriteriaWithActions: ((_p: string, _id: string) =>
        Array.from({ length: total }, (_, i) => ({
          id: `c${i}`, text: `criterion ${i}`, met: i < met,
          action: i < met ? 'met' : 'discover',
          servedEpicCount: over.served ?? 0,
          verifiedAt: i < met ? 1 : null,
        }))) as never,
      setMissionBudget: ((project: string, todoId: string, budgetUsd: number | null, opts: { actor: string }) => {
        setCalls.push({ project, todoId, budgetUsd, actor: opts.actor });
        currentBudget = budgetUsd;
        return { todoId, budgetUsd };
      }) as never,
    },
    setSpend(next: number) { (spend as { costUsd: number }).costUsd = next; },
  };
}

describe('collectRebetInput', () => {
  test('reads the AUTHORITATIVE spend surface and the mission ceiling', () => {
    const w = world();
    const input = collectRebetInput(PROJECT, 'M', w.deps);
    expect(input.spend.costUsd).toBe(62.5);
    expect(input.budgetUsd).toBe(50);
    expect(input.acceptedChanges).toBe(3);
    expect(input.criteria).toHaveLength(4);
  });

  test('a failing cost read degrades to 0 accepted changes instead of throwing', () => {
    const w = world();
    const input = collectRebetInput(PROJECT, 'M', {
      ...w.deps,
      getMissionCost: (() => { throw new Error('ledger down'); }) as never,
    });
    expect(input.acceptedChanges).toBe(0);
  });
});

describe('raiseOverBudgetRebetCard — exactly one card per crossing', () => {
  test('a crossing raises ONE card carrying the briefing options and ui spec', () => {
    const w = world();
    const res = raiseOverBudgetRebetCard(PROJECT, 'M1', 's1', 'ship X', w.deps);
    expect(res.raised).toBe(true);
    expect(res.isNew).toBe(true);

    const open = listOpenEscalations().filter((e) => e.todoId === 'M1');
    expect(open).toHaveLength(1);
    const card = open[0];
    expect(card.kind).toBe(OVER_BUDGET_REBET_KIND);
    expect(card.conditionKey).toBe(rebetConditionKey('M1', 50));
    expect(card.operatorGated).toBe(1);
    expect(card.questionText).toContain('OVER BUDGET');
    expect(card.questionText).toContain('ship X');
    // Answerable: the three re-bet options, with the planner's recommendation marked.
    expect((card.options ?? []).map((o) => o.id).sort()).toEqual(
      ([REBET_RAISE_OPTION, REBET_PARK_OPTION, REBET_DROP_OPTION] as string[]).sort(),
    );
    expect([REBET_RAISE_OPTION, REBET_PARK_OPTION, REBET_DROP_OPTION] as string[]).toContain(card.recommended as string);
    // …and the rich UI spec survived server-side validation (it was not dropped to null).
    expect(card.ui).toBeTruthy();
  });

  test('N further ticks at the SAME ceiling → still one card, recurrence bumped', () => {
    const w = world();
    raiseOverBudgetRebetCard(PROJECT, 'M2', 's1', 'ship Y', w.deps);
    const first = listOpenEscalations().filter((e) => e.todoId === 'M2');
    expect(first).toHaveLength(1);

    for (let i = 0; i < 8; i++) {
      const again = raiseOverBudgetRebetCard(PROJECT, 'M2', 's1', 'ship Y', w.deps);
      expect(again.raised).toBe(true);
      expect(again.isNew).toBe(false); // NOT a new card
    }
    const after = listOpenEscalations().filter((e) => e.todoId === 'M2');
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first[0].id);
    expect(getEscalation(first[0].id)?.recurrenceCount).toBe(8);
  });

  test('below the ceiling → no card at all', () => {
    const w = world({ costUsd: 10, budgetUsd: 50 });
    const res = raiseOverBudgetRebetCard(PROJECT, 'M3', 's1', 'ship Z', w.deps);
    expect(res.raised).toBe(false);
    expect(res.skipped).toBe('not-over-budget');
    expect(listOpenEscalations().filter((e) => e.todoId === 'M3')).toHaveLength(0);
  });

  test('no ceiling set → no card (an uncapped mission cannot cross)', () => {
    const w = world({ budgetUsd: null });
    expect(raiseOverBudgetRebetCard(PROJECT, 'M4', 's1', 'ship W', w.deps).skipped).toBe('not-over-budget');
  });

  test('FAIL OPEN: a throwing reader returns skipped:error rather than throwing at the caller', () => {
    const res = raiseOverBudgetRebetCard(PROJECT, 'M5', 's1', 'ship V', {
      getMission: (() => { throw new Error('mission db down'); }) as never,
    });
    expect(res.raised).toBe(false);
    expect(res.skipped).toBe('error');
  });

  test('raising the ceiling and crossing the NEW one mints a FRESH card', () => {
    const w = world({ budgetUsd: 50, costUsd: 62.5 });
    raiseOverBudgetRebetCard(PROJECT, 'M6', 's1', 'ship U', w.deps);
    expect(listOpenEscalations().filter((e) => e.todoId === 'M6')).toHaveLength(1);

    // Human answers 'raise' → the budget moves through the store's setter.
    const decision = applyRebetDecision(PROJECT, 'M6', REBET_RAISE_OPTION, w.deps);
    expect(decision.applied).toBe('raised');
    expect(w.budget!).toBeGreaterThan(62.5);

    // The conductor resumes: at the new ceiling the mission is no longer over budget.
    expect(raiseOverBudgetRebetCard(PROJECT, 'M6', 's1', 'ship U', w.deps).skipped).toBe('not-over-budget');

    // Spend later crosses the NEW ceiling → a genuinely fresh card (different conditionKey).
    w.setSpend(w.budget! + 25);
    const fresh = raiseOverBudgetRebetCard(PROJECT, 'M6', 's1', 'ship U', w.deps);
    expect(fresh.isNew).toBe(true);
    const cards = listOpenEscalations().filter((e) => e.todoId === 'M6');
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.conditionKey)).size).toBe(2);
  });
});

describe('applyRebetDecision', () => {
  test("'raise' mutates the budget THROUGH setMissionBudget, attributed", () => {
    const w = world({ budgetUsd: 50, costUsd: 62.5 });
    const res = applyRebetDecision(PROJECT, 'M7', REBET_RAISE_OPTION, w.deps);
    expect(res.applied).toBe('raised');
    expect(w.setCalls).toHaveLength(1);
    expect(w.setCalls[0].todoId).toBe('M7');
    expect(w.setCalls[0].actor).toBe('human:rebet-card');
    // The new ceiling must actually clear the current spend, else the mission re-cards instantly.
    expect(w.setCalls[0].budgetUsd!).toBeGreaterThan(62.5);
  });

  test("'park-and-reshape' / 'drop-criteria' / no answer change NO budget (judgment calls)", () => {
    for (const option of [REBET_PARK_OPTION, REBET_DROP_OPTION, null]) {
      const w = world();
      const res = applyRebetDecision(PROJECT, 'M8', option, w.deps);
      expect(res.applied).toBe('noop');
      expect(w.setCalls).toHaveLength(0);
    }
  });
});
