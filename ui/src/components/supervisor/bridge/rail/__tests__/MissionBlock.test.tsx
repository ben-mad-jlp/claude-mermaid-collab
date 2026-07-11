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
};

let missions: any[] = [];

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(actions) : actions),
}));

import { MissionBlock } from '../MissionBlock';

function makeMission(over: Partial<any> = {}) {
  return {
    node: { id: 'm1', title: '[MISSION] Clean up', status: 'todo' },
    ownerSession: 'design',
    assigneeSession: 'design',
    mission: { todoId: 'm1', phase: 'discover', iteration: 3, maxIterations: 8, procedure: 'do the thing', active: true, ...over.mission },
    rollup: { phase: 'discover', iteration: 3, maxIterations: 8, mechanical: { done: 1, total: 2 }, capability: { met: 2, total: 3 }, converged: false, status: 'needs-discovery' as const, ...over.rollup },
    criteria: [{ id: 'c1', text: 'first crit', met: true, order: 0 }],
    epics: [{ id: 'e1', title: '[EPIC] First', status: 'done' }],
    ...over,
  };
}

beforeEach(() => {
  Object.values(actions).forEach((f) => f.mockClear());
  missions = [makeMission()];
  actions.fetchMissions.mockResolvedValue(missions);
});

describe('MissionBlock', () => {
  it('renders status pill, iter, converged/stopped badges, owner, procedure', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-block'));

    expect(screen.getByTestId('mission-status-pill')).toBeInTheDocument();
    expect(screen.getByTestId('mission-status-pill')).toHaveTextContent('Needs discovery');
    expect(screen.getByTestId('mission-owner')).toHaveTextContent('session: design');
    expect(screen.getByText(/iter 3\/8/)).toBeInTheDocument();
    expect(screen.getByText(/do the thing/)).toBeInTheDocument();
  });

  it('renders converged badge when converged', async () => {
    missions = [makeMission({ rollup: { phase: 'discover', iteration: 3, maxIterations: 8, mechanical: { done: 1, total: 2 }, capability: { met: 2, total: 3 }, converged: true, status: 'converged' as const } })];
    actions.fetchMissions.mockResolvedValue(missions);

    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-converged'));
    expect(screen.getByTestId('mission-converged')).toHaveTextContent('converged ✓');
  });

  it('renders stopped badge when phase is stopped', async () => {
    missions = [makeMission({
      mission: { todoId: 'm1', phase: 'stopped', iteration: 3, maxIterations: 8, procedure: 'do the thing', active: true },
      rollup: { phase: 'stopped', iteration: 3, maxIterations: 8, mechanical: { done: 1, total: 2 }, capability: { met: 2, total: 3 }, converged: false, status: 'needs-discovery' as const },
    })];
    actions.fetchMissions.mockResolvedValue(missions);

    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-stopped'));
    expect(screen.getByTestId('mission-stopped')).toHaveTextContent('stopped');
  });

  it('Goal gauge shows met/total and expands to list criteria', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-goal-toggle'));

    expect(screen.getByTestId('mission-goal-toggle')).toHaveTextContent('2/3');
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    expect(screen.getByTestId('criterion-row')).toBeInTheDocument();
  });

  it('criterion-add-input and criterion-add-btn call addMissionCriterion', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    const input = screen.getByTestId('criterion-add-input');
    fireEvent.change(input, { target: { value: 'new crit' } });
    fireEvent.click(screen.getByTestId('criterion-add-btn'));
    await waitFor(() => expect(actions.addMissionCriterion).toHaveBeenCalledWith('local', '/proj', 'm1', 'new crit'));
  });

  it('criterion-edit-btn allows editing', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('criterion-edit-btn'));
    const input = screen.getByTestId('criterion-edit-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'updated text' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(actions.updateMissionCriterion).toHaveBeenCalledWith('local', '/proj', 'c1', 'updated text'));
  });

  it('criterion-remove-btn calls removeMissionCriterion', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('criterion-remove-btn'));
    await waitFor(() => expect(actions.removeMissionCriterion).toHaveBeenCalledWith('local', '/proj', 'c1'));
  });

  it('Build gauge shows epic rows', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-build-toggle'));
    fireEvent.click(screen.getByTestId('mission-build-toggle'));
    expect(screen.getByText(/First/)).toBeInTheDocument();
  });

  it('mission-status-pill is a span with no onclick', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-status-pill'));
    const pill = screen.getByTestId('mission-status-pill');
    expect(pill.tagName).toBe('SPAN');
    expect(pill.closest('button')).toBeNull();
  });

  it('criterion-provenance shows short verified sha for met criterion', async () => {
    missions = [makeMission({
      criteria: [{ id: 'c1', text: 'first crit', met: true, order: 0, verifiedAtSha: 'a1b2c3d4e5f6' }],
    })];
    actions.fetchMissions.mockResolvedValue(missions);

    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    const provenance = screen.getByTestId('criterion-provenance');
    expect(provenance).toHaveTextContent('@a1b2c3d');
  });

  it('criterion-marker is a span with no onclick', async () => {
    render(<MissionBlock serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    const marker = screen.getByTestId('criterion-marker');
    expect(marker.tagName).toBe('SPAN');
    expect(marker.closest('button')).toBeNull();
  });
});
