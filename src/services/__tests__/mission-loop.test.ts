import { test, expect } from 'bun:test';
import { planMissionLoopStep, runMissionLoopPass, type MissionLoopStepInput } from '../mission-loop';
import type { MissionStatus } from '../mission-store';

const NOW = 1_000_000_000_000;

function inp(over: Partial<MissionLoopStepInput> = {}): MissionLoopStepInput {
  return {
    mission: { todoId: 'm1', status: 'needs-discovery', lastNudgeAt: null, title: '[MISSION] ship X', active: true },
    rollup: { capability: { met: 0, total: 2 } },
    ownerSession: 'design',
    idle: true,
    now: NOW,
    cooldownMs: 15 * 60 * 1000,
    ...over,
  };
}

// ---- pure planner ----

test('inactive mission → none', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, active: false } }));
  expect(a.kind).toBe('none');
  expect((a as { reason: string }).reason).toBe('inactive');
});

test('terminal statuses → none', () => {
  for (const status of ['converged', 'abandoned'] as MissionStatus[]) {
    const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status } }));
    expect(a.kind).toBe('none');
  }
});

test('building status → none', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'building' } }));
  expect(a.kind).toBe('none');
  expect((a as { reason: string }).reason).toBe('building');
});

test('over-budget status → none', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'over-budget' } }));
  expect(a.kind).toBe('none');
  expect((a as { reason: string }).reason).toBe('over-budget');
});

test('needs-discovery + idle + no prior nudge → nudge', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'needs-discovery' } }));
  expect(a.kind).toBe('nudge');
  if (a.kind === 'nudge') {
    expect(a.session).toBe('design');
    expect(a.message).toContain('NOT converged');
    expect(a.message).toContain('criteria met');
  }
});

test('needs-verify + idle + no prior nudge → nudge', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'needs-verify' } }));
  expect(a.kind).toBe('nudge');
  if (a.kind === 'nudge') {
    expect(a.message).toContain('needs VERIFY');
    expect(a.message).toContain('/verify-mission');
  }
});

test('blocked + idle + no prior nudge → nudge', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'blocked' } }));
  expect(a.kind).toBe('nudge');
  if (a.kind === 'nudge') {
    expect(a.message).toContain('is BLOCKED');
  }
});

test('blocked + already nudged → silence (blocked-silenced)', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'blocked', lastNudgeAt: NOW - 60_000 } }));
  expect(a.kind).toBe('none');
  expect((a as { reason: string }).reason).toBe('blocked-silenced');
});

test('needs-discovery nudge carries fire-time stamp + conductor discipline', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, status: 'needs-discovery' } }));
  expect(a.kind).toBe('nudge');
  if (a.kind === 'nudge') {
    expect(a.message).toMatch(/^\[\d{2}:\d{2}\s+\w+\]/);
    expect(a.message).toContain('CONDUCTOR');
    expect(a.message).toContain('do NOT hand-build');
  }
});

test('busy session → none (never interrupt active work)', () => {
  expect(planMissionLoopStep(inp({ idle: false })).kind).toBe('none');
});

test('within nudge cooldown → none (debounce)', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, lastNudgeAt: NOW - 60_000 } }));
  expect(a.kind).toBe('none');
  expect((a as { reason: string }).reason).toBe('nudge-cooldown');
});

test('past cooldown → nudge again', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, lastNudgeAt: NOW - 20 * 60 * 1000 } }));
  expect(a.kind).toBe('nudge');
});

test('no owner session → none', () => {
  expect(planMissionLoopStep(inp({ ownerSession: null })).kind).toBe('none');
});

// ---- runner ----

function summary(over: Record<string, unknown> = {}) {
  return {
    node: { id: 'm1', title: '[MISSION] ship X', status: 'planned' },
    ownerSession: 'design', assigneeSession: 'design',
    mission: { todoId: 'm1', status: 'needs-discovery', lastNudgeAt: null, active: true },
    rollup: { converged: false, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 2 } },
    criteria: [], epics: [], ...over,
  } as never;
}

test('runner: inactive mission → inert (no calls)', async () => {
  let nudged = 0;
  const r = await runMissionLoopPass('/p', {
    list: () => [summary({ mission: { todoId: 'm1', status: 'needs-discovery', lastNudgeAt: null, active: false } })],
    isIdle: () => true, nudge: async () => { nudged++; return 'sent'; },
  });
  expect(r.nudged).toEqual([]);
  expect(nudged).toBe(0);
});

test('runner: nudges an idle needs-discovery mission + stamps the debounce', async () => {
  const calls: string[] = []; let stamped = 0;
  const r = await runMissionLoopPass('/p', {
    list: () => [summary()], isIdle: () => true,
    nudge: async (_p, _s, text) => { calls.push(text); return 'sent'; },
    stampNudge: () => { stamped++; }, now: NOW,
  });
  expect(r.nudged).toEqual(['m1']);
  expect(stamped).toBe(1);
  expect(calls[0]).toContain('NOT converged');
});

test('runner: skips a building mission', async () => {
  const r = await runMissionLoopPass('/p', {
    list: () => [summary({ mission: { todoId: 'm1', status: 'building', lastNudgeAt: null, active: true } })],
    isIdle: () => true, nudge: async () => 'sent',
  });
  expect(r.nudged).toEqual([]);
  expect(r.skipped).toBe(1);
});
