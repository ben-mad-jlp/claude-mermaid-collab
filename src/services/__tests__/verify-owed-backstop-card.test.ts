// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Real end-to-end test of the verify-owed backstop card and age-gated discover-stuck paths.
// Drives real runMissionLoopPass → collectMissionStallFacts → evaluateStallAndMaybeRaise
// against mission-stall-live-fixture.ts's real store rows. No deps.buildStallFacts injection.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { runMissionLoopPass, _resetMissionLoopThrottle, _resetOpenStallCards } from '../mission-loop';
import { _resetMissionStallClock } from '../mission-stall';
import { _resetStallObservations } from '../mission-stall-predicate';
import { _closeLedgerDb } from '../worker-ledger';
import { createTodo, updateTodo } from '../todo-store';
import { addCriterion, setCriterionMet } from '../mission-store';
import {
  createEscalation as realCreateEscalation,
  _closeDb as _closeSupervisorDb,
} from '../supervisor-store';
import { recordNode } from '../worker-ledger';
import { makeStalledMissionProject, type StalledFixture } from './helpers/mission-stall-live-fixture';

let fixture: StalledFixture | null = null;

beforeEach(() => {
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
  _closeSupervisorDb();
});

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
  _closeLedgerDb();
  _closeSupervisorDb();
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
});

describe('mission-loop: verify-owed backstop raises a card', () => {
  test('raises one card for a verify owed past the threshold', async () => {
    fixture = await makeStalledMissionProject({ blockServeCap: false, awaitingVerify: 1 });
    const created: Array<{ kind: string; conditionKey?: string; conditionTuple?: string[] }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
    };

    // Drive at a future time past the backstop (VERIFY_OWED_BACKSTOP_MS = 10 minutes by default)
    // Fixture creates the criterion at Date.now(), so we need to advance past the threshold
    // to make the verify-owed condition fire. Use Date.now() + 11 minutes to be safe.
    const backstopMs = 10 * 60 * 1000; // VERIFY_OWED_BACKSTOP_MS default: 10 minutes
    const futureNow = Date.now() + backstopMs + 60000; // Add extra 1 minute for safety

    // Tick 1: observe the stall condition
    const tick1 = await runMissionLoopPass(fixture.project, { ...deps, now: futureNow });
    expect(tick1.stalled).toEqual([]);
    expect(created.length).toBe(0);

    // Tick 2: should raise one card for verify-owed
    const tick2 = await runMissionLoopPass(fixture.project, { ...deps, now: futureNow + 1000 });
    expect(tick2.stalled).toContain(fixture.missionId);
    expect(created.length).toBe(1);
    expect(created[0].kind).toBe('mission-stalled');
    expect(created[0].conditionKey).toMatch(/^verify-owed:/);
  });

  test('raises a card on a dead mission whose criteria are all at discover', async () => {
    fixture = await makeStalledMissionProject({ blockServeCap: false });
    const created: Array<{ kind: string; conditionKey?: string; conditionTuple?: string[] }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
    };

    // Drive at a future time past the backstop so discover-stuck criteria age into the stuck set
    // Fixture creates criteria at Date.now(), so advance past the threshold.
    const backstopMs = 10 * 60 * 1000; // VERIFY_OWED_BACKSTOP_MS default: 10 minutes
    const futureNow = Date.now() + backstopMs + 60000; // Add extra 1 minute for safety

    // Tick 1: observe the stall condition
    const tick1 = await runMissionLoopPass(fixture.project, { ...deps, now: futureNow });
    expect(tick1.stalled).toEqual([]);
    expect(created.length).toBe(0);

    // Tick 2: should raise one card for dead mission with all-discover criteria
    const tick2 = await runMissionLoopPass(fixture.project, { ...deps, now: futureNow + 1000 });
    expect(tick2.stalled).toContain(fixture.missionId);
    expect(created.length).toBe(1);
    expect(created[0].kind).toBe('mission-stalled');
  });
});
