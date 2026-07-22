import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const actions = {
  fetchMissions: vi.fn(async () => missions),
  activateMission: vi.fn(async () => missions),
  updateMission: vi.fn(async () => missions),
  deleteMission: vi.fn(async () => missions),
  addMissionCriterion: vi.fn(async () => missions),
  updateMissionCriterion: vi.fn(async () => missions),
  removeMissionCriterion: vi.fn(async () => missions),
  approveMission: vi.fn(async () => missions),
  fetchConductorTarget: vi.fn(async () => null as string | null),
  setConductorTarget: vi.fn(async (_s: string, _p: string, id: string | null) => id),
};

let missions: any[] = [];

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(actions) : actions),
}));

import { MissionDetail, MissionCard } from '../missionShared';

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

describe('mission pin-conductor control', () => {
  it('MissionDetail renders the pin control', async () => {
    render(
      <MissionDetail m={missions[0]} serverId="local" project="/proj" activeTab="goal" onTabChange={() => {}} onChanged={() => {}} />
    );
    await waitFor(() => expect(actions.fetchConductorTarget).toHaveBeenCalledWith('local', '/proj'));
    expect(screen.getByTestId('mission-pin-conductor-btn')).toBeTruthy();
  });

  it('MissionDetail: clicking an unpinned mission calls setConductorTarget with its missionId', async () => {
    render(
      <MissionDetail m={missions[0]} serverId="local" project="/proj" activeTab="goal" onTabChange={() => {}} onChanged={() => {}} />
    );
    await waitFor(() => expect(screen.getByTestId('mission-pin-conductor-btn').textContent).toBe('Pin'));
    fireEvent.click(screen.getByTestId('mission-pin-conductor-btn'));
    // Pin is gated behind a confirmation modal now — confirm it.
    fireEvent.click(screen.getAllByText('Pin').at(-1)!);
    await waitFor(() => expect(actions.setConductorTarget).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('MissionDetail: clicking a pinned mission calls setConductorTarget with null', async () => {
    actions.fetchConductorTarget.mockImplementation(async () => 'm1');
    render(
      <MissionDetail m={missions[0]} serverId="local" project="/proj" activeTab="goal" onTabChange={() => {}} onChanged={() => {}} />
    );
    await waitFor(() => expect(screen.getByTestId('mission-pin-conductor-btn').textContent).toBe('Unpin'));
    fireEvent.click(screen.getByTestId('mission-pin-conductor-btn'));
    // Unpin is gated behind a confirmation modal now — confirm it.
    fireEvent.click(screen.getAllByText('Unpin').at(-1)!);
    await waitFor(() => expect(actions.setConductorTarget).toHaveBeenCalledWith('local', '/proj', null));
  });

  it('MissionCard: clicking an unpinned mission calls setConductorTarget with its missionId', async () => {
    render(<MissionCard m={missions[0]} serverId="local" project="/proj" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('mission-pin-conductor-btn').textContent).toBe('Pin'));
    fireEvent.click(screen.getByTestId('mission-pin-conductor-btn'));
    // Pin is gated behind a confirmation modal now — confirm it.
    fireEvent.click(screen.getAllByText('Pin').at(-1)!);
    await waitFor(() => expect(actions.setConductorTarget).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('MissionCard: clicking a pinned mission calls setConductorTarget with null', async () => {
    actions.fetchConductorTarget.mockImplementation(async () => 'm1');
    render(<MissionCard m={missions[0]} serverId="local" project="/proj" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('mission-pin-conductor-btn').textContent).toBe('Unpin'));
    fireEvent.click(screen.getByTestId('mission-pin-conductor-btn'));
    // Unpin is gated behind a confirmation modal now — confirm it.
    fireEvent.click(screen.getAllByText('Unpin').at(-1)!);
    await waitFor(() => expect(actions.setConductorTarget).toHaveBeenCalledWith('local', '/proj', null));
  });
});
