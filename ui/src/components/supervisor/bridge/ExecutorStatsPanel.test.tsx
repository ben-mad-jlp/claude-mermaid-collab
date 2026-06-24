/**
 * ExecutorStatsPanel tests — UI-only; no live executor. Mocks fetch + the websocket client.
 * Covers: (a) hero tiles render from mocked stats; (b) auth audit GREEN when healthy;
 * (c) auth audit LOUD RED when authModeAlarm true; (d) empty / no-runs state (leafCount 0);
 * (e) daemon section: breaker open band, running inflight leaf, rejected failure row,
 *     daemon section absent when daemon is idle.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExecutorStatsPanel } from './ExecutorStatsPanel';

// The panel subscribes to ws nudges; stub a no-op client so no real socket opens.
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

const HEALTHY = {
  leafCount: 5,
  nodesPerLeafAvg: 3.2,
  attemptRate: 1.4,
  blockRate: 0.2,
  capPauseCount: 1,
  capPauseMs: 5000,
  authModeAudit: { subscription: 16 },
  authModeAlarm: false,
  wallClock: { p50: 42000, p90: 70000, max: 182000 },
};

const ALARM = {
  ...HEALTHY,
  authModeAudit: { subscription: 14, api: 2 },
  authModeAlarm: true,
};

const EMPTY = {
  leafCount: 0,
  nodesPerLeafAvg: 0,
  attemptRate: 0,
  blockRate: 0,
  capPauseCount: 0,
  capPauseMs: 0,
  authModeAudit: {},
  authModeAlarm: false,
  wallClock: { p50: 0, p90: 0, max: 0 },
};

const DAEMON_IDLE = {
  now: Date.now(),
  inflight: [],
  breaker: { open: false, openUntil: 0 },
  paused: [],
  recentSpawns: [],
  failures: [],
};

const DAEMON_ACTIVE = {
  now: Date.now(),
  inflight: [
    {
      leafId: 'leaf-abc123',
      epicId: null,
      nodeKind: 'implement',
      model: 'claude-sonnet-4-6',
      attempt: 1,
      startedAt: Date.now() - 30000,
      elapsedMs: 30000,
      stale: false,
    },
  ],
  breaker: { open: true, openUntil: Date.now() + 120000 },
  paused: [{ todoId: 'todo-xyz', project: 'p', firstTrippedAt: Date.now() - 60000 }],
  recentSpawns: [
    { id: 's1', ts: Date.now(), project: 'p', session: 'sess-1', detail: '{"kind":"spawn"}' },
  ],
  failures: [{ leafId: 'leaf-fail1', finalOutcome: 'rejected', reason: 'review failed' }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ExecutorStatsPanel', () => {
  it('renders hero tiles from mocked stats', async () => {
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_IDLE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('stat-leafcount')).toBeTruthy());
    expect(screen.getByTestId('stat-leafcount').textContent).toBe('5');
    expect(screen.getByTestId('stat-nodesper').textContent).toBe('3.2');
    expect(screen.getByTestId('stat-attemptrate').textContent).toBe('1.40');
    expect(screen.getByTestId('stat-blockrate').textContent).toBe('20%');
    expect(screen.getByTestId('stat-cappause').textContent).toBe('1');
    expect(screen.getByTestId('wallclock-summary')).toBeTruthy();
  });

  it('shows a GREEN auth audit (no alarm) when healthy', async () => {
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_IDLE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('authmode-audit')).toBeTruthy());
    const band = screen.getByTestId('authmode-audit');
    expect(band.getAttribute('data-alarm')).toBe('false');
    expect(band.className).toContain('green-700');
    expect(band.className).not.toContain('red');
  });

  it('shows a LOUD RED auth alarm when authModeAlarm is true', async () => {
    global.fetch = mockFetchRouter({ '/stats': ALARM, '/daemon': DAEMON_IDLE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('authmode-audit')).toBeTruthy());
    const band = screen.getByTestId('authmode-audit');
    expect(band.getAttribute('data-alarm')).toBe('true');
    expect(band.className).toContain('bg-red-100');
    expect(band.className).toContain('text-red-700');
    expect(band.className).toContain('font-bold');
    expect(band.textContent).toContain('api');
    expect(band.textContent).toContain('2');
  });

  it('renders the empty state on leafCount 0 — no tiles, no audit band', async () => {
    global.fetch = mockFetchRouter({ '/stats': EMPTY, '/daemon': DAEMON_IDLE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByText('No headless runs yet.')).toBeTruthy());
    expect(screen.queryByTestId('stat-leafcount')).toBeNull();
    expect(screen.queryByTestId('authmode-audit')).toBeNull();
  });

  it('shows open breaker band when daemon breaker is open', async () => {
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_ACTIVE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('daemon-breaker')).toBeTruthy());
    const band = screen.getByTestId('daemon-breaker');
    expect(band.textContent).toContain('OPEN');
  });

  it('renders the concurrency pools section: global + per-project caps with a FULL badge', async () => {
    const DAEMON_POOLS = {
      ...DAEMON_IDLE,
      limits: { global: { max: 4, active: 3 }, project: { max: 2, active: 2 } },
    };
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_POOLS }) as any;
    render(<ExecutorStatsPanel project="/Users/me/Code/build123d-ocp-mcp" />);
    await waitFor(() => expect(screen.getByTestId('daemon-pools')).toBeTruthy());
    const pools = screen.getByTestId('daemon-pools');
    expect(pools.textContent).toContain('global');
    expect(pools.textContent).toContain('3/4'); // global active/max
    expect(pools.textContent).toContain('build123d-ocp-mcp'); // per-project label = basename
    expect(pools.textContent).toContain('2/2'); // per-project at ceiling
    expect(pools.textContent).toContain('FULL'); // ceiling badge
  });

  it('the global "+" stepper POSTs an increased globalMax to the caps endpoint', async () => {
    const DAEMON_POOLS = {
      ...DAEMON_IDLE,
      limits: { global: { max: 4, active: 1 }, project: { max: 2, active: 0 } },
    };
    const posts: any[] = [];
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/inflight-caps') && init?.method === 'POST') { posts.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); }
      if (url.includes('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTHY) });
      if (url.includes('/daemon')) return Promise.resolve({ ok: true, json: () => Promise.resolve(DAEMON_POOLS) });
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    }) as any;
    render(<ExecutorStatsPanel project="/Users/me/Code/proj" />);
    await waitFor(() => expect(screen.getByTestId('daemon-pools')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('increase global cap'));
    await waitFor(() => expect(posts.some((b) => b.globalMax === 5)).toBe(true));
  });

  it('shows running inflight leaf in daemon-inflight section', async () => {
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_ACTIVE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('daemon-inflight')).toBeTruthy());
    expect(screen.getByTestId('daemon-inflight').textContent).toContain('implement');
  });

  it('shows rejected failure in daemon-failures section', async () => {
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_ACTIVE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('daemon-failures')).toBeTruthy());
    const section = screen.getByTestId('daemon-failures');
    expect(section.textContent).toContain('rejected');
    expect(section.textContent).toContain('review failed');
  });

  it('daemon section absent when daemon is idle', async () => {
    global.fetch = mockFetchRouter({ '/stats': HEALTHY, '/daemon': DAEMON_IDLE }) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('stat-leafcount')).toBeTruthy());
    expect(screen.queryByTestId('daemon-inflight')).toBeNull();
  });
});
