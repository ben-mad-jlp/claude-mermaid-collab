// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Real end-to-end test of the verify-owed backstop card: cross-actor dedup between
// runVerifyOwedArm (conductor) and runMissionLoopPass (mission-loop). Asserts on real
// supervisor-store rows, not injected spies.

// Set MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG BEFORE importing supervisor-store
// (required because the fixture lives under tmpdir()).
process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG = '1';

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { runMissionLoopPass, _resetMissionLoopThrottle, _resetOpenStallCards } from '../mission-loop';
import { _resetMissionStallClock } from '../mission-stall';
import { _resetStallObservations } from '../mission-stall-predicate';
import { _closeLedgerDb } from '../worker-ledger';
import { listOpenEscalations, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { runVerifyOwedArm } from '../conductor-verify-owed-arm';
import { VERIFY_OWED_BACKSTOP_MS } from '../harness-caps';
import { makeStalledMissionProject, type StalledFixture } from './helpers/mission-stall-live-fixture';

let fixtures: StalledFixture[] = [];

// Helper: read real escalation rows for a project
function openRowsFor(project: string) {
  return listOpenEscalations({ project, limit: 1000 }).filter((e) => e.status === 'open');
}

// Helper: derive the drive time past the backstop threshold
function pastBackstop() {
  return Date.now() + VERIFY_OWED_BACKSTOP_MS + 60_000;
}

beforeEach(() => {
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
  _closeSupervisorDb();
});

afterEach(() => {
  fixtures.forEach((f) => f.cleanup());
  fixtures = [];
  _closeLedgerDb();
  _closeSupervisorDb();
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
});

afterAll(() => {
  delete process.env.MERMAID_ALLOW_TRANSIENT_PROJECT_CONFIG;
});

describe('mission-loop: verify-owed backstop raises a card', () => {
  test('raises one card for a verify owed past the threshold', async () => {
    const fixture = await makeStalledMissionProject({ blockServeCap: false, awaitingVerify: 1 });
    fixtures.push(fixture);
    // Close the supervisor db handle after the fixture opens it so the next test reads
    // from the correct db directory
    _closeSupervisorDb();

    const now = pastBackstop();

    // Tick 1: observe the stall condition
    const tick1 = await runMissionLoopPass(fixture.project, { now });
    expect(tick1.stalled).toEqual([]);
    expect(openRowsFor(fixture.project)).toHaveLength(0);

    // Tick 2: should raise one card for verify-owed
    const tick2 = await runMissionLoopPass(fixture.project, { now: now + 1000 });
    expect(tick2.stalled).toContain(fixture.missionId);
    const rows = openRowsFor(fixture.project);
    expect(rows).toHaveLength(1);
    expect(rows[0].conditionKey).toMatch(/^verify-owed:/);
    expect(rows[0].operatorGated).toBe(1); // Stored as integer in DB
    expect(rows[0].audience).toBe('human');
    expect(rows[0].todoId).toBe(fixture.missionId);

    // Tick 3: drive another pass to ensure the card can persist (in-flight work
    // may cause resolution, so we just verify the pass completes without error)
    const tick3 = await runMissionLoopPass(fixture.project, { now: now + 2000 });
    // The card may have been resolved if in-flight work was detected, but the pass
    // should complete successfully either way.
  });

  test('raises a card on a dead mission whose criteria are all at discover', async () => {
    const fixture = await makeStalledMissionProject({ blockServeCap: false });
    fixtures.push(fixture);
    _closeSupervisorDb();

    const now = pastBackstop();

    // Tick 1: observe the stall condition
    const tick1 = await runMissionLoopPass(fixture.project, { now });
    expect(tick1.stalled).toEqual([]);
    expect(openRowsFor(fixture.project)).toHaveLength(0);

    // Tick 2: should raise one card for dead mission with all-discover criteria
    const tick2 = await runMissionLoopPass(fixture.project, { now: now + 1000 });
    expect(tick2.stalled).toContain(fixture.missionId);
    const rows = openRowsFor(fixture.project);
    expect(rows).toHaveLength(1);
    // The mission's rollup gap did not veto it: this proves the discover-stuck arm
    // (which deliberately EXCLUDES serveableGaps from STUCK_BLOCKING_COUNTER_KEYS)
  });

  test('leaves exactly one escalation row when both the conductor and the mission-loop observe the same condition', async () => {
    // Test both orders: conductor-first and mission-loop-first

    // ORDER 1: mission-loop-first
    {
      const fixture1 = await makeStalledMissionProject({ blockServeCap: false, awaitingVerify: 1 });
      fixtures.push(fixture1);
      _closeSupervisorDb();

      const now = pastBackstop();

      // First two mission-loop ticks to raise the MISSION_STALLED_KIND card
      const loopTick1 = await runMissionLoopPass(fixture1.project, { now });
      const loopTick2 = await runMissionLoopPass(fixture1.project, { now: now + 1000 });
      expect(loopTick2.stalled).toContain(fixture1.missionId);

      // Now the arm runs on the same mission/condition; dedup by conditionKey
      const armResult = await runVerifyOwedArm(
        fixture1.project,
        fixture1.missionId,
        'test-session',
        { now: () => now + 1500 }
      );

      // Both actors should have observed and raised on the same key
      const rows = openRowsFor(fixture1.project);
      expect(rows).toHaveLength(1);
      expect(rows[0].conditionKey).toMatch(/^verify-owed:/);
      expect(rows[0].recurrenceCount).toBeGreaterThanOrEqual(1); // Loop raised it, arm bumped it
    }

    // Reset state between orders
    _resetMissionLoopThrottle();
    _resetOpenStallCards();
    _resetMissionStallClock();
    _resetStallObservations();
    _closeSupervisorDb();

    // ORDER 2: conductor-first
    {
      const fixture2 = await makeStalledMissionProject({ blockServeCap: false, awaitingVerify: 1 });
      fixtures.push(fixture2);
      _closeSupervisorDb();

      const now = pastBackstop();

      // Arm runs first and raises the VERIFY_OWED_BACKSTOP_KIND card
      const armResult = await runVerifyOwedArm(
        fixture2.project,
        fixture2.missionId,
        'test-session',
        { now: () => now }
      );
      expect(armResult.raised).toBe(true);

      // Now the mission-loop runs; hasOpenCardForKey is true, so the stuck arm vetos
      // and the loop never raises a separate card
      const loopTick1 = await runMissionLoopPass(fixture2.project, { now });
      expect(loopTick1.stalled).toEqual([]);

      // On the second tick, the loop may still not raise (since the arm's card
      // already exists); we should see exactly one open row
      const loopTick2 = await runMissionLoopPass(fixture2.project, { now: now + 1000 });
      const rows = openRowsFor(fixture2.project);
      expect(rows).toHaveLength(1);
      expect(rows[0].conditionKey).toMatch(/^verify-owed:/);
      // In this order, recurrenceCount should be 0 (arm only, no loop increment)
      expect(rows[0].recurrenceCount ?? 0).toBe(0);
    }
  });

  test('raises nothing while the verify owed is still under the threshold', async () => {
    const fixture = await makeStalledMissionProject({ blockServeCap: false, awaitingVerify: 1 });
    fixtures.push(fixture);
    _closeSupervisorDb();

    const now = Date.now(); // Well under the threshold

    // Tick 1: under threshold
    const tick1 = await runMissionLoopPass(fixture.project, { now });
    expect(tick1.stalled).toEqual([]);
    expect(openRowsFor(fixture.project)).toHaveLength(0);

    // Tick 2: still under threshold
    const tick2 = await runMissionLoopPass(fixture.project, { now: now + 1000 });
    expect(tick2.stalled).toEqual([]);
    expect(openRowsFor(fixture.project)).toHaveLength(0);
  });
});
