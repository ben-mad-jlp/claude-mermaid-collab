// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
//
// Live end-to-end no-false-positive matrix: drives real runMissionLoopPass →
// planMissionLoopStep + the real (non-injected) collectMissionStallFacts against
// mission-stall-live-fixture.ts's real store rows. No deps.buildStallFacts anywhere here.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { runMissionLoopPass, _resetMissionLoopThrottle, _resetOpenStallCards } from '../mission-loop';
import { _resetMissionStallClock } from '../mission-stall';
import { _resetStallObservations } from '../mission-stall-predicate';
import { _closeLedgerDb } from '../worker-ledger';
import { createTodo, updateTodo, claimTodo } from '../todo-store';
import { setCriterionMet, addCriterion } from '../mission-store';
import {
  createEscalation as realCreateEscalation,
  listOpenEscalations as realListOpenEscalations,
  resolveEscalation as realResolveEscalation,
  _closeDb as _closeSupervisorDb,
} from '../supervisor-store';
import { makeStalledMissionProject, type StalledFixture, type StalledFixtureOpts } from './helpers/mission-stall-live-fixture';

let fixture: StalledFixture | null = null;

beforeEach(() => {
  _resetMissionLoopThrottle();
  _resetOpenStallCards();
  _resetMissionStallClock();
  _resetStallObservations();
  // collectMissionStallFacts (real) reads listOpenEscalations() from the shared supervisor.db
  // singleton — force it to reopen against THIS test's MERMAID_SUPERVISOR_DIR (each fixture
  // mkdtemps its own dir), else it stays pinned to whichever test opened it first.
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

describe('mission-loop: healthy/mid-work shapes never false-positive stall', () => {
  const shapes: Array<{ name: string; opts: StalledFixtureOpts }> = [
    { name: 'serveableGaps', opts: { gaps: 1 } },
    { name: 'awaitingVerify', opts: { awaitingVerify: 1 } },
    { name: 'epicsBuilding', opts: { epicsBuilding: 1 } },
    { name: 'leavesRunning', opts: { leavesRunning: true } },
    { name: 'landInFlight', opts: { landInFlight: true } },
    { name: 'recycling', opts: { recycling: true } },
    { name: 'budgetPaused', opts: { budgetPaused: true } },
  ];

  for (const shape of shapes) {
    test(`shape: ${shape.name} produces zero mission-stalled escalations across 5 ticks`, async () => {
      fixture = await makeStalledMissionProject(shape.opts);
      const created: Array<{ kind: string }> = [];
      const deps = {
        createEscalation: (input: any) => {
          created.push(input);
          return { id: `esc_${created.length}`, ...input } as any;
        },
      };

      const base = Date.now();
      for (let i = 0; i < 5; i++) {
        const result = await runMissionLoopPass(fixture.project, { ...deps, now: base + i * 1000 });
        expect(result.stalled).toEqual([]);
      }
      expect(created.filter((c) => c.kind === 'mission-stalled').length).toBe(0);
    });
  }

  test('shape: zero unmet criteria produces zero mission-stalled escalations across 5 ticks', async () => {
    fixture = await makeStalledMissionProject();
    setCriterionMet(fixture.project, fixture.criterionId, true);
    const created: Array<{ kind: string }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
    };

    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      const result = await runMissionLoopPass(fixture.project, { ...deps, now: base + i * 1000 });
      expect(result.stalled).toEqual([]);
    }
    expect(created.filter((c) => c.kind === 'mission-stalled').length).toBe(0);
  });

  test('shape: zero blockedCriterionIds produces zero mission-stalled escalations across 5 ticks', async () => {
    fixture = await makeStalledMissionProject({ blockServeCap: false });
    const created: Array<{ kind: string }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
    };

    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      const result = await runMissionLoopPass(fixture.project, { ...deps, now: base + i * 1000 });
      expect(result.stalled).toEqual([]);
    }
    expect(created.filter((c) => c.kind === 'mission-stalled').length).toBe(0);
  });
});

