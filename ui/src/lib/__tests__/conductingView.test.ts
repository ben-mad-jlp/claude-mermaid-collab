import { describe, it, expect } from 'vitest';
import { conductingView } from '../conductingView';
import type { MissionSummary } from '@/stores/supervisorStore';

function mission(over: Partial<any> = {}): MissionSummary {
  return {
    node: { id: 'm1', title: '[MISSION] ship the thing', status: 'todo' },
    ownerSession: 'bsync',
    assigneeSession: 'bsync',
    mission: { todoId: 'm1', phase: 'discover', iteration: 0, active: true, ...over.mission },
    rollup: {
      phase: over.mission?.phase ?? 'discover',
      iteration: 0,
      mechanical: { done: 0, total: 0 },
      capability: { met: 0, total: 3 },
      converged: false,
      ...over.rollup,
    },
    criteria: [],
    epics: [],
    ...over,
  } as MissionSummary;
}

describe('conductingView', () => {
  it('returns null for no mission / inactive / terminal', () => {
    expect(conductingView(null)).toBeNull();
    expect(conductingView(mission({ mission: { phase: 'discover', active: false } }))).toBeNull();
    expect(conductingView(mission({ mission: { phase: 'converged', active: true }, rollup: { phase: 'converged' } }))).toBeNull();
    expect(conductingView(mission({ mission: { phase: 'stopped', active: true }, rollup: { phase: 'stopped' } }))).toBeNull();
  });

  it('EXECUTE with epics still building → daemon’s turn', () => {
    const v = conductingView(mission({
      mission: { phase: 'execute', active: true },
      rollup: { phase: 'execute', mechanical: { done: 1, total: 3 }, capability: { met: 0, total: 3 } },
    }));
    expect(v?.turn).toBe('daemon');
    expect(v?.label).toBe('daemon building 1/3');
    expect(v?.goal).toBe('ship the thing');
  });

  it('EXECUTE with all epics done → conductor (wrapping up, not daemon)', () => {
    const v = conductingView(mission({
      mission: { phase: 'execute', active: true },
      rollup: { phase: 'execute', mechanical: { done: 3, total: 3 } },
    }));
    expect(v?.turn).toBe('conductor');
  });

  it('judgment phases → conductor’s move', () => {
    for (const phase of ['discover', 'plan', 'verify'] as const) {
      const v = conductingView(mission({ mission: { phase, active: true }, rollup: { phase } }));
      expect(v?.turn).toBe('conductor');
      expect(v?.label).toContain(phase);
    }
  });

  it('EXECUTE with no epics yet → conductor (needs an epic)', () => {
    const v = conductingView(mission({
      mission: { phase: 'execute', active: true },
      rollup: { phase: 'execute', mechanical: { done: 0, total: 0 } },
    }));
    expect(v?.turn).toBe('conductor');
    expect(v?.label).toContain('needs an epic');
  });
});
