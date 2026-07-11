import { describe, it, expect } from 'vitest';
import { conductingView } from '../conductingView';
import type { MissionSummary, MissionStatus } from '@/stores/supervisorStore';

// conductingView is driven by the DERIVED mission `status` (phase/iteration were dropped in the
// mission-rewrite). phase/iteration are still provided here only to satisfy the payload types.
function mission(over: Partial<any> = {}): MissionSummary {
  return {
    node: { id: 'm1', title: '[MISSION] ship the thing', status: 'todo' },
    ownerSession: 'bsync',
    assigneeSession: 'bsync',
    mission: { todoId: 'm1', phase: 'discover', iteration: 0, active: true, ...over.mission },
    rollup: {
      phase: 'discover',
      iteration: 0,
      mechanical: { done: 0, total: 0 },
      capability: { met: 0, total: 3 },
      converged: false,
      status: 'needs-discovery' as MissionStatus,
      ...over.rollup,
    },
    criteria: [],
    epics: [],
    ...over,
  } as MissionSummary;
}

describe('conductingView', () => {
  it('returns null for no mission / inactive / terminal status', () => {
    expect(conductingView(null)).toBeNull();
    expect(conductingView(mission({ mission: { active: false } }))).toBeNull();
    expect(conductingView(mission({ rollup: { status: 'converged' } }))).toBeNull();
    expect(conductingView(mission({ rollup: { status: 'abandoned' } }))).toBeNull();
  });

  it('building → daemon’s turn (conductor waits)', () => {
    const v = conductingView(mission({
      rollup: { status: 'building', mechanical: { done: 1, total: 3 }, capability: { met: 0, total: 3 } },
    }));
    expect(v?.turn).toBe('daemon');
    expect(v?.label).toBe('daemon building 1/3');
    expect(v?.goal).toBe('ship the thing');
  });

  it('needs-verify → conductor’s move (verify)', () => {
    const v = conductingView(mission({ rollup: { status: 'needs-verify' } }));
    expect(v?.turn).toBe('conductor');
    expect(v?.label).toContain('verify');
  });

  it('needs-discovery → conductor’s move (discover)', () => {
    const v = conductingView(mission({ rollup: { status: 'needs-discovery', mechanical: { done: 0, total: 0 } } }));
    expect(v?.turn).toBe('conductor');
    expect(v?.label).toContain('discover');
  });

  it('blocked / over-budget → conductor’s move (a hold)', () => {
    expect(conductingView(mission({ rollup: { status: 'blocked' } }))?.turn).toBe('conductor');
    expect(conductingView(mission({ rollup: { status: 'blocked' } }))?.label).toContain('blocked');
    expect(conductingView(mission({ rollup: { status: 'over-budget' } }))?.label).toContain('over budget');
  });
});
