/**
 * MissionDetailPanel — the daemon-controls block has MOVED OUT to the
 * ProjectSettingsModal (gear button in the CommandBar header). The mission pane
 * now holds the selected mission's detail + New mission + an "Other missions"
 * list at the bottom whose "Show completed" toggle reveals inactive/completed
 * OTHER missions. The SELECTED mission always renders — even when completed —
 * so a just-converged active mission never disappears behind the filter.
 *
 * serverId="" makes useMissions' fetchMissions short-circuit to [] (store guard),
 * so the panel renders the empty missions state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MissionDetailPanel } from './MissionDetailPanel';

const activeMission = {
  node: { id: 'mission-1', title: '[MISSION] Active Mission' },
  mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
  criteria: [{ id: 'c1', text: 'Criterion 1', met: false, order: 0 }],
  epics: [{ id: 'e1', title: '[EPIC] Epic 1', status: 'in_progress' }],
};

let mockMissions: any[] = [activeMission];

// Mock useMissions to provide test data
vi.mock('../rail/useMissions', () => ({
  useMissions: () => ({
    missions: mockMissions,
    setMissions: vi.fn(),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  mockMissions = [activeMission];
});

describe('MissionDetailPanel — mission list', () => {
  it('renders the missions header + New mission and the empty state', async () => {
    mockMissions = [];
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    expect(screen.getByTestId('mission-new-btn')).toBeTruthy();
    // With empty missions list, the empty prompt shows.
    expect(screen.getByText(/No missions yet/i)).toBeTruthy();
  });

  it('no longer renders the daemon-controls toggle or nodes matrix (moved to settings modal)', async () => {
    mockMissions = [];
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as any);
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    expect(screen.queryByTestId('mission-controls-toggle')).toBeNull();
    expect(screen.queryByTestId('daemon-nodes-matrix')).toBeNull();
    expect(screen.queryByTestId('daemon-provider-control')).toBeNull();
  });

  it('renders the selected mission detail with tabs + an Other missions list', async () => {
    mockMissions = [
      activeMission,
      {
        node: { id: 'mission-2', title: '[MISSION] Inactive Mission' },
        mission: { active: false, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
        criteria: [{ id: 'c2', text: 'Criterion 2', met: false, order: 0 }],
        epics: [{ id: 'e2', title: '[EPIC] Epic 2', status: 'planned' }],
      },
    ];

    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as any);
    render(<MissionDetailPanel serverId="test-server" project="/abs/p" session="design" />);

    await waitFor(() => expect(screen.getByTestId('mission-detail')).toBeTruthy());
    expect(screen.getByTestId('mission-detail-tabs')).toBeTruthy();
    expect(screen.getByTestId('mission-tab-goal')).toBeTruthy();
    expect(screen.getByTestId('mission-tab-build')).toBeTruthy();

    // The other (non-selected, non-completed) mission is browsable at the bottom.
    expect(screen.getByTestId('mission-other-section')).toBeTruthy();
    expect(screen.getByText('Inactive Mission')).toBeTruthy();
  });

  it('renders the SELECTED mission even when it is completed (converged)', async () => {
    // The only mission is active but converged → previously the filter hid it
    // behind an "All missions completed" placeholder. Now it must still show.
    mockMissions = [
      {
        node: { id: 'mission-1', title: '[MISSION] Converged Mission' },
        mission: { active: true, phase: 'converged', iteration: 3, maxIterations: null, description: '', procedure: '' },
        criteria: [{ id: 'c1', text: 'Criterion 1', met: true, order: 0 }],
        epics: [{ id: 'e1', title: '[EPIC] Epic 1', status: 'done' }],
      },
    ];
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as any);
    render(<MissionDetailPanel serverId="test-server" project="/abs/p" session="design" />);

    await waitFor(() => expect(screen.getByTestId('mission-detail')).toBeTruthy());
    // No "all completed" placeholder, and no toggle (there are no OTHER missions).
    expect(screen.queryByText(/mission.*completed/i)).toBeNull();
    expect(screen.queryByTestId('missions-show-completed')).toBeNull();
  });

  it('Show completed toggle at the bottom reveals inactive completed OTHER missions', async () => {
    mockMissions = [
      activeMission, // selected (active, not completed)
      {
        node: { id: 'mission-2', title: '[MISSION] Old Converged Mission' },
        mission: { active: false, phase: 'converged', iteration: 5, maxIterations: null, description: '', procedure: '' },
        criteria: [{ id: 'c2', text: 'Criterion 2', met: true, order: 0 }],
        epics: [{ id: 'e2', title: '[EPIC] Epic 2', status: 'done' }],
      },
    ];
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as any);
    render(<MissionDetailPanel serverId="test-server" project="/abs/p" session="design" />);

    await waitFor(() => expect(screen.getByTestId('mission-detail')).toBeTruthy());

    // The completed OTHER mission is hidden by default; the toggle is present.
    expect(screen.getByTestId('mission-other-section')).toBeTruthy();
    const toggle = screen.getByTestId('missions-show-completed');
    expect(toggle).toBeTruthy();
    expect(screen.queryByText('Old Converged Mission')).toBeNull();

    // Checking it reveals the completed inactive mission.
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('Old Converged Mission')).toBeTruthy());
  });
});
