/**
 * ConductorActivityPanel — live badge predicate test.
 *
 * Verifies that isPassInflight gates the "live" badge correctly: a pass must have
 * endedAt === null AND be under the CONDUCTOR_NODE_TIMEOUT_MS budget to render green.
 * The badge and the sentence (from describeUnfinishedPass) flip on the same boundary.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, findByTestId } from '@testing-library/react';
import { ConductorActivityPanel } from '../ConductorActivityPanel';

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConductorActivityPanel — live badge', () => {
  it('a two-day-old unfinished pass reads killed and renders no live badge', async () => {
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

  it('a pass started seconds ago still renders the live badge', async () => {
    // Started ~5 seconds ago: well under CONDUCTOR_NODE_TIMEOUT_MS (20 min).
    // endedAt is null, so it is still inflight and the badge should show.
    const freshRow = {
      id: 'pass-fresh',
      project: 'proj1',
      missionId: 'mission-y',
      startedAt: Date.now() - 5_000,
      endedAt: null,
      arm: 'conduct',
      criteriaActed: [],
      filed: [],
      declined: [],
      outcome: null,
      ran: null,
    };

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ rows: [freshRow], nicknames: {}, total: 1 }),
      }),
    ) as any;

    render(<ConductorActivityPanel project="proj1" onOpenEntity={() => {}} />);

    const entry = await screen.findByTestId('conductor-pass-entry');
    await waitFor(() => {
      expect(entry.textContent).toContain('in flight');
    });

    // The fresh inflight pass must show the live badge.
    await expect(screen.findByTestId('conductor-pass-live')).resolves.toBeInTheDocument();
  });
});
