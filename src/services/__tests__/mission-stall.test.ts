import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE the store module opens it (the runner's
// stall/re-bet cards are written through the real escalation store).
const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-stall-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import {
  MISSION_LOOP_REASON_CLASS,
  MISSION_STALLED_KIND,
  _resetMissionStallClock,
  baseReason,
  buildStallCardText,
  claimStallCard,
  classifyMissionLoopReason,
  clearMissionStall,
  getStallEpisode,
  isMissionStalled,
  isStalledReason,
  noteMissionLoopReason,
  stallConditionKey,
  stalledForMs,
  type MissionLoopReasonBase,
} from '../mission-stall';
import { MISSION_STALL_GRACE_MS, MISSION_STALL_FLAG_TTL_MS } from '../harness-caps';
import { planMissionLoopStep, runMissionLoopPass, type MissionLoopStepInput } from '../mission-loop';
import { deriveMissionStatus, deriveCheapMissionStatus, type MissionStatusFacts } from '../mission-store';

const NOW = 1_700_000_000_000;
const PROJECT = '/p';

beforeEach(() => { _resetMissionStallClock(); });

// ---------------------------------------------------------------------------
// The classification table — QUIET vs STALLED
// ---------------------------------------------------------------------------

describe('mission-loop none-reason classification', () => {
  test('QUIET reasons are exactly the healthy no-ops', () => {
    const quiet = (Object.keys(MISSION_LOOP_REASON_CLASS) as MissionLoopReasonBase[])
      .filter((r) => MISSION_LOOP_REASON_CLASS[r] === 'quiet')
      .sort();
    expect(quiet).toEqual(
      (['building', 'inactive', 'converged', 'abandoned', 'session-busy', 'nudge-cooldown', 'nudge-fingerprint-unchanged'] as MissionLoopReasonBase[]).sort(),
    );
  });

  test('STALLED reasons are exactly the "nobody is coming" no-ops', () => {
    const stalled = (Object.keys(MISSION_LOOP_REASON_CLASS) as MissionLoopReasonBase[])
      .filter((r) => MISSION_LOOP_REASON_CLASS[r] === 'stalled')
      .sort();
    expect(stalled).toEqual(
      (['over-budget', 'no-owner-session', 'blocked-silenced', 'stalled', 'no-action'] as MissionLoopReasonBase[]).sort(),
    );
  });

  test('a detailed no-action:<status> reason classifies on its base', () => {
    expect(baseReason('no-action:building')).toBe('no-action');
    expect(classifyMissionLoopReason('no-action:needs-verify')).toBe('stalled');
    expect(isStalledReason('no-action:whatever')).toBe(true);
  });

  test('an UNRECOGNISED reason classifies STALLED — silence is the failure mode, so be loud', () => {
    expect(classifyMissionLoopReason('some-future-reason-nobody-classified')).toBe('stalled');
  });

  test('every reason planMissionLoopStep can emit is classified', () => {
    // Drive the planner through each of its no-op arms and assert the reason is in the table.
    const base: MissionLoopStepInput = {
      mission: { todoId: 'm1', status: 'needs-discovery', lastNudgeAt: null, lastNudgeKey: null, title: 'goal', active: true },
      rollup: { capability: { met: 0, total: 2 } },
      ownerSession: 'design', idle: true, now: NOW, cooldownMs: 15 * 60_000, escalationMs: 2 * 3600_000,
    };
    const cases: MissionLoopStepInput[] = [
      { ...base, mission: { ...base.mission, active: false } },
      { ...base, mission: { ...base.mission, status: 'converged' } },
      { ...base, mission: { ...base.mission, status: 'abandoned' } },
      { ...base, mission: { ...base.mission, status: 'over-budget' } },
      { ...base, mission: { ...base.mission, status: 'stalled' } },
      { ...base, mission: { ...base.mission, status: 'building' } },
      { ...base, mission: { ...base.mission, status: 'unapproved' } },
      { ...base, ownerSession: null },
      { ...base, idle: false },
      { ...base, mission: { ...base.mission, status: 'blocked', lastNudgeAt: NOW - 1 } },
      { ...base, mission: { ...base.mission, lastNudgeAt: NOW - 1, lastNudgeKey: 'needs-discovery:0/2:g0:v0' } },
    ];
    for (const c of cases) {
      const a = planMissionLoopStep(c);
      if (a.kind !== 'none') continue;
      expect(['quiet', 'stalled']).toContain(classifyMissionLoopReason(a.reason));
      // Not the unknown-reason fallback: the base must be a real table key.
      expect(Object.keys(MISSION_LOOP_REASON_CLASS)).toContain(baseReason(a.reason));
    }
  });
});

// ---------------------------------------------------------------------------
// The stall clock
// ---------------------------------------------------------------------------

describe('stall clock', () => {
  test('a QUIET reason opens no episode and clears an open one', () => {
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW);
    expect(getStallEpisode(PROJECT, 'm1', NOW)).not.toBeNull();
    expect(noteMissionLoopReason(PROJECT, 'm1', 'building', NOW + 1000)).toBeNull();
    expect(getStallEpisode(PROJECT, 'm1', NOW + 1000)).toBeNull();
  });

  test('a stalled mission is not "stalled" until the grace window elapses', () => {
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW);
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW + MISSION_STALL_GRACE_MS - 1);
    expect(isMissionStalled(PROJECT, 'm1', NOW + MISSION_STALL_GRACE_MS - 1)).toBe(false);
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW + MISSION_STALL_GRACE_MS);
    expect(isMissionStalled(PROJECT, 'm1', NOW + MISSION_STALL_GRACE_MS)).toBe(true);
    expect(stalledForMs(PROJECT, 'm1', NOW + MISSION_STALL_GRACE_MS)).toBe(MISSION_STALL_GRACE_MS);
  });

  test('the episode reason is PINNED at the start — drift must not re-key the card', () => {
    noteMissionLoopReason(PROJECT, 'm1', 'blocked-silenced', NOW);
    const ep = noteMissionLoopReason(PROJECT, 'm1', 'stalled', NOW + 60_000);
    expect(ep?.reason).toBe('blocked-silenced');
    expect(stallConditionKey('m1', ep!.reason)).toBe('mission-stalled:m1:blocked-silenced');
  });

  test('an un-observed episode expires (TTL) instead of latching a mission at stalled forever', () => {
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW);
    const later = NOW + MISSION_STALL_FLAG_TTL_MS + 1;
    expect(isMissionStalled(PROJECT, 'm1', later)).toBe(false);
    expect(getStallEpisode(PROJECT, 'm1', later)).toBeNull();
    // …and a stall observed after the TTL starts a FRESH clock, not an instant card.
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', later);
    expect(isMissionStalled(PROJECT, 'm1', later)).toBe(false);
  });

  test('clearMissionStall ends the episode (the mission demonstrably moved)', () => {
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW);
    clearMissionStall(PROJECT, 'm1');
    expect(getStallEpisode(PROJECT, 'm1', NOW)).toBeNull();
  });

  test('claimStallCard bounds an episode to exactly one card', () => {
    noteMissionLoopReason(PROJECT, 'm1', 'no-owner-session', NOW);
    expect(claimStallCard(PROJECT, 'm1')).toBe(true);
    expect(claimStallCard(PROJECT, 'm1')).toBe(false);
  });

  test('the card text names the mission, the reason, the duration and a remedy', () => {
    const text = buildStallCardText({
      missionId: 'm1', missionTitle: 'ship X', reason: 'no-owner-session', stalledForMs: 105 * 60_000,
    });
    expect(text).toContain('ship X');
    expect(text).toContain('m1');
    expect(text).toContain('no-owner-session');
    expect(text).toContain('1h45m');
    expect(text).toContain('set_mission_owner');
  });
});

