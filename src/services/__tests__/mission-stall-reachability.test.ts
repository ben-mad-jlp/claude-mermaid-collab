// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { runMissionLoopPass, _resetMissionLoopThrottle, _resetOpenStallCards } from '../mission-loop';
import { _resetMissionStallClock } from '../mission-stall';
import { _resetStallObservations } from '../mission-stall-predicate';
import { _closeLedgerDb } from '../worker-ledger';
import { makeStalledMissionProject, type StalledFixture } from './helpers/mission-stall-live-fixture';

let fixture: StalledFixture | null = null;

beforeEach(() => {
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
});

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
  _closeLedgerDb();
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
});

describe('mission-loop: stall conjunction reachability', () => {
  test('raises exactly one mission-stalled card within 2 ticks when the mission nudge debounce goes quiet', async () => {
    fixture = await makeStalledMissionProject({ session: null });
    const created: Array<{ kind: string; conditionKey?: string; audience?: string; operatorGated?: boolean }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
    };

    const base = Date.now();
    const tick1 = await runMissionLoopPass(fixture.project, { ...deps, now: base });
    expect(created.length).toBe(0);
    expect(tick1.stalled).not.toContain(fixture.missionId);

    const tick2 = await runMissionLoopPass(fixture.project, { ...deps, now: base + 1_000 });

    expect(created.length).toBe(1);
    expect(created[0].kind).toBe('mission-stalled');
    expect(created[0].audience).toBe('human');
    expect(created[0].operatorGated).toBe(true);
    expect(created[0].conditionKey).toMatch(new RegExp(`^mission-stalled:${fixture.missionId}:`));
    expect(tick2.stalled).toContain(fixture.missionId);
  });

  test('a nudge fired while the conjunction still holds still cards', async () => {
    fixture = await makeStalledMissionProject({ session: 's1', sessionIdle: true });
    const created: Array<{ kind: string; conditionKey?: string }> = [];
    let nudgeCalls = 0;
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
      nudge: async () => {
        nudgeCalls++;
        return 'sent' as const;
      },
      // Force planMissionLoopStep to re-nudge on tick 2 even though the mission's
      // fingerprint hasn't changed — the point of this test is that the STALL
      // conjunction (independent of the nudge debounce) still cards even though the
      // loop keeps nudging.
      cooldownMs: 0,
      escalationMs: 0,
    };

    // stampMissionNudge (the default deps.stampNudge) stamps lastNudgeAt with the REAL wall
    // clock, not the injected `now` — so `now` here must stay anchored near Date.now() or the
    // second tick's `now - lastNudgeAt` cooldown/escalation math goes negative and the mission
    // never re-nudges.
    const base = Date.now();
    const tick1 = await runMissionLoopPass(fixture.project, { ...deps, now: base });
    expect(tick1.nudged).toContain(fixture.missionId);
    expect(created.length).toBe(0);

    const tick2 = await runMissionLoopPass(fixture.project, { ...deps, now: base + 1_000 });

    expect(nudgeCalls).toBe(2);
    expect(created.length).toBe(1);
    expect(created[0].kind).toBe('mission-stalled');
    expect(created[0].conditionKey).toMatch(new RegExp(`^mission-stalled:${fixture.missionId}:`));
  });
});