describe('mission-loop: debounce regression', () => {
  test('debounce: unchanged fingerprint within cooldown emits no nudge and no card', async () => {
    fixture = await makeStalledMissionProject({ blockServeCap: false });
    const created: Array<{ kind: string }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return { id: `esc_${created.length}`, ...input } as any;
      },
    };

    const base = Date.now();
    const tick1 = await runMissionLoopPass(fixture.project, { ...deps, now: base });
    expect(tick1.nudged).toContain(fixture.missionId);

    const tick2 = await runMissionLoopPass(fixture.project, { ...deps, now: base + 1_000 });
    expect(tick2.nudged).toEqual([]);
    expect(created.length).toBe(0);
  });

  test('debounce: fingerprint change past cooldown nudges exactly once', async () => {
    fixture = await makeStalledMissionProject({ blockServeCap: false });
    const created: Array<{ kind: string }> = [];
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
    };

    const base = Date.now();
    const tick1 = await runMissionLoopPass(fixture.project, { ...deps, now: base });
    expect(tick1.nudged).toContain(fixture.missionId);
    expect(nudgeCalls).toBe(1);

    const tick2 = await runMissionLoopPass(fixture.project, { ...deps, now: base + 1_000 });
    expect(tick2.nudged).toEqual([]);
    expect(nudgeCalls).toBe(1);

    addCriterion(fixture.project, fixture.missionId, 'a new gap');

    const tick3 = await runMissionLoopPass(fixture.project, { ...deps, now: base + 2_000, cooldownMs: 0 });
    expect(tick3.nudged).toEqual([fixture.missionId]);
    expect(nudgeCalls).toBe(2);
    expect(created.length).toBe(0);
  });
});

describe('mission-loop: idempotence', () => {
  // collectMissionStallFacts (the real, non-injected one used throughout this file) reads
  // hasOpenCardForKey from the REAL escalation store — so idempotence/auto-resolve only
  // reproduces its production shape if createEscalation/resolveStallEscalation actually
  // persist, not just record calls. Wrap the real store functions so both the call-count
  // assertions and the store-backed suppression/resolution the production code depends on
  // both work.
  test('idempotence: 10 further ticks after the first raise produce exactly one escalation', async () => {
    fixture = await makeStalledMissionProject({ session: null });
    const created: Array<{ kind: string; conditionKey?: string }> = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return realCreateEscalation(input);
      },
    };

    const base = Date.now();
    await runMissionLoopPass(fixture.project, { ...deps, now: base });
    await runMissionLoopPass(fixture.project, { ...deps, now: base + 1_000 });
    expect(created.length).toBe(1);

    for (let i = 0; i < 10; i++) {
      await runMissionLoopPass(fixture.project, { ...deps, now: base + 2_000 + i * 1000 });
    }
    expect(created.length).toBe(1);
  });

  test('idempotence: forward progress auto-resolves the open card exactly once, and a later re-stall starts a fresh count at 1', async () => {
    fixture = await makeStalledMissionProject({ session: null });
    const created: Array<{ kind: string; conditionKey?: string }> = [];
    const resolved: string[] = [];
    const deps = {
      createEscalation: (input: any) => {
        created.push(input);
        return realCreateEscalation(input);
      },
      resolveStallEscalation: (project: string, conditionKey: string) => {
        resolved.push(conditionKey);
        const open = realListOpenEscalations().find((e) => e.project === project && e.conditionKey === conditionKey);
        if (open) realResolveEscalation(open.id, 'resolved', 'ai');
      },
    };

    const base = Date.now();
    await runMissionLoopPass(fixture.project, { ...deps, now: base });
    await runMissionLoopPass(fixture.project, { ...deps, now: base + 1_000 });
    expect(created.length).toBe(1);
    const firstConditionKey = created[0].conditionKey!;

    const epic = await createTodo(fixture.project, {
      kind: 'epic',
      parentId: fixture.missionId,
      ownerSession: 'mission-loop',
      title: '[EPIC] in flight',
      status: 'ready',
    });
    await claimTodo(fixture.project, epic.id, 'mission-loop', 60_000);

    await runMissionLoopPass(fixture.project, { ...deps, now: base + 2_000 });
    expect(resolved).toEqual([firstConditionKey]);

    await updateTodo(fixture.project, epic.id, { status: 'dropped', force: true });

    await runMissionLoopPass(fixture.project, { ...deps, now: base + 3_000 });
    await runMissionLoopPass(fixture.project, { ...deps, now: base + 4_000 });
    expect(created.length).toBe(2);
  });
});