// ---------------------------------------------------------------------------
// Derived status — a stalled mission must never read "building"
// ---------------------------------------------------------------------------

describe('derived status while stalled', () => {
  const facts = (over: Partial<MissionStatusFacts> = {}): MissionStatusFacts => ({
    abandonedAt: null, budgetUsd: null, spendUsd: 0,
    hasBlockedLeaf: false, hasBuildingLeaf: true, hasLandedEpic: false, hasOpenEpic: true,
    criteria: [], ...over,
  });

  test('full derivation: a stalled mission derives "stalled", not "building"', () => {
    expect(deriveMissionStatus(facts({ stalled: false }))).not.toBe('stalled');
    expect(deriveMissionStatus(facts({ stalled: true }))).toBe('stalled');
  });

  test('full derivation: stalled outranks blocked/building but NOT abandoned or over-budget', () => {
    expect(deriveMissionStatus(facts({ stalled: true, hasBlockedLeaf: true }))).toBe('stalled');
    expect(deriveMissionStatus(facts({ stalled: true, abandonedAt: 1 }))).toBe('abandoned');
    expect(deriveMissionStatus(facts({ stalled: true, budgetUsd: 10, spendUsd: 11 }))).toBe('over-budget');
  });

  test('CHEAP list-badge derivation: the line that read "BUILDING" for 1h45m now reads "stalled"', () => {
    const row = { abandonedAt: null, awaitingApprovalSince: null };
    expect(deriveCheapMissionStatus(row, [], [{ met: false }], false)).toBe('building');
    expect(deriveCheapMissionStatus(row, [], [{ met: false }], true)).toBe('stalled');
    // A converged mission still reads converged — a stale flag can't mask the done signal.
    expect(deriveCheapMissionStatus(row, [], [{ met: true }], true)).toBe('converged');
  });
});

