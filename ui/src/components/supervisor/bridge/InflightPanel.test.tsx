/**
 * InflightPanel tests — the regression for the "0 in flight while building" bug: the
 * panel must source its set from the daemon's leaf-inflight ledger, not the local todo
 * funnel (a headless leaf doesn't flip its todo's local status, so a busy project read 0).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InflightPanel } from './InflightPanel';
import type { SessionTodo } from '@/types/sessionTodo';

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({ onMessage: () => ({ unsubscribe: () => {} }) }),
}));

const now = Date.now();
let daemonResponse: unknown = null;
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(daemonResponse) })),
}));

function leaf(id: string, over: Record<string, unknown> = {}) {
  return {
    leafId: id, project: 'p', epicId: null, nodeKind: 'blueprint', model: 'opus',
    attempt: 1, startedAt: now - 5000, elapsedMs: 5000, stale: false, ...over,
  };
}

afterEach(() => vi.clearAllMocks());

describe('InflightPanel — daemon-authoritative set', () => {
  it('shows running leaves from the daemon even when local todos are EMPTY (headless 0-in-flight bug)', async () => {
    daemonResponse = {
      now, inflight: [leaf('296779c3'), leaf('419099fd')],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    render(<InflightPanel todos={[]} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeTruthy());
    expect(screen.getByText(/2 in flight/)).toBeTruthy();
    expect(screen.getAllByTestId('inflight-row')).toHaveLength(2);
  });

  it('shows "Nothing in flight" only when the daemon ledger AND local set are both empty', async () => {
    daemonResponse = { now, inflight: [], breaker: { open: false, openUntil: null }, paused: [] };
    render(<InflightPanel todos={[]} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByText(/Nothing in flight/)).toBeTruthy());
  });

  it('joins the daemon leaf to its local todo title when present', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1', { nodeKind: 'review' })],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [{ id: 'todo-1', title: 'Build the cutlist', status: 'in_progress', parentId: 'epicX' }] as unknown as SessionTodo[];
    render(<InflightPanel todos={todos} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeTruthy());
    expect(screen.getByText('Build the cutlist')).toBeTruthy();
    expect(screen.getByText(/1 in flight/)).toBeTruthy();
  });

  it('keeps the retained title when the todos snapshot stops containing the leaf', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1')],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [{ id: 'todo-1', title: 'Build the cutlist', status: 'in_progress', parentId: 'epicX' }] as unknown as SessionTodo[];
    const { rerender } = render(<InflightPanel todos={todos} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByText('Build the cutlist')).toBeTruthy());

    // Remove the todo from the snapshot, but the title should be retained in the cache.
    rerender(<InflightPanel todos={[]} project="p" serverScope="s" />);

    // The retained title should still be displayed.
    expect(screen.getByText('Build the cutlist')).toBeTruthy();
    // The fallback id should not appear.
    expect(screen.queryByText('todo-1')).toBeNull();
  });
});

describe('InflightPanel — base-gate wait visibility', () => {
  it('a between-nodes row whose epic has a base gate in flight says so (joined via todo.parentId)', async () => {
    daemonResponse = {
      now, inflight: [],
      baseGates: [{ key: 'k', project: 'p', baseSha: 'sha1', epicIds: ['epicX'], startedAt: now - 12 * 60000, running: true, sinceMs: 12 * 60000 }],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [
      { id: 'todo-1', title: 'Queued leaf', status: 'in_progress', parentId: 'epicX', kind: 'leaf' },
      { id: 'epicX', title: 'The epic', status: 'in_progress', kind: 'epic' },
    ] as unknown as SessionTodo[];
    render(<InflightPanel todos={todos} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeTruthy());
    expect(screen.getByText(/waiting on base gate · 12m/)).toBeTruthy();
  });

  it('a leaf with a server-computed baseGateWait renders the wait line from sinceMs', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1', { epicId: 'epicX', baseGateWait: { running: true, forEpicId: 'epicX', sinceMs: 3 * 60000 } })],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    render(<InflightPanel todos={[]} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeTruthy());
    expect(screen.getByText(/waiting on base gate · 3m/)).toBeTruthy();
  });

  it('a row without a base-gate wait renders exactly as before — no wait line', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1')],
      baseGates: [],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    render(<InflightPanel todos={[]} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByTestId('inflight-panel')).toBeTruthy());
    expect(screen.queryByText(/waiting on base gate/)).toBeNull();
  });
});
