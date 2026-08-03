import { describe, it, expect } from 'vitest';
import { selectActiveMissionProgress } from '../missionProgress';
import type { MissionSummary } from '@/stores/supervisorStore';

function makeMission(
  overrides?: Partial<MissionSummary>,
): MissionSummary {
  const defaults: MissionSummary = {
    node: { id: 'test-id', title: '[MISSION] Test', status: 'building' },
    ownerSession: null,
    assigneeSession: null,
    mission: {
      todoId: 'test-id',
      phase: 'execute',
      iteration: 1,
      active: false,
    },
    rollup: {
      phase: 'execute',
      iteration: 1,
      mechanical: { done: 0, total: 0 },
      capability: { met: 0, total: 0 },
      converged: false,
    },
    criteria: [],
    epics: [],
  };
  return { ...defaults, ...overrides };
}

describe('selectActiveMissionProgress', () => {
  it('returns null when no mission is active', () => {
    const missions = [
      makeMission({ mission: { ...makeMission().mission, active: false } }),
    ];
    expect(selectActiveMissionProgress(missions)).toBeNull();
  });

  it('returns capability met/total for the active mission', () => {
    const missions = [
      makeMission({
        mission: { ...makeMission().mission, active: true },
        rollup: {
          ...makeMission().rollup,
          capability: { met: 2, total: 8, dropped: 0 },
        },
      }),
    ];
    expect(selectActiveMissionProgress(missions)).toEqual({ met: 2, total: 8 });
  });

  it('returns null when the active mission has zero total criteria', () => {
    const missions = [
      makeMission({
        mission: { ...makeMission().mission, active: true },
        rollup: {
          ...makeMission().rollup,
          capability: { met: 0, total: 0 },
        },
      }),
    ];
    expect(selectActiveMissionProgress(missions)).toBeNull();
  });

  it('ignores a non-active mission with higher progress', () => {
    const missions = [
      makeMission({
        mission: { ...makeMission().mission, active: false },
        rollup: {
          ...makeMission().rollup,
          capability: { met: 5, total: 5, dropped: 0 },
        },
      }),
      makeMission({
        mission: { ...makeMission().mission, active: true },
        rollup: {
          ...makeMission().rollup,
          capability: { met: 1, total: 3 },
        },
      }),
    ];
    expect(selectActiveMissionProgress(missions)).toEqual({ met: 1, total: 3 });
  });
});