// ---------------------------------------------------------------------------
// The runner: cards
// ---------------------------------------------------------------------------

type EscCall = { kind: string; conditionKey?: string | null; questionText: string; todoId?: string | null };

function summary(over: Record<string, unknown> = {}) {
  return {
    node: { id: 'm1', title: 'ship X', status: 'planned' },
    ownerSession: 'design', assigneeSession: 'design',
    mission: { todoId: 'm1', status: 'needs-discovery', lastNudgeAt: null, lastNudgeKey: null, active: true },
    rollup: { converged: false, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 2 } },
    criteria: [], epics: [], ...over,
  } as never;
}

function spyEscalation(calls: EscCall[]) {
  return ((input: EscCall) => {
    calls.push(input);
    return { escalation: { id: `e${calls.length}` }, isNew: true };
  }) as never;
}

describe('runMissionLoopPass — no silent stop', () => {
  test('a QUIET reason (building) raises NO card, ever', async () => {
    const calls: EscCall[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await runMissionLoopPass(PROJECT, {
        list: () => [summary({ mission: { todoId: 'm1', status: 'building', lastNudgeAt: null, active: true } })],
        isIdle: () => true, nudge: async () => 'sent',
        now: NOW + i * MISSION_STALL_GRACE_MS, // far past any grace window
        createEscalation: spyEscalation(calls),
      });
      expect(r.stalled).toEqual([]);
    }
    expect(calls).toHaveLength(0);
  });

  test('a QUIET reason (converged / inactive / cooldown) raises NO card', async () => {
    const calls: EscCall[] = [];
    const quietMissions = [
      summary({ mission: { todoId: 'm1', status: 'converged', lastNudgeAt: null, active: true } }),
      summary({ node: { id: 'm2', title: 'b', status: 'planned' }, mission: { todoId: 'm2', status: 'needs-discovery', lastNudgeAt: null, active: false } }),
      summary({
        node: { id: 'm3', title: 'c', status: 'planned' },
        mission: { todoId: 'm3', status: 'needs-discovery', lastNudgeAt: NOW - 1, lastNudgeKey: 'needs-discovery:0/2:g0:v0', active: true },
      }),
    ];
    for (let i = 0; i < 10; i++) {
      await runMissionLoopPass(PROJECT, {
        list: () => quietMissions, isIdle: () => true, nudge: async () => 'sent',
        now: NOW + i * MISSION_STALL_GRACE_MS,
        createEscalation: spyEscalation(calls),
      });
    }
    expect(calls).toHaveLength(0);
  });

  test('a STALLED reason held past the grace window → exactly ONE card; later ticks do not flood', async () => {
    const calls: EscCall[] = [];
    const stuck = () => [summary({ ownerSession: null, assigneeSession: null })]; // → no-owner-session
    const tick = (now: number) => runMissionLoopPass(PROJECT, {
      list: stuck, isIdle: () => true, nudge: async () => 'sent', now,
      createEscalation: spyEscalation(calls),
    });

    // Inside the grace window: still silent (a session blip must not card a human).
    await tick(NOW);
    await tick(NOW + MISSION_STALL_GRACE_MS - 1);
    expect(calls).toHaveLength(0);

    // Past the grace window: exactly one card.
    const r = await tick(NOW + MISSION_STALL_GRACE_MS);
    expect(r.stalled).toEqual(['m1']);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe(MISSION_STALLED_KIND);
    expect(calls[0].todoId).toBe('m1');
    expect(calls[0].conditionKey).toBe(stallConditionKey('m1', 'no-owner-session'));
    expect(calls[0].questionText).toContain('STALLED');

    // Ten more ticks on the same stall: no flood.
    for (let i = 1; i <= 10; i++) await tick(NOW + MISSION_STALL_GRACE_MS + i * 60_000);
    expect(calls).toHaveLength(1);
  });

  test('recovery then a NEW stall episode re-arms the card', async () => {
    const calls: EscCall[] = [];
    let owner: string | null = null;
    const tick = (now: number) => runMissionLoopPass(PROJECT, {
      list: () => [summary({ ownerSession: owner, assigneeSession: owner })],
      isIdle: () => true, nudge: async () => 'sent', now,
      createEscalation: spyEscalation(calls),
    });
    await tick(NOW);
    await tick(NOW + MISSION_STALL_GRACE_MS);
    expect(calls).toHaveLength(1);

    // The mission gets an owner and is nudged → the episode ends.
    owner = 'design';
    await tick(NOW + MISSION_STALL_GRACE_MS + 60_000);
    expect(isMissionStalled(PROJECT, 'm1', NOW + MISSION_STALL_GRACE_MS + 60_000)).toBe(false);

    // It loses the owner again → a fresh episode, a fresh card after a fresh grace window.
    owner = null;
    const t2 = NOW + MISSION_STALL_GRACE_MS + 120_000;
    await tick(t2);
    expect(calls).toHaveLength(1); // still inside the new grace window
    await tick(t2 + MISSION_STALL_GRACE_MS);
    expect(calls).toHaveLength(2);
  });

  test('FAIL OPEN: a throwing card path still completes the tick', async () => {
    const boom = (() => { throw new Error('escalation store down'); }) as never;
    const r = await runMissionLoopPass(PROJECT, {
      list: () => [summary({ ownerSession: null, assigneeSession: null })],
      isIdle: () => true, nudge: async () => 'sent',
      now: NOW + MISSION_STALL_GRACE_MS * 3,
      createEscalation: boom,
    });
    expect(r.project).toBe(PROJECT);
    expect(r.skipped).toBe(1);
    expect(r.stalled).toEqual([]);
  });

  test('FAIL OPEN: a throwing re-bet path still completes the tick', async () => {
    const r = await runMissionLoopPass(PROJECT, {
      list: () => [summary({ mission: { todoId: 'm1', status: 'over-budget', lastNudgeAt: null, active: true } })],
      isIdle: () => true, nudge: async () => 'sent', now: NOW,
      raiseRebetCard: (() => { throw new Error('briefing blew up'); }) as never,
    });
    expect(r.skipped).toBe(1);
    expect(r.overBudget).toEqual([]);
  });

  test('over-budget cards IMMEDIATELY (no grace) and skips the generic stall card', async () => {
    const calls: EscCall[] = [];
    let rebetCalls = 0;
    const r = await runMissionLoopPass(PROJECT, {
      list: () => [summary({ mission: { todoId: 'm1', status: 'over-budget', lastNudgeAt: null, active: true } })],
      isIdle: () => true, nudge: async () => 'sent', now: NOW,
      createEscalation: spyEscalation(calls),
      raiseRebetCard: ((..._a: unknown[]) => { rebetCalls++; return { raised: true, isNew: rebetCalls === 1 }; }) as never,
    });
    expect(rebetCalls).toBe(1);
    expect(r.overBudget).toEqual(['m1']);
    expect(calls).toHaveLength(0); // no duplicate generic stall card for the same condition
  });
});
