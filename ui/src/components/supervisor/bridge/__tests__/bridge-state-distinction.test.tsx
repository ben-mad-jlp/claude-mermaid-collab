/**
 * Consolidated bridge state distinction tests.
 *
 * Three distinct production surfaces under test:
 * 1. MissionDetailPanel drops marker (mission-store.ts:236-247)
 * 2. ConductorActivityPanel live badge (isPassInflight predicate)
 * 3. UnlandedStrip loading vs confirmed-zero state distinction
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MissionDetailPanel } from '../inspector/MissionDetailPanel';
import { ConductorActivityPanel } from '../ConductorActivityPanel';
import { UnlandedStrip } from '../UnlandedStrip';

// Fixtures for test 1: convergedWithDrops visibility
const activeMission = {
  node: { id: 'mission-active', title: '[MISSION] Active Mission' },
  mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
  criteria: [{ id: 'c1', text: 'Criterion 1', met: false, order: 0 }],
  epics: [{ id: 'e1', title: '[EPIC] Epic 1', status: 'in_progress' }],
};

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

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('bridge state distinctions', () => {
  it('a converged-with-drops mission renders a drops marker', async () => {
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

  it('the live badge demotes when the pass is not inflight', async () => {
    // Started ~2 days ago: far past CONDUCTOR_NODE_TIMEOUT_MS (20 min), so
    // describeUnfinishedPass has already demoted it to 'killed (ran out of time)' in the
    // rendered sentence. The row's endedAt was never written (crashed before it could stamp),
    // but the badge should still not show because the pass is way over budget.
    const longDeadRow = {
      id: 'pass-orphaned',
      project: 'proj1',
      missionId: 'mission-x',
      startedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      endedAt: null,
      arm: 'serve',
      criteriaActed: [],
      filed: [],
      declined: [],
      outcome: null,
      ran: null,
    };

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rows: [longDeadRow], nicknames: {}, total: 1 }),
      }),
    ) as any;

    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    const entry = await screen.findByTestId('conductor-pass-entry');
    await waitFor(() => {
      expect(entry.textContent).toContain('killed (ran out of time)');
    });

    // The old unfinished pass must NOT show the live badge.
    expect(screen.queryByTestId('conductor-pass-live')).toBeNull();
  });

  it('UnlandedStrip distinguishes loading from confirmed-zero', () => {
    // Render the loading state (undefined prop)
    const notYetFetched = render(<UnlandedStrip unlandedEpics={undefined} />);
    expect(notYetFetched.getByTestId('unlanded-strip-loading')).toBeDefined();
    notYetFetched.unmount();

    // Render the confirmed-clear state (empty array)
    const confirmedZero = render(<UnlandedStrip unlandedEpics={[]} />);
    expect(confirmedZero.getByTestId('unlanded-strip-clear')).toBeDefined();
    confirmedZero.unmount();
  });
});
