import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  fetchConductorTarget: vi.fn(async () => null as string | null),
  setConductorTarget: vi.fn(async (_s: string, _p: string, id: string | null) => id),
};

let missions: any[] = [];

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(actions) : actions),
}));

import { MissionCard } from '../missionShared';

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
  actions.fetchConductorTarget.mockImplementation(async () => null);
  missions = [makeMission()];
});

describe('MissionCard unapproved rendering', () => {
  it('renders Unapproved status pill and suppresses active indicators when status is unapproved', async () => {
    const m = makeMission({ mission: { active: true }, rollup: { status: 'unapproved' } });
    render(<MissionCard m={m} serverId="local" project="/proj" onChanged={() => {}} />);

    await waitFor(() => expect(actions.fetchConductorTarget).toHaveBeenCalled());

    expect(screen.getByTestId('mission-status-pill').textContent).toBe('Unapproved');
    expect(screen.queryByText('● active')).toBeNull();
    expect(screen.queryByText('paused')).toBeNull();
  });
});

describe('MissionCard approve action', () => {
  it('clicking approve button calls approveMission with correct arguments', async () => {
    const m = makeMission({ mission: { active: true }, rollup: { status: 'unapproved' } });
    render(<MissionCard m={m} serverId="local" project="/proj" onChanged={() => {}} />);

    await waitFor(() => expect(actions.fetchConductorTarget).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('mission-approve-btn'));

    await waitFor(() => expect(actions.approveMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });
});

describe('MissionCard authoring-only boundary', () => {
  it('does not render verdict-set or phase-advance buttons', async () => {
    const m = makeMission();
    render(<MissionCard m={m} serverId="local" project="/proj" onChanged={() => {}} />);

    await waitFor(() => expect(actions.fetchConductorTarget).toHaveBeenCalled());

    expect(screen.queryByTestId('mission-verdict-set-btn')).toBeNull();
    expect(screen.queryByTestId('mission-phase-advance-btn')).toBeNull();

    const buttons = screen.queryAllByRole('button');
    const hasVerdictOrAdvance = buttons.some(b => /verdict|advance phase/i.test(b.textContent ?? ''));
    expect(hasVerdictOrAdvance).toBe(false);
  });
});
