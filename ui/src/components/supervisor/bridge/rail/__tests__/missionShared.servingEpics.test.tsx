import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const actions = {
  fetchMissions: vi.fn(async () => missions),
  createMission: vi.fn(async () => missions),
  activateMission: vi.fn(async () => missions),
  approveMission: vi.fn(async () => missions),
  abandonMission: vi.fn(async () => missions),
  updateMission: vi.fn(async () => missions),
  deleteMission: vi.fn(async () => missions),
  addMissionCriterion: vi.fn(async () => missions),
  updateMissionCriterion: vi.fn(async () => missions),
  removeMissionCriterion: vi.fn(async () => missions),
};

let missions: any[] = [];

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(actions) : actions),
}));

import { MissionDetail } from '../missionShared';

function makeMission(over: Partial<any> = {}) {
  return {
    node: { id: 'm1', title: '[MISSION] Test', status: 'todo' },
    ownerSession: 'session1',
    assigneeSession: 'session1',
    mission: { todoId: 'm1', phase: 'discover', iteration: 1, maxIterations: 5, active: true, ...over.mission },
    rollup: { phase: 'discover', iteration: 1, maxIterations: 5, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 0 }, converged: false, status: 'needs-discovery' as const, ...over.rollup },
    criteria: [],
    epics: [],
    ...over,
  };
}

beforeEach(() => {
  Object.values(actions).forEach((f) => f.mockClear());
  missions = [makeMission()];
});

describe('MissionDetail serving epics rendering', () => {
  it('Renders serving epics for a criterion that has them', () => {
    const m = makeMission({
      criteria: [
        {
          id: 'c1',
          text: 'First criterion',
          met: false,
          order: 0,
          servingEpics: [
            { id: 'e1', title: 'Epic One', landed: true },
            { id: 'e2', title: 'Epic Two', landed: false },
          ],
        },
      ],
    });
    missions[0] = m;

    render(
      <MissionDetail
        m={m}
        serverId="local"
        project="/proj"
        activeTab="goal"
        onTabChange={() => {}}
        onChanged={() => {}}
      />
    );

    expect(screen.getByText('Epic One')).toBeInTheDocument();
    expect(screen.getByText('Epic Two')).toBeInTheDocument();
  });

  it('Does not render a criterion-serving-epics element when servingEpics is absent or empty', () => {
    const m = makeMission({
      criteria: [
        {
          id: 'c1',
          text: 'First criterion',
          met: false,
          order: 0,
          servingEpics: [
            { id: 'e1', title: 'Epic One', landed: true },
          ],
        },
        {
          id: 'c2',
          text: 'Second criterion',
          met: false,
          order: 1,
          servingEpics: [],
        },
      ],
    });
    missions[0] = m;

    render(
      <MissionDetail
        m={m}
        serverId="local"
        project="/proj"
        activeTab="goal"
        onTabChange={() => {}}
        onChanged={() => {}}
      />
    );

    const servingEpicsElements = screen.queryAllByTestId('criterion-serving-epics');
    expect(servingEpicsElements).toHaveLength(1);
  });

  it('Shows landed status correctly for serving epics', () => {
    const m = makeMission({
      criteria: [
        {
          id: 'c1',
          text: 'Test criterion',
          met: false,
          order: 0,
          servingEpics: [
            { id: 'e1', title: 'Landed Epic', landed: true },
            { id: 'e2', title: 'Open Epic', landed: false },
          ],
        },
      ],
    });
    missions[0] = m;

    render(
      <MissionDetail
        m={m}
        serverId="local"
        project="/proj"
        activeTab="goal"
        onTabChange={() => {}}
        onChanged={() => {}}
      />
    );

    const landedSpan = screen.getByTitle('landed');
    const openSpan = screen.getByTitle('open');
    expect(landedSpan).toHaveTextContent('✓');
    expect(openSpan).toHaveTextContent('○');
  });
});
