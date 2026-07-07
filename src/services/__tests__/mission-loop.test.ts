import { test, expect } from 'bun:test';
import { planMissionLoopStep, runMissionLoopPass, type MissionLoopStepInput } from '../mission-loop';
import type { MissionLoopMode } from '../supervisor-store';
import type { MissionPhase } from '../mission-store';

const NOW = 1_000_000_000_000;

function inp(over: Partial<MissionLoopStepInput> = {}): MissionLoopStepInput {
  return {
    mission: { todoId: 'm1', phase: 'discover', iteration: 1, lastNudgeAt: null, procedure: null, title: '[MISSION] ship X' },
    rollup: { converged: false, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 2 } },
    ownerSession: 'design',
    mode: 'assist',
    idle: true,
    now: NOW,
    cooldownMs: 15 * 60 * 1000,
    ...over,
  };
}

// ---- pure planner ----

test('mode off → none', () => {
  expect(planMissionLoopStep(inp({ mode: 'off' })).kind).toBe('none');
});

test('terminal phases → none', () => {
  for (const phase of ['converged', 'stopped'] as MissionPhase[]) {
    expect(planMissionLoopStep(inp({ mission: { ...inp().mission, phase } })).kind).toBe('none');
  }
});

test('EXECUTE with all epics done → advance', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, phase: 'execute' }, rollup: { converged: false, mechanical: { done: 3, total: 3 }, capability: { met: 0, total: 2 } } }));
  expect(a.kind).toBe('advance');
});

test('EXECUTE still building → none', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, phase: 'execute' }, rollup: { converged: false, mechanical: { done: 1, total: 3 }, capability: { met: 0, total: 2 } } }));
  expect(a.kind).toBe('none');
  expect((a as { reason: string }).reason).toBe('execute-building');
});

test('EXECUTE with zero epics → nudge the steward (no build to wait on)', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, phase: 'execute' }, rollup: { converged: false, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 2 } } }));
  expect(a.kind).toBe('nudge');
});

test('DISCOVER + idle + no prior nudge → nudge', () => {
  const a = planMissionLoopStep(inp());
  expect(a.kind).toBe('nudge');
  if (a.kind === 'nudge') {
    expect(a.session).toBe('design');
    expect(a.message).toContain('DISCOVER');
  }
});

test('VERIFY nudge points at the independent /verify-mission gate', () => {
  const a = planMissionLoopStep(inp({ mission: { ...inp().mission, phase: 'verify' } }));
  expect(a.kind).toBe('nudge');
  if (a.kind === 'nudge') expect(a.message).toContain('/verify-mission');
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
    mission: { todoId: 'm1', phase: 'discover', iteration: 1, lastNudgeAt: null, procedure: null },
    rollup: { converged: false, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 2 } },
    criteria: [], epics: [], ...over,
  } as never;
}

test('runner: mode off → inert (no calls)', async () => {
  let nudged = 0;
  const r = await runMissionLoopPass('/p', { getMode: () => 'off' as MissionLoopMode, list: () => [summary()], nudge: async () => { nudged++; return 'sent'; } });
  expect(r.mode).toBe('off');
  expect(nudged).toBe(0);
});

test('runner: assist nudges an idle discover mission + stamps the debounce', async () => {
  const calls: string[] = []; let stamped = 0;
  const r = await runMissionLoopPass('/p', {
    getMode: () => 'assist', list: () => [summary()], isIdle: () => true,
    nudge: async (_p, _s, text) => { calls.push(text); return 'sent'; },
    stampNudge: () => { stamped++; }, advance: () => { throw new Error('should not advance'); }, now: NOW,
  });
  expect(r.nudged).toEqual(['m1']);
  expect(stamped).toBe(1);
  expect(calls[0]).toContain('DISCOVER');
});

test('runner: assist auto-advances an EXECUTE mission whose epics are all done', async () => {
  let advanced = 0;
  const r = await runMissionLoopPass('/p', {
    getMode: () => 'assist',
    list: () => [summary({ mission: { todoId: 'm1', phase: 'execute', iteration: 1, lastNudgeAt: null, procedure: null }, rollup: { converged: false, mechanical: { done: 2, total: 2 }, capability: { met: 0, total: 1 } } })],
    isIdle: () => true, advance: () => { advanced++; }, nudge: async () => 'sent',
  });
  expect(r.advanced).toEqual(['m1']);
  expect(advanced).toBe(1);
});
