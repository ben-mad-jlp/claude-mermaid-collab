import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

const actions = {
  fetchMissions: vi.fn(async () => missions),
  createMission: vi.fn(async () => missions),
  activateMission: vi.fn(async () => missions),
  updateMission: vi.fn(async () => missions),
  deleteMission: vi.fn(async () => missions),
  addMissionCriterion: vi.fn(async () => missions),
  updateMissionCriterion: vi.fn(async () => missions),
  removeMissionCriterion: vi.fn(async () => missions),
};

let missions: any[] = [];

vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel?: (s: any) => any) => sel ? sel(actions) : actions,
}));

import { MissionSwitcher } from '../MissionSwitcher';

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

describe('MissionSwitcher', () => {
  it('renders rows with missions', () => {
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('mission-switcher-row')).toBeInTheDocument();
  });

  it('paused row has data-active="false"', () => {
    missions = [makeMission({ mission: { todoId: 'm1', phase: 'discover', iteration: 1, maxIterations: 5, active: false } })];
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    const row = screen.getByTestId('mission-switcher-row');
    expect(row).toHaveAttribute('data-active', 'false');
  });

  it('Activate button hidden when active', () => {
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    expect(screen.queryByTestId('mission-activate-btn')).not.toBeInTheDocument();
  });

  it('Activate button calls activateMission on inactive mission', async () => {
    missions = [makeMission({ mission: { todoId: 'm1', phase: 'discover', iteration: 1, maxIterations: 5, active: false } })];
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('mission-activate-btn'));
    await waitFor(() => expect(actions.activateMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('Activate on terminal mission shows ConfirmDialog', async () => {
    missions = [makeMission({
      mission: { todoId: 'm1', phase: 'converged', iteration: 1, maxIterations: 5, active: false },
      rollup: { phase: 'converged', iteration: 1, maxIterations: 5, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 0 }, converged: true, status: 'converged' as const },
    })];
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    // First, show completed missions to see the row
    fireEvent.click(screen.getByTestId('missions-show-completed'));
    // Now the Activate button should appear
    await waitFor(() => screen.getByTestId('mission-activate-btn'));
    fireEvent.click(screen.getByTestId('mission-activate-btn'));
    await waitFor(() => screen.getByText(/Re-activate a completed mission/));
    expect(screen.getByText(/Re-activate a completed mission/)).toBeInTheDocument();
  });

  it('+ New mission button opens MissionCreateDialog', async () => {
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('mission-new-btn'));
    await waitFor(() => screen.getByTestId('mission-create-title'));
    expect(screen.getByTestId('mission-create-title')).toBeInTheDocument();
  });

  it('mission-create-save disabled with invalid cap', async () => {
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('mission-new-btn'));
    const capInput = screen.getByTestId('mission-create-cap') as HTMLInputElement;
    fireEvent.change(capInput, { target: { value: 'abc' } });
    const saveBtn = screen.getByTestId('mission-create-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('Edit calls updateMission', async () => {
    const onChanged = vi.fn();
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByTestId('mission-edit-btn'));
    await waitFor(() => screen.getByTestId('mission-edit-title'));
    const goalInput = screen.getByTestId('mission-edit-title') as HTMLInputElement;
    fireEvent.change(goalInput, { target: { value: 'new goal' } });
    fireEvent.click(screen.getByTestId('mission-edit-save'));
    await waitFor(() => expect(actions.updateMission).toHaveBeenCalled());
  });

  it('Delete shows ConfirmDialog and calls deleteMission', async () => {
    const onChanged = vi.fn();
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByTestId('mission-delete-btn'));
    await waitFor(() => screen.getByText(/Delete mission/));
    fireEvent.click(screen.getByText('Delete permanently'));
    await waitFor(() => expect(actions.deleteMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('missions-show-completed absent when zero completed', () => {
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    expect(screen.queryByTestId('missions-show-completed')).not.toBeInTheDocument();
  });

  it('missions-show-completed present and filtering when one is completed', async () => {
    missions = [
      makeMission(),
      makeMission({
        node: { id: 'm2', title: '[MISSION] Completed', status: 'done' },
        mission: { todoId: 'm2', phase: 'converged', iteration: 1, maxIterations: 5, active: false },
        rollup: { phase: 'converged', iteration: 1, maxIterations: 5, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 0 }, converged: true, status: 'converged' as const },
      }),
    ];
    render(
      <MissionSwitcher
        serverId="local"
        project="/proj"
        missions={missions}
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('missions-show-completed')).toBeInTheDocument();
    // Initially shows only the active one
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    // After checking, shows both
    fireEvent.click(screen.getByTestId('missions-show-completed'));
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
