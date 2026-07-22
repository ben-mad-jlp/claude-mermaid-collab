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
  fetchConductorTarget: vi.fn(() => Promise.resolve(null)),
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

describe('MissionDetail authoring actions', () => {
  it('Edit calls updateMission with patched fields', async () => {
    const m = missions[0];
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
    fireEvent.click(screen.getByTestId('mission-edit-btn'));
    await waitFor(() => screen.getByTestId('mission-edit-title'));
    const titleInput = screen.getByTestId('mission-edit-title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'new goal' } });
    fireEvent.click(screen.getByTestId('mission-edit-save'));
    await waitFor(() => expect(actions.updateMission).toHaveBeenCalledWith('local', '/proj', 'm1', expect.anything()));
  });

  it('Delete calls deleteMission only after confirm', async () => {
    const m = missions[0];
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
    fireEvent.click(screen.getByTestId('mission-delete-btn'));
    await waitFor(() => screen.getByText(/Delete mission/));
    fireEvent.click(screen.getByText('Delete permanently'));
    await waitFor(() => expect(actions.deleteMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('Delete button alone does not call deleteMission without confirm', async () => {
    const m = missions[0];
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
    fireEvent.click(screen.getByTestId('mission-delete-btn'));
    await waitFor(() => screen.getByText(/Delete mission/));
    expect(actions.deleteMission).not.toHaveBeenCalled();
  });
});

describe('MissionDetail approve action', () => {
  it('Approve button absent when status is not unapproved', () => {
    const m = makeMission();
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
    expect(screen.queryByTestId('mission-approve-btn')).toBeNull();
  });

  it('Approve button present when status is unapproved', () => {
    const m = makeMission({ rollup: { status: 'unapproved' } });
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
    expect(screen.getByTestId('mission-approve-btn')).toBeTruthy();
  });

  it('Approve click calls approveMission', async () => {
    const m = makeMission({ rollup: { status: 'unapproved' } });
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
    fireEvent.click(screen.getByTestId('mission-approve-btn'));
    await waitFor(() => expect(actions.approveMission).toHaveBeenCalledWith('local', '/proj', 'm1'));
  });

  it('Approve button disappears after re-render with updated status', async () => {
    const m = makeMission({ rollup: { status: 'unapproved' } });
    const updated = makeMission({ rollup: { status: 'needs-discovery' } });
    actions.approveMission.mockImplementationOnce(async () => [updated]);
    const { rerender } = render(
      <MissionDetail
        m={m}
        serverId="local"
        project="/proj"
        activeTab="goal"
        onTabChange={() => {}}
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('mission-approve-btn')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mission-approve-btn'));
    await waitFor(() => expect(actions.approveMission).toHaveBeenCalled());
    rerender(
      <MissionDetail
        m={updated}
        serverId="local"
        project="/proj"
        activeTab="goal"
        onTabChange={() => {}}
        onChanged={() => {}}
      />
    );
    expect(screen.queryByTestId('mission-approve-btn')).toBeNull();
  });
});
