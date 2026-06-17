/**
 * WorkerRunStrip tests — UI-only; no live executor. Mocks fetch and the websocket client.
 * Covers: (a) ran:false → quiet placeholder, no chips; (b) ran:true 3-node → 3 chips +
 * header; (c) a running tail node → pulse state; (d) poll-gate: status not in_progress
 * (isActive=false) schedules no interval fetch; (e) inflight banner shows when daemon
 * returns a matching row; (f) inflight banner absent when daemon returns no matching row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkerRunStrip } from './WorkerRunStrip';

// The strip subscribes to ws nudges; stub a no-op client so no real socket opens.
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

function mockFetchRouter(routes: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(match[1]) });
  });
}

const RAN_FALSE = { ran: false, leafId: 't1' };

const RAN_THREE = {
  ran: true,
  leafId: 't1',
  attempts: 1,
  nodesSpent: 3,
  nodeBudget: 20,
  wallClockMs: 42000,
  finalOutcome: 'accepted',
  reviewVerdict: 'pass',
  nodes: [
    { nodeKind: 'blueprint', model: 'opus', authMode: 'sub', exitCode: 0, durationMs: 10000, rateLimited: false, ts: 1 },
    { nodeKind: 'implement', model: 'sonnet', authMode: 'sub', exitCode: 0, durationMs: 20000, rateLimited: false, ts: 2 },
    { nodeKind: 'review', model: 'opus', authMode: 'sub', exitCode: 0, durationMs: 12000, rateLimited: false, ts: 3, verdict: 'pass' },
  ],
};

const RAN_RUNNING = {
  ran: true,
  leafId: 't1',
  attempts: 1,
  nodesSpent: 2,
  nodeBudget: 20,
  wallClockMs: 15000,
  finalOutcome: null,
  reviewVerdict: null,
  nodes: [
    { nodeKind: 'blueprint', model: 'opus', authMode: 'sub', exitCode: 0, durationMs: 10000, rateLimited: false, ts: 1 },
    { nodeKind: 'implement', model: 'sonnet', authMode: 'sub', exitCode: null, durationMs: null, rateLimited: null, ts: 2 },
  ],
};

const DAEMON_IDLE = { inflight: [] };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('WorkerRunStrip', () => {
  it('ran:false → quiet placeholder, no chips', async () => {
    global.fetch = mockFetchRouter({ '/run/': RAN_FALSE, '/daemon': DAEMON_IDLE }) as any;
    render(<WorkerRunStrip leafId="t1" isActive={false} />);
    await waitFor(() => expect(screen.getByText('No headless run yet.')).toBeInTheDocument());
    expect(screen.queryAllByTestId('run-node-chip')).toHaveLength(0);
  });

  it('ran:true 3-node → 3 chips + header', async () => {
    global.fetch = mockFetchRouter({ '/run/': RAN_THREE, '/daemon': DAEMON_IDLE }) as any;
    render(<WorkerRunStrip leafId="t1" isActive={false} />);
    await waitFor(() => expect(screen.getAllByTestId('run-node-chip')).toHaveLength(3));
    expect(screen.getByText('attempt 1/2')).toBeInTheDocument();
    expect(screen.getByText('3/20 nodes')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getByText('pass')).toBeInTheDocument();
  });

  it('a running tail node carries the pulse state', async () => {
    global.fetch = mockFetchRouter({ '/run/': RAN_RUNNING, '/daemon': DAEMON_IDLE }) as any;
    render(<WorkerRunStrip leafId="t1" isActive={true} />);
    await waitFor(() => expect(screen.getAllByTestId('run-node-chip')).toHaveLength(2));
    const dots = screen.getAllByTestId('run-node-dot');
    // last node = running tail → pulse; first node (exit 0) → green, not pulsing.
    expect(dots[1].className).toContain('animate-pulse');
    expect(dots[1].className).toContain('bg-accent-500');
    expect(dots[0].className).toContain('bg-green-500');
  });

  it('poll-gate: isActive=false schedules no interval refetch', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetchRouter({ '/run/': RAN_THREE, '/daemon': DAEMON_IDLE });
    global.fetch = fetchMock as any;
    render(<WorkerRunStrip leafId="t1" isActive={false} />);
    // let the initial fetch settle
    await vi.runOnlyPendingTimersAsync();
    const callsAfterInitial = fetchMock.mock.calls.length;
    // advance well past the poll interval — no extra fetch since the run isn't live
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock.mock.calls.length).toBe(callsAfterInitial);
  });

  it('inflight banner renders with node label when daemon returns matching row', async () => {
    global.fetch = mockFetchRouter({
      '/run/': RAN_RUNNING,
      '/daemon': {
        inflight: [
          {
            leafId: 't1',
            nodeKind: 'implement',
            model: 'sonnet',
            attempt: 1,
            startedAt: Date.now() - 5000,
            elapsedMs: 5000,
            stale: false,
          },
        ],
      },
    }) as any;
    render(<WorkerRunStrip leafId="t1" isActive={true} />);
    await waitFor(() => expect(screen.getByTestId('run-inflight')).toBeInTheDocument());
    expect(screen.getByTestId('run-inflight').textContent).toContain('Implement');
  });

  it('inflight banner absent when daemon returns no matching row', async () => {
    global.fetch = mockFetchRouter({
      '/run/': RAN_RUNNING,
      '/daemon': { inflight: [] },
    }) as any;
    render(<WorkerRunStrip leafId="t1" isActive={true} />);
    await waitFor(() => expect(screen.getAllByTestId('run-node-chip')).toHaveLength(2));
    expect(screen.queryByTestId('run-inflight')).not.toBeInTheDocument();
  });
});
