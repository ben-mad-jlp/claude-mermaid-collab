import { describe, test, expect, beforeEach } from 'bun:test';
import { runMissionLoopPass, _resetOpenStallCards, type MissionLoopDeps } from '../mission-loop.ts';
import { _resetStallObservations, type MissionStallFacts } from '../mission-stall-predicate.ts';
import {
  stalledForMs,
  isMissionStalled,
  noteMissionLoopReason,
  _resetMissionStallClock,
} from '../mission-stall.ts';
import { deriveMissionStatus, type MissionStatusFacts, type MissionSummary } from '../mission-store.ts';

const PROJECT = '/p';
const MISSION_ID = 'm1';

beforeEach(() => {
  _resetStallObservations();
  _resetOpenStallCards();
  _resetMissionStallClock();
});

function baseFacts(overrides: Partial<MissionStallFacts> = {}): MissionStallFacts {
  return {
    missionActive: true,
    unmetCriteria: 1,
    serveableGaps: 0,
    awaitingVerify: 0,
    verifyInFlight: 0,
    epicsBuilding: 0,
    leavesRunning: 0,
    landInFlight: 0,
    integrating: 0,
    recycling: 0,
    budgetPaused: false,
    baseRedCooldown: false,
    blockedCriterionIds: ['c1'],
    hasOpenCardForKey: false,
    ...overrides,
  };
}

/** Mission fixture whose planMissionLoopStep outcome is always `blocked-silenced`
 *  (STALLED-classified, non-null episode) regardless of the injected stall facts —
 *  isolates the test from planMissionLoopStep's own gating. */
function missionSummary(): MissionSummary {
  return {
    node: { id: MISSION_ID, title: '[MISSION] test', status: 'todo' },
    ownerSession: 'session-1',
    assigneeSession: null,
    mission: {
      todoId: MISSION_ID,
      status: 'blocked',
      active: true,
      lastNudgeAt: 1,
      lastNudgeKey: 'k',
    } as MissionSummary['mission'],
    rollup: { capability: { met: 0, total: 1 }, gaps: 0, awaitingVerify: 0 } as MissionSummary['rollup'],
    criteria: [{ id: 'c1', met: false } as MissionSummary['criteria'][number]],
    epics: [],
  };
}

function runDeps(facts: MissionStallFacts, overrides: Partial<MissionLoopDeps> = {}) {
  const createEscalation: any[] = [];
  const resolveStallEscalation: any[] = [];
  const deps: MissionLoopDeps = {
    list: () => [missionSummary()],
    isIdle: () => true,
    buildStallFacts: () => facts,
    createEscalation: ((input: any) => {
      createEscalation.push(input);
    }) as MissionLoopDeps['createEscalation'],
    resolveStallEscalation: ((project: string, conditionKey: string) => {
      resolveStallEscalation.push({ project, conditionKey });
    }) as MissionLoopDeps['resolveStallEscalation'],
    ...overrides,
  };
  return { deps, createEscalation, resolveStallEscalation };
}

