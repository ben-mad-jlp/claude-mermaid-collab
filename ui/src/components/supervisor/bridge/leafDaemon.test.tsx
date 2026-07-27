import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useLeafDaemon, fmtDuration, fmtElapsedPadded } from './leafDaemon';

let wsMessageHandler: ((msg: any) => void) | null = null;

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({
    onMessage: (handler: (msg: any) => void) => {
      wsMessageHandler = handler;
      return { unsubscribe: () => {} };
    },
  }),
}));

let apiFetchResponse: unknown = null;
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(apiFetchResponse) })),
}));

afterEach(() => {
  vi.clearAllMocks();
  wsMessageHandler = null;
});

describe('leafDaemon', () => {
  it('calls apiFetch with the given serverScope, never bare fetch', async () => {
    globalThis.fetch = vi.fn();
    apiFetchResponse = { now: 1000, inflight: [] };

    const HostComponent = () => {
      useLeafDaemon('test-project', 'scope-1', { epicId: 'epic-1' });
      return <div data-testid="host">loaded</div>;
    };

    render(<HostComponent />);
    await waitFor(() => expect(screen.getByTestId('host')).toBeTruthy());

    const { apiFetch } = await import('@/lib/api');
    expect(apiFetch).toHaveBeenCalledWith('scope-1', expect.stringContaining('/api/leaf-executor/daemon'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns the inflight rows from the daemon payload', async () => {
    apiFetchResponse = {
      now: 1000,
      inflight: [
        { leafId: 'leaf-1', project: 'p1', epicId: 'e1', nodeKind: 'blueprint', model: 'opus', attempt: 1, startedAt: 500, elapsedMs: 500, stale: false },
        { leafId: 'leaf-2', project: 'p1', epicId: 'e2', nodeKind: 'review', model: 'sonnet', attempt: 2, startedAt: 600, elapsedMs: 400, stale: false },
      ],
    };

    let capturedDaemon: any = null;
    let capturedInflight: any = null;

    const HostComponent = () => {
      const { daemon, inflight } = useLeafDaemon('test-project', 'scope-1');
      capturedDaemon = daemon;
      capturedInflight = inflight;
      return <div data-testid="host">{inflight.length} rows</div>;
    };

    render(<HostComponent />);
    await waitFor(() => expect(screen.getByText('2 rows')).toBeTruthy());

    expect(capturedInflight).toHaveLength(2);
    expect(capturedInflight[0].leafId).toBe('leaf-1');
    expect(capturedInflight[1].leafId).toBe('leaf-2');
    expect(capturedDaemon?.now).toBe(1000);
  });

  it('refetches when a session_todos_updated ws message arrives', async () => {
    apiFetchResponse = { now: 1000, inflight: [] };

    let refetchFn: (() => void) | null = null;

    const HostComponent = () => {
      const { refetch } = useLeafDaemon('test-project', 'scope-1');
      refetchFn = refetch;
      return <div data-testid="host">ready</div>;
    };

    const { rerender } = render(<HostComponent />);
    await waitFor(() => expect(screen.getByTestId('host')).toBeTruthy());

    const { apiFetch } = await import('@/lib/api');
    const initialCallCount = vi.mocked(apiFetch).mock.calls.length;

    // Simulate ws message
    apiFetchResponse = { now: 2000, inflight: [{ leafId: 'leaf-1', nodeKind: 'implement', attempt: 1, startedAt: 1000, elapsedMs: 1000, stale: false }] };
    wsMessageHandler?.({ type: 'session_todos_updated' });

    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('fmtDuration and fmtElapsedPadded reproduce the pre-existing formats', () => {
    // fmtDuration: null/undefined → '', <1000 → ms, <60000 → s (toFixed(1)), else m+s
    expect(fmtDuration(null)).toBe('');
    expect(fmtDuration(undefined)).toBe('');
    expect(fmtDuration(500)).toBe('500ms');
    expect(fmtDuration(5000)).toBe('5.0s');
    expect(fmtDuration(125000)).toBe('2m5s');

    // fmtElapsedPadded: <1000 → ms, <60000 → s (toFixed(0)), else m+s (padStart)
    expect(fmtElapsedPadded(500)).toBe('500ms');
    expect(fmtElapsedPadded(5000)).toBe('5s');
    expect(fmtElapsedPadded(125000)).toBe('2m05s');
  });
});
