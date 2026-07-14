/**
 * MissionDetailPanel — the daemon-controls block has MOVED OUT to the
 * ProjectSettingsModal (gear button in the CommandBar header). The mission pane
 * now holds only the mission cards + New mission + show-completed toggle, so this
 * test covers just those surfaces.
 *
 * serverId="" makes useMissions' fetchMissions short-circuit to [] (store guard),
 * so the panel renders the empty missions state.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MissionDetailPanel } from './MissionDetailPanel';

let mockMissions = [
  {
    node: { id: 'mission-1', title: '[MISSION] Test Mission' },
    mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
    criteria: [{ id: 'c1', text: 'Test criterion', met: false, order: 0 }],
    epics: [{ id: 'e1', title: '[EPIC] Test Epic', status: 'in_progress' }],
  },
];

// Mock useMissions to provide test data
vi.mock('../rail/useMissions', () => ({
  useMissions: () => ({
    missions: mockMissions,
    setMissions: vi.fn(),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  // Reset mock missions for next test
  mockMissions = [
    {
      node: { id: 'mission-1', title: '[MISSION] Test Mission' },
      mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
      criteria: [{ id: 'c1', text: 'Test criterion', met: false, order: 0 }],
      epics: [{ id: 'e1', title: '[EPIC] Test Epic', status: 'in_progress' }],
    },
  ];
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

  it('renders mission detail with tabs and inactive carousel', async () => {
    // Mock multiple missions so carousel appears
    mockMissions = [
      {
        node: { id: 'mission-1', title: '[MISSION] Active Mission' },
        mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
        criteria: [{ id: 'c1', text: 'Criterion 1', met: false, order: 0 }],
        epics: [{ id: 'e1', title: '[EPIC] Epic 1', status: 'in_progress' }],
      },
      {
        node: { id: 'mission-2', title: '[MISSION] Inactive Mission' },
        mission: { active: false, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
        criteria: [{ id: 'c2', text: 'Criterion 2', met: false, order: 0 }],
        epics: [{ id: 'e2', title: '[EPIC] Epic 2', status: 'planned' }],
      },
    ];

    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as any);
    render(<MissionDetailPanel serverId="test-server" project="/abs/p" session="design" />);

    // The mocked useMissions returns missions, so detail should render
    await waitFor(() => expect(screen.getByTestId('mission-detail')).toBeTruthy());

    // Check detail view renders
    expect(screen.getByTestId('mission-detail')).toBeTruthy();
    expect(screen.getByTestId('mission-detail-tabs')).toBeTruthy();
    expect(screen.getByTestId('mission-tab-goals')).toBeTruthy();
    expect(screen.getByTestId('mission-tab-build')).toBeTruthy();

    // Check carousel is present
    expect(screen.getByTestId('mission-inactive-carousel')).toBeTruthy();
  });
});
