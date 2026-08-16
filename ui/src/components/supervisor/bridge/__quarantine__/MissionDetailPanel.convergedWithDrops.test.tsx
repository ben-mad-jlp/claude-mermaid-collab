/**
 * QUARANTINE — red-by-design repro for an EXPLORE finding.
 *
 * mission-store.ts computes `rollup.convergedWithDrops` / `rollup.terminalReason` precisely so a
 * mission that met every ACTIVE criterion but had >=1 criterion DROPPED never reads as a clean
 * win (see mission-store.ts:236-247: "Exactly one of `converged` / `convergedWithDrops` can be
 * true... the honest terminal state a drop produces"). Live proof this is not hypothetical:
 * mission 44aeb79d-fdcf-48ec-a3d3-3693db847f1f ("land-path-integrity-landing-never") on THIS
 * project currently has capability.dropped=1, convergedWithDrops=true,
 * terminalReason='converged-with-drops' -- and rollup.status is the terminal-prefix 'closed'.
 *
 * But `MissionSummary.rollup` (ui/src/stores/supervisorStore.ts:346-356) never types
 * `convergedWithDrops` or `terminalReason` at all, and MissionDetailPanel.tsx:127 renders the
 * "Other missions" row from `m.rollup?.status` alone via <StatusPill>. STATUS_LABEL.closed is
 * pinned (missionShared.closedLabel.test.tsx) to always read "Converged with a check glyph" --
 * so a with-drops closed mission is byte-identical, on screen, to a clean full convergence. That
 * is exactly the case Oracle O3 prohibits: "a mission that converged WITH dropped criteria must
 * never render as a clean convergence."
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MissionDetailPanel } from '../inspector/MissionDetailPanel';

const activeMission = {
  node: { id: 'mission-active', title: '[MISSION] Active Mission' },
  mission: { active: true, phase: 'plan', iteration: 1, maxIterations: null, description: '', procedure: '' },
  criteria: [{ id: 'c1', text: 'Criterion 1', met: false, order: 0 }],
  epics: [{ id: 'e1', title: '[EPIC] Epic 1', status: 'in_progress' }],
};

// Real shape returned by GET /api/supervisor/missions for mission 44aeb79d on this project.
const convergedWithDropsMission = {
  node: { id: 'mission-drops', title: '[MISSION] land-path-integrity-landing-never' },
  mission: { active: false, closedAt: 1786000000000, phase: 'converged', iteration: 3 },
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

let mockMissions: any[] = [activeMission, convergedWithDropsMission];

vi.mock('../rail/useMissions', () => ({
  useMissions: () => ({
    missions: mockMissions,
    setMissions: () => {},
    hasLoadedOnce: true,
    status: 'loaded',
  }),
}));

afterEach(() => {
  mockMissions = [activeMission, convergedWithDropsMission];
});

describe('MissionDetailPanel -- convergedWithDrops honesty (quarantine, expected RED)', () => {
  it('the Other missions row for a converged-with-drops mission is visually distinct from a clean convergence', async () => {
    global.fetch = (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })) as any;
    render(<MissionDetailPanel serverId="" project="/abs/p" session="design" />);
    await waitFor(() => expect(screen.getByTestId('inspector-missions')).toBeTruthy());

    const row = await screen.findByText('land-path-integrity-landing-never');
    const rowContainer = row.closest('[data-testid="mission-switcher-row"]') as HTMLElement;
    expect(rowContainer).toBeTruthy();

    // O3: a with-drops convergence must never render identically to a clean one. Today the
    // badge is STATUS_LABEL.closed = 'Converged check-glyph' unconditionally (missionShared.tsx,
    // pinned by closedLabel.test.tsx), with no separate affordance for the drop -- so this is
    // expected to fail against current HEAD.
    expect(
      rowContainer.querySelector('[data-testid="mission-drops-indicator"]'),
    ).toBeTruthy();
  });
});