describe('mission-loop stall raise wiring', () => {
  test('genuinely stalled facts across 2 ticks raise exactly one human escalation', async () => {
    const { deps, createEscalation } = runDeps(baseFacts());

    await runMissionLoopPass(PROJECT, { ...deps, now: 1000 });
    expect(createEscalation.length).toBe(0);

    await runMissionLoopPass(PROJECT, { ...deps, now: 2000 });
    expect(createEscalation.length).toBe(1);
    expect(createEscalation[0].audience).toBe('human');
    expect(createEscalation[0].operatorGated).toBe(true);
    expect(createEscalation[0].conditionKey).toMatch(/^mission-stalled:m1:[0-9a-f]{16}$/);
  });

  const notStalledFixtures: Array<[string, Partial<MissionStallFacts>]> = [
    ['epicsBuilding', { epicsBuilding: 1 }],
    ['awaitingVerify', { awaitingVerify: 1 }],
    ['verifyInFlight', { verifyInFlight: 1 }],
    ['landInFlight', { landInFlight: 1 }],
    ['integrating', { integrating: 1 }],
    ['recycling', { recycling: 1 }],
    ['budgetPaused', { budgetPaused: true }],
    ['baseRedCooldown', { baseRedCooldown: true }],
  ];

  for (const [name, override] of notStalledFixtures) {
    test(`${name} defeats the stall conjunction — zero escalations`, async () => {
      const { deps, createEscalation } = runDeps(baseFacts(override));
      await runMissionLoopPass(PROJECT, { ...deps, now: 1000 });
      await runMissionLoopPass(PROJECT, { ...deps, now: 2000 });
      expect(createEscalation.length).toBe(0);
    });
  }

  test('10 further ticks after the first raise never raise a second card', async () => {
    let hasOpenCardForKey = false;
    const { deps, createEscalation } = runDeps(baseFacts());
    deps.buildStallFacts = () => baseFacts({ hasOpenCardForKey });

    await runMissionLoopPass(PROJECT, { ...deps, now: 1000 });
    await runMissionLoopPass(PROJECT, { ...deps, now: 2000 });
    expect(createEscalation.length).toBe(1);

    hasOpenCardForKey = true; // mirror the now-existing card
    for (let i = 0; i < 10; i++) {
      await runMissionLoopPass(PROJECT, { ...deps, now: 3000 + i * 1000 });
    }
    expect(createEscalation.length).toBe(1);
  });

  test('a forward-progress delta resolves the raised escalation exactly once', async () => {
    let facts = baseFacts();
    const { deps, createEscalation, resolveStallEscalation } = runDeps(baseFacts());
    deps.buildStallFacts = () => facts;

    await runMissionLoopPass(PROJECT, { ...deps, now: 1000 });
    await runMissionLoopPass(PROJECT, { ...deps, now: 2000 });
    expect(createEscalation.length).toBe(1);
    const conditionKey = createEscalation[0].conditionKey;

    // Forward-progress delta: an in-flight counter goes positive.
    facts = baseFacts({ epicsBuilding: 1 });
    await runMissionLoopPass(PROJECT, { ...deps, now: 3000 });
    expect(resolveStallEscalation.length).toBe(1);
    expect(resolveStallEscalation[0]).toEqual({ project: PROJECT, conditionKey });

    // Subsequent silent (still not-stalled, no delta) tick: no second resolve.
    await runMissionLoopPass(PROJECT, { ...deps, now: 4000 });
    expect(resolveStallEscalation.length).toBe(1);
  });

  test('a restart with an empty open-card map still clears the stall episode when work is in flight', async () => {
    const NOW = 5000;
    const { deps } = runDeps(baseFacts());

    // Open the episode with a STALLED reason.
    noteMissionLoopReason(PROJECT, MISSION_ID, 'stalled', NOW);
    expect(stalledForMs(PROJECT, MISSION_ID, NOW)).toBeGreaterThanOrEqual(0);

    // Simulate restart: empty the open-card map. The loop reason rebuilds the STALLED
    // classification via the none/blocked-silenced path, but work is actually in flight.
    _resetOpenStallCards();
    expect(stalledForMs(PROJECT, MISSION_ID, NOW)).toBeGreaterThanOrEqual(0);

    // The missionSummary fixture + buildStallFacts with leavesRunning: 1 drives the
    // none/blocked-silenced branch, which re-feeds the STALLED reason BEFORE the clear runs
    // (that is the exact ordering the fix must survive).
    deps.buildStallFacts = () => baseFacts({ leavesRunning: 1 });
    await runMissionLoopPass(PROJECT, { ...deps, now: NOW });

    // The stall episode must be cleared (inFlight is unconditional now).
    expect(stalledForMs(PROJECT, MISSION_ID, NOW)).toBeNull();

    // The derived status must read 'building' because work is in flight, not 'stalled'.
    const statusFacts: MissionStatusFacts = {
      abandonedAt: null,
      budgetUsd: null,
      spendUsd: 0,
      hasBlockedLeaf: false,
      hasBuildingLeaf: true, // work is in flight
      hasLandedEpic: false,
      hasOpenEpic: true,
      criteria: [],
      stalled: isMissionStalled(PROJECT, MISSION_ID, NOW),
    };
    const derivedStatus = deriveMissionStatus(statusFacts);
    expect(derivedStatus).toBe('building');
  });
});
