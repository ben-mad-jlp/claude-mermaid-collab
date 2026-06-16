/**
 * ExecutorStatsPanel tests — UI-only; no live executor. Mocks fetch + the websocket client.
 * Covers: (a) hero tiles render from mocked stats; (b) auth audit GREEN when healthy;
 * (c) auth audit LOUD RED when authModeAlarm true; (d) empty / no-runs state (leafCount 0).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExecutorStatsPanel } from './ExecutorStatsPanel';

// The panel subscribes to ws nudges; stub a no-op client so no real socket opens.
vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: () => ({ unsubscribe: () => {} }),
  }),
}));

function mockFetchOnce(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) });
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ExecutorStatsPanel', () => {
  it('renders hero tiles from mocked stats', async () => {
    global.fetch = mockFetchOnce(HEALTHY) as any;
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
    global.fetch = mockFetchOnce(HEALTHY) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByTestId('authmode-audit')).toBeTruthy());
    const band = screen.getByTestId('authmode-audit');
    expect(band.getAttribute('data-alarm')).toBe('false');
    expect(band.className).toContain('green-700');
    expect(band.className).not.toContain('red');
  });

  it('shows a LOUD RED auth alarm when authModeAlarm is true', async () => {
    global.fetch = mockFetchOnce(ALARM) as any;
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
    global.fetch = mockFetchOnce(EMPTY) as any;
    render(<ExecutorStatsPanel project="p" />);
    await waitFor(() => expect(screen.getByText('No headless runs yet.')).toBeTruthy());
    expect(screen.queryByTestId('stat-leafcount')).toBeNull();
    expect(screen.queryByTestId('authmode-audit')).toBeNull();
  });
});
