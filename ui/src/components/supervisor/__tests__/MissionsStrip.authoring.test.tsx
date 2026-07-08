import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';

/**
 * MissionsStrip AUTHORING surface — verifies the write controls are wired to the
 * store actions: activate (switch), edit (goal/procedure/cap), create, delete, and
 * the criteria editor (add/edit/remove). Loop-integrity ops (verdict, phase) are
 * deliberately NOT present and are not asserted here.
 */

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
  useSupervisorStore: (sel?: (s: any) => any) => (sel ? sel(actions) : actions),
}));

import { MissionsStrip } from '../MissionsStrip';

function makeMission(over: Partial<any> = {}) {
  return {
    node: { id: 'm1', title: '[MISSION] Clean up', status: 'todo' },
    ownerSession: 'design',
    assigneeSession: 'design',
    mission: { todoId: 'm1', phase: 'discover', iteration: 0, maxIterations: 8, procedure: 'do the thing', active: false, ...over.mission },
    rollup: { phase: 'discover', iteration: 0, maxIterations: 8, mechanical: { done: 0, total: 0 }, capability: { met: 0, total: 1 }, converged: false },
    criteria: [{ id: 'c1', text: 'first crit', met: false, order: 0 }],
    epics: [],
    ...over,
  };
}

beforeEach(() => {
  Object.values(actions).forEach((f) => f.mockClear());
  missions = [makeMission()];
  actions.fetchMissions.mockResolvedValue(missions);
});

describe('MissionsStrip authoring', () => {
  it('renders the New mission button (header authoring entry)', async () => {
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    expect(screen.getByTestId('mission-new-btn')).toBeTruthy();
  });

  it('Activate button calls activateMission for an inactive mission', async () => {
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    fireEvent.click(screen.getByTestId('mission-activate-btn'));
    await waitFor(() => expect(actions.activateMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('Edit dialog saves via updateMission', async () => {
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    fireEvent.click(screen.getByTestId('mission-edit-btn'));
    const proc = screen.getByTestId('mission-edit-procedure') as HTMLTextAreaElement;
    fireEvent.change(proc, { target: { value: 'new procedure' } });
    fireEvent.click(screen.getByTestId('mission-edit-save'));
    await waitFor(() => expect(actions.updateMission).toHaveBeenCalled());
    const patch = actions.updateMission.mock.calls[0][3];
    expect(patch.procedure).toBe('new procedure');
  });

  it('Delete asks for confirmation then calls deleteMission', async () => {
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    fireEvent.click(screen.getByTestId('mission-delete-btn'));
    // ConfirmDialog surfaces a "Delete permanently" button.
    fireEvent.click(screen.getByText('Delete permanently'));
    await waitFor(() => expect(actions.deleteMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('criteria editor adds a criterion via addMissionCriterion', async () => {
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle')); // expand
    const input = screen.getByTestId('criterion-add-input');
    fireEvent.change(input, { target: { value: 'brand new crit' } });
    fireEvent.click(screen.getByTestId('criterion-add-btn'));
    await waitFor(() => expect(actions.addMissionCriterion).toHaveBeenCalledWith('local', '/proj', 'm1', 'brand new crit'));
  });

  it('criteria editor edits text via updateMissionCriterion', async () => {
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    fireEvent.click(screen.getByTestId('mission-goal-toggle'));
    fireEvent.click(screen.getByTestId('criterion-edit-btn'));
    const input = screen.getByTestId('criterion-edit-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'reworded' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(actions.updateMissionCriterion).toHaveBeenCalledWith('local', '/proj', 'c1', 'reworded'));
  });

  it('active mission shows no Activate button, shows active marker', async () => {
    missions = [makeMission({ mission: { todoId: 'm1', phase: 'discover', iteration: 0, maxIterations: 8, active: true } })];
    actions.fetchMissions.mockResolvedValue(missions);
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    await waitFor(() => screen.getByTestId('mission-card'));
    expect(screen.queryByTestId('mission-activate-btn')).toBeNull();
    expect(screen.getByText('● active')).toBeTruthy();
  });

  it('activating a terminal mission asks to confirm first', async () => {
    missions = [makeMission({
      mission: { todoId: 'm1', phase: 'converged', iteration: 1, active: false },
      rollup: { phase: 'converged', iteration: 1, mechanical: { done: 0, total: 0 }, capability: { met: 1, total: 1 }, converged: true, stopped: true },
    })];
    actions.fetchMissions.mockResolvedValue(missions);
    render(<MissionsStrip serverId="local" project="/proj" session="design" />);
    // terminal missions are hidden until "show completed"
    fireEvent.click(await screen.findByTestId('missions-show-completed'));
    await waitFor(() => screen.getByTestId('mission-activate-btn'));
    fireEvent.click(screen.getByTestId('mission-activate-btn'));
    // must NOT activate immediately — a confirm appears
    expect(actions.activateMission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Activate anyway'));
    await waitFor(() => expect(actions.activateMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });
});
