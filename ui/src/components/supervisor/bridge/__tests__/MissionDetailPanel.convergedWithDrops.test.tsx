/**
 * Test for convergedWithDrops visibility in the "Other missions" list.
 *
 * mission-store.ts computes `rollup.convergedWithDrops` / `rollup.terminalReason` precisely so a
 * mission that met every ACTIVE criterion but had >=1 criterion DROPPED never reads as a clean
 * win (see mission-store.ts:236-247: "Exactly one of `converged` / `convergedWithDrops` can be
 * true... the honest terminal state a drop produces").
 *
 * MissionDetailPanel.tsx must render a MissionDropsIndicator alongside the StatusPill for such
 * missions, so a with-drops closed mission is visually distinct from a clean convergence.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MissionDetailPanel } from '../inspector/MissionDetailPanel';

const activeMission = {
  node: { id: 'mission-active', title: '[MISSION] Active Mission' },
  mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
  criteria: [{ id: 'c1', text: 'Criterion 1', met: false, order: 0 }],
  epics: [{ id: 'e1', title: '[EPIC] Epic 1', status: 'in_progress' }],
};

// Real shape returned by GET /api/supervisor/missions for mission 44aeb79d on this project.
// This mission is inactive, not completed (building status).
const convergedWithDropsMission = {
  node: { id: 'mission-drops', title: '[MISSION] land-path-integrity-landing-never' },
  mission: { active: false, phase: 'converged', iteration: 3 },
  rollup: {
    phase: 'converged',
    iteration: 3,
    mechanical: { done: 2, total: 2 },
    capability: { met: 3, total: 4, dropped: 1 },
    converged: false,
    convergedWithDrops: true,
    stopped: true,
    terminalReason: 'converged-with-drops',
    status: 'closed',
  },
  criteria: [
    { id: 'c1', text: 'Criterion 1', met: true, order: 0, status: 'active' },
    { id: 'c2', text: 'Criterion 2 (dropped)', met: false, order: 1, status: 'dropped' },
  ],
  epics: [],
};

// Clean convergence — no drops.
const cleanConvergedMission = {
  node: { id: 'mission-clean', title: '[MISSION] Clean Convergence' },
  mission: { active: false, phase: 'converged', iteration: 2 },
  rollup: {
    phase: 'converged',
    iteration: 2,
    mechanical: { done: 2, total: 2 },
    capability: { met: 3, total: 3 },
    converged: true,
    convergedWithDrops: undefined,
    stopped: true,
    status: 'closed',
  },
  criteria: [
    { id: 'c1', text: 'Criterion 1', met: true, order: 0, status: 'met' },
    { id: 'c2', text: 'Criterion 2', met: true, order: 1, status: 'met' },
  ],
  epics: [],
};

let mockMissions: any[] = [activeMission, convergedWithDropsMission, cleanConvergedMission];

vi.mock('../rail/useMissions', () => ({
  useMissions: () => ({
    missions: mockMissions,
    setMissions: () => {},
    hasLoadedOnce: true,
    status: 'loaded',
  }),
}));

afterEach(() => {
  mockMissions = [activeMission, convergedWithDropsMission, cleanConvergedMission];
});

describe('MissionDetailPanel -- convergedWithDrops honesty', () => {
  it('the Other missions row for a converged-with-drops mission is visually distinct from a clean convergence', async () => {
    const user = userEvent.setup();
    global.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    // Show completed missions so we can see both the with-drops and clean convergence missions.
    const showCompletedCheckbox = screen.getByTestId('missions-show-completed');
    await user.click(showCompletedCheckbox);

    // The with-drops mission should have a drops indicator.
    const dropsRow = await screen.findByText('land-path-integrity-landing-never');
    const dropsRowContainer = dropsRow.closest('[data-testid="mission-switcher-row"]') as HTMLElement;
    expect(dropsRowContainer).toBeTruthy();
    expect(
      dropsRowContainer.querySelector('[data-testid="mission-drops-indicator"]'),
    ).toBeTruthy();

    // The clean convergence mission should NOT have a drops indicator.
    const cleanRow = screen.getByText('Clean Convergence');
    const cleanRowContainer = cleanRow.closest('[data-testid="mission-switcher-row"]') as HTMLElement;
    expect(cleanRowContainer).toBeTruthy();
    expect(
      cleanRowContainer.querySelector('[data-testid="mission-drops-indicator"]'),
    ).toBeFalsy();
  });

  it('renders "1 criterion dropped" in the drops indicator title for a single drop', async () => {
    const user = userEvent.setup();
    mockMissions = [
      activeMission,
      {
        ...convergedWithDropsMission,
        rollup: {
          ...convergedWithDropsMission.rollup,
          capability: { met: 3, total: 4, dropped: 1 },
        },
      },
      cleanConvergedMission,
    ];
    global.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    const showCompletedCheckbox = screen.getByTestId('missions-show-completed');
    await user.click(showCompletedCheckbox);

    const dropsRow = await screen.findByText('land-path-integrity-landing-never');
    const dropsRowContainer = dropsRow.closest('[data-testid="mission-switcher-row"]') as HTMLElement;
    const indicator = dropsRowContainer.querySelector('[data-testid="mission-drops-indicator"]') as HTMLElement;
    const titleAttr = indicator.getAttribute('title');
    expect(titleAttr).toContain('1 criterion dropped');
    expect(titleAttr).not.toContain('criteria');
  });

  it('renders "2 criteria dropped" in the drops indicator title for two drops', async () => {
    const user = userEvent.setup();
    mockMissions = [
      activeMission,
      {
        ...convergedWithDropsMission,
        rollup: {
          ...convergedWithDropsMission.rollup,
          capability: { met: 2, total: 4, dropped: 2 },
        },
      },
      cleanConvergedMission,
    ];
    global.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    const showCompletedCheckbox = screen.getByTestId('missions-show-completed');
    await user.click(showCompletedCheckbox);

    const dropsRow = await screen.findByText('land-path-integrity-landing-never');
    const dropsRowContainer = dropsRow.closest('[data-testid="mission-switcher-row"]') as HTMLElement;
    const indicator = dropsRowContainer.querySelector('[data-testid="mission-drops-indicator"]') as HTMLElement;
    const titleAttr = indicator.getAttribute('title');
    expect(titleAttr).toContain('2 criteria dropped');
    expect(titleAttr).not.toContain('criteriona');
  });
});
