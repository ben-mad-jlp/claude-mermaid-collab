/**
 * QUARANTINE — red-by-design repro for an EXPLORE finding.
 *
 * conductorActivity.ts's own `describeUnfinishedPass` (and the doc comment above it) exist
 * precisely because a journal row with `endedAt === null` covers THREE different states —
 * still running, orphaned, and genuinely timed out — and conflating them once already sent
 * someone chasing a mission that was actually fine. `formatConductorPass` calls it, so the
 * rendered SENTENCE for an old unfinished row correctly reads "killed (ran out of time)" once
 * its age passes CONDUCTOR_NODE_TIMEOUT_MS (1_200_000ms). ConductorLadder.tsx applies the same
 * age gate (RUNNING_FRESH_MS) before it will show anything as "running".
 *
 * ConductorActivityPanel.tsx does NOT apply that gate. Its "live" badge
 * (data-testid="conductor-pass-live", ConductorActivityPanel.tsx:237-241) is driven by the raw
 * `endedAt === null` check alone, with no age comparison at all. So a pass whose process died
 * without ever writing `endedAt` — a crashed node, a sidecar restart mid-pass, exactly the
 * scenario the doc comment describes — renders a green "live" badge FOREVER, while the very
 * same entry's own sentence, two lines below it, says "killed (ran out of time)". The panel
 * contradicts itself on screen. That is the O5 violation: "nothing must never look like
 * not-yet" — here a definitely-dead pass looks exactly like a genuinely live one, indefinitely,
 * side by side with the text saying otherwise.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConductorActivityPanel } from '../ConductorActivityPanel';

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConductorActivityPanel — dead pass still reads "live"', () => {
  it('never shows the live badge on a pass old enough for its own sentence to call it killed', async () => {
    // Started ~2 days ago: far past CONDUCTOR_NODE_TIMEOUT_MS (20 min), so
    // describeUnfinishedPass has already demoted it to 'killed (ran out of time)' in the
    // rendered sentence — but the row's endedAt was never written (the crash this
    // represents happened before the process could stamp it).
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

    // FINDING: the panel still renders the green "live" badge on this same entry, directly
    // contradicting the "killed" text it renders right below. A genuinely dead pass must not
    // look identical to a genuinely running one.
    expect(screen.queryByTestId('conductor-pass-live')).toBeNull();
  });
});
