/**
 * WorkPanel tests — merged In-flight/Ready tabs with sub-tab toggle.
 * Tests tab switching, both click-throughs, and the rail badge contract.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorkPanel } from './WorkPanel';
import { BridgeRail } from '../BridgeRail';
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

function todo(id: string, over: Record<string, unknown> = {}): SessionTodo {
  return {
    id, title: `Todo ${id}`, status: 'planned', parentId: 'epic-1',
    priority: null, order: 0, retryCount: 0,
    ...over,
  } as unknown as SessionTodo;
}

afterEach(() => vi.clearAllMocks());

describe('WorkPanel — In-flight|Ready tabs', () => {
  it('renders the default tab (in-flight)', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1')],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [todo('todo-1', { status: 'in_progress' })];
    render(<WorkPanel todos={todos} project="p" serverScope="s" />);
    await waitFor(() => expect(screen.getByTestId('work-panel')).toBeTruthy());
    expect(screen.getByTestId('work-tab-inflight')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('work-tab-ready')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText(/1 in flight/)).toBeTruthy();
    expect(screen.queryByText(/ready/)).toBeNull();
  });

  it('switches to ready tab and back to inflight', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1')],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [
      todo('todo-1', { status: 'in_progress' }),
      todo('todo-2', { status: 'planned', parentId: 'epic-1' }),
      todo('todo-3', { status: 'planned', parentId: 'epic-1' }),
    ];
    render(<WorkPanel todos={todos} project="p" serverScope="s" claimableIds={['todo-2', 'todo-3']} />);
    await waitFor(() => expect(screen.getByTestId('work-panel')).toBeTruthy());

    fireEvent.click(screen.getByTestId('work-tab-ready'));
    await waitFor(() => {
      expect(screen.getByTestId('work-tab-ready')).toHaveAttribute('data-active', 'true');
      expect(screen.getByTestId('work-tab-inflight')).toHaveAttribute('data-active', 'false');
      expect(screen.getByText(/2 ready/)).toBeTruthy();
    });
    expect(screen.queryByTestId('inflight-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('work-tab-inflight'));
    await waitFor(() => {
      expect(screen.getByTestId('work-tab-inflight')).toHaveAttribute('data-active', 'true');
      expect(screen.getByTestId('work-tab-ready')).toHaveAttribute('data-active', 'false');
    });
    expect(screen.getByText(/1 in flight/)).toBeTruthy();
  });

  it('fires onSelectTodo when clicking an inflight row', async () => {
    daemonResponse = {
      now, inflight: [leaf('todo-1', { nodeKind: 'implement' })],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [todo('todo-1', { title: 'Build the widget', status: 'in_progress' })];
    const onSelectTodo = vi.fn();
    render(<WorkPanel todos={todos} project="p" serverScope="s" onSelectTodo={onSelectTodo} />);
    await waitFor(() => expect(screen.getByTestId('work-panel')).toBeTruthy());

    fireEvent.click(screen.getByText('Build the widget'));
    expect(onSelectTodo).toHaveBeenCalledOnce();
    expect(onSelectTodo).toHaveBeenCalledWith(expect.objectContaining({ id: 'todo-1', title: 'Build the widget' }));
  });

  it('fires onSelectTodo when clicking a ready row', async () => {
    daemonResponse = {
      now, inflight: [],
      breaker: { open: false, openUntil: null }, paused: [],
    };
    const todos = [
      todo('todo-1', { status: 'planned', parentId: 'epic-1', title: 'Next task' }),
      todo('todo-2', { status: 'planned', parentId: 'epic-1' }),
    ];
    const onSelectTodo = vi.fn();
    render(
      <WorkPanel
        todos={todos}
        project="p"
        serverScope="s"
        claimableIds={['todo-1']}
        onSelectTodo={onSelectTodo}
      />
    );
    await waitFor(() => expect(screen.getByTestId('work-panel')).toBeTruthy());

    fireEvent.click(screen.getByTestId('work-tab-ready'));
    await waitFor(() => expect(screen.getByText(/1 ready/)).toBeTruthy());

    fireEvent.click(screen.getByText('Next task'));
    expect(onSelectTodo).toHaveBeenCalledOnce();
    expect(onSelectTodo).toHaveBeenCalledWith(expect.objectContaining({ id: 'todo-1', title: 'Next task' }));
  });

  it('renders the 6·40 badge in the rail', async () => {
    render(
      <BridgeRail
        counts={{ inflight: 6, ready: 40 }}
        panels={{ work: <div>content</div> }}
      />
    );
    const badge = screen.getByTestId('rail-badge-work');
    expect(badge).toHaveTextContent('6·40');
    expect(badge.textContent).toContain('·');
  });
});
