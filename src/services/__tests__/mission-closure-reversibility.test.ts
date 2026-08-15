// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, _closeProject,
} from '../todo-store';
import {
  upsertMission, getMission, addCriterion, setMissionClosed,
  getMissionRollup, setCriterionMet, setCriterionMeasurementPendingUntil, deactivateIfTerminal,
  _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import { planMissionLoopStep } from '../mission-loop';
import { _closeDb, listOpenEscalations } from '../supervisor-store';

let project: string;

async function makeMissionNode(title = '[MISSION] Test mission') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  return t.id;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-closure-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeLedgerDb();
  _closeDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-closure-reversibility: awaiting-observation', () => {
  test('reports awaiting-observation with a null terminalReason while a measurement window is open', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'first criterion');
    const c2 = addCriterion(project, id, 'second criterion (awaiting)');

    // First criterion is met; second has an open measurement window.
    setCriterionMet(project, c1.id, true);
    const futureMs = Date.now() + 60_000;
    setCriterionMeasurementPendingUntil(project, c2.id, futureMs);

    // Verify rollup reports awaiting-observation.
    const rollup = getMissionRollup(project, id);
    expect(rollup.status).toBe('awaiting-observation');
    expect(rollup.terminalReason).toBeNull();
    expect(rollup.converged).toBe(false);
    expect(rollup.convergedWithDrops).toBe(false);
    expect(rollup.stopped).toBe(false);

    // Call deactivateIfTerminal to exercise the guard; it should NOT close the mission.
    deactivateIfTerminal(project, id);
    const m = getMission(project, id)!;
    expect(m.closedAt).toBeNull();
  });

  test('returns the mission to needs-discovery once the window elapses', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'first criterion');
    const c2 = addCriterion(project, id, 'second criterion (awaiting)');

    setCriterionMet(project, c1.id, true);
    const futureMs = Date.now() + 60_000;
    setCriterionMeasurementPendingUntil(project, c2.id, futureMs);

    // Verify awaiting-observation status while window is open.
    let rollup = getMissionRollup(project, id);
    expect(rollup.status).toBe('awaiting-observation');

    // Move the timestamp into the past to simulate window expiry.
    const pastMs = Date.now() - 1000;
    setCriterionMeasurementPendingUntil(project, c2.id, pastMs);

    // Verify status is now needs-discovery (the unmet criterion is no longer window-pending).
    rollup = getMissionRollup(project, id);
    expect(rollup.status).toBe('needs-discovery');
    expect(rollup.gaps).toBe(1);
  });

  test('leaves an awaiting-observation mission quiet in planMissionLoopStep', () => {
    const mission = {
      todoId: 'test-id',
      active: true,
      status: 'awaiting-observation' as const,
      lastNudgeAt: null,
      lastNudgeKey: null,
      title: '[MISSION] test',
    };
    const rollup = {
      capability: { met: 1, total: 2 },
      gaps: 1,
    };
    const input = {
      mission,
      rollup,
      target: 's1',
      idle: true,
      now: Date.now(),
      cooldownMs: 15 * 60 * 1000,
      escalationMs: 2 * 60 * 60 * 1000,
    };

    const action = planMissionLoopStep(input);
    expect(action.kind).toBe('none');
    expect(action.reason).toBe('no-action:awaiting-observation');
  });
});

describe('mission-closure-attribution: closedBy and closure cards', () => {
  test('raises one card and records the judge when a mission closes with an unmet criterion', async () => {
    const id = await makeMissionNode();
    upsertMission(project, id);
    const c1 = addCriterion(project, id, 'first criterion (will be met)');
    const c2 = addCriterion(project, id, 'second criterion (will stay unmet)');

    // Set one criterion to met, leaving the other unmet
    setCriterionMet(project, c1.id, true);

    // Close the mission with a judge attribution
    setMissionClosed(project, id, Date.now(), { judge: 'test-judge' });

    // Verify the mission records the judge and unmet criterion evidence
    const m = getMission(project, id)!;
    expect(m.closedBy).toBe('test-judge');
    expect(m.closureEvidence).toBeTruthy();

    // Verify evidence contains the unmet criterion id
    const evidence = JSON.parse(m.closureEvidence!);
    expect(evidence.unmetCriterionIds).toContain(c2.id);
    expect(evidence.unmetCriterionIds.length).toBe(1);

    // Verify one open escalation was created with the right conditionKey
    const allCards = listOpenEscalations();
    const filteredCards = allCards.filter(e => e.conditionKey === `mission-closed-unmet:${id}`);
    expect(filteredCards.length).toBe(1);
    expect(filteredCards[0].kind).toBe('mission-closed-unmet');

    // Close the mission again with the same judge — verify the card count doesn't increase
    setMissionClosed(project, id, Date.now(), { judge: 'test-judge' });
    const allCardsAfterSecond = listOpenEscalations();
    const filteredCardsAfterSecond = allCardsAfterSecond.filter(e => e.conditionKey === `mission-closed-unmet:${id}`);
    expect(filteredCardsAfterSecond.length).toBe(1);
  });
});
