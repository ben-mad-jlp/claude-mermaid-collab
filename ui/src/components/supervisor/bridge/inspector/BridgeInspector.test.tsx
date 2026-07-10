/**
 * BridgeInspector tests — routing among epic/todo/empty states plus click-through integration.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BridgeInspector } from './BridgeInspector';
import { ReadyPanel } from '../ReadyPanel';
import React, { useState } from 'react';
import type { SessionTodo } from '@/types/sessionTodo';

vi.mock('@/lib/websocket', () => ({
  getWebSocketClient: () => ({ onMessage: () => ({ unsubscribe: () => {} }) }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));

vi.mock('../EpicHistoryView', () => ({
  EpicHistoryView: (p: any) => (
    <div data-testid="mock-epic-history">{p.epicId}</div>
  ),
}));

vi.mock('../LaneCallout', () => ({
  TodoWorkerPanel: (p: any) => (
    <div data-testid="mock-worker-panel">{p.todoId}</div>
  ),
}));

vi.mock('@/components/editors/TodoDetailView', () => ({
  TodoDetailView: (p: any) => (
    <div data-testid="mock-todo-detail">{p.todoId}</div>
  ),
  default: (p: any) => (
    <div data-testid="mock-todo-detail">{p.todoId}</div>
  ),
}));

afterEach(() => vi.clearAllMocks());

function todo(id: string, over: Record<string, unknown> = {}): SessionTodo {
  return {
    id,
    title: `Todo ${id}`,
    status: 'planned',
    parentId: 'epic-1',
    priority: null,
    order: 0,
    retryCount: 0,
    ...over,
  } as unknown as SessionTodo;
}

describe('BridgeInspector — epic/todo/empty states', () => {
  it('renders epic selection with EpicHistoryView', () => {
    render(
      <BridgeInspector
        selectedEpic={{ id: 'epic-123', label: 'My Epic' }}
        selectedTodoId={null}
        project="p"
        serverScope="s"
      />
    );
    expect(screen.getByTestId('inspector-epic')).toBeTruthy();
    expect(screen.getByTestId('mock-epic-history')).toHaveTextContent('epic-123');
    expect(screen.queryByTestId('inspector-todo')).toBeNull();
    expect(screen.queryByTestId('mock-todo-detail')).toBeNull();
  });

  it('renders todo selection with TodoWorkerPanel and TodoDetailView', () => {
    render(
      <BridgeInspector
        selectedEpic={null}
        selectedTodoId="todo-456"
        project="p"
        serverScope="s"
      />
    );
    expect(screen.getByTestId('inspector-todo')).toBeTruthy();
    expect(screen.getByTestId('mock-worker-panel')).toHaveTextContent('todo-456');
    expect(screen.getByTestId('mock-todo-detail')).toHaveTextContent('todo-456');
    expect(screen.queryByTestId('inspector-epic')).toBeNull();
  });

  it('renders nothing-selected message when no selection', () => {
    render(
      <BridgeInspector
        selectedEpic={null}
        selectedTodoId={null}
        project="p"
        serverScope="s"
      />
    );
    expect(screen.getByTestId('inspector-empty')).toBeTruthy();
    expect(screen.getByTestId('inspector-empty')).toHaveTextContent('Nothing selected.');
    expect(screen.queryByTestId('mock-epic-history')).toBeNull();
    expect(screen.queryByTestId('mock-worker-panel')).toBeNull();
  });

  it('epic selection wins when both epic and todo are set', () => {
    render(
      <BridgeInspector
        selectedEpic={{ id: 'epic-789', label: 'Override Epic' }}
        selectedTodoId="todo-456"
        project="p"
        serverScope="s"
      />
    );
    expect(screen.getByTestId('inspector-epic')).toBeTruthy();
    expect(screen.getByTestId('mock-epic-history')).toHaveTextContent('epic-789');
    expect(screen.queryByTestId('inspector-todo')).toBeNull();
  });

  it('integration: clicking a ready row populates the inspector', async () => {
    const todos = [
      todo('todo-1', { status: 'planned', title: 'First Ready Task' }),
      todo('todo-2', { status: 'planned', title: 'Second Ready Task' }),
    ];

    function Harness() {
      const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
      return (
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <ReadyPanel
              todos={todos}
              claimableIds={['todo-1', 'todo-2']}
              onSelectTodo={(t) => setSelectedTodoId(t.id)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <BridgeInspector
              selectedEpic={null}
              selectedTodoId={selectedTodoId}
              project="p"
              serverScope="s"
            />
          </div>
        </div>
      );
    }

    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('inspector-empty')).toBeTruthy());

    fireEvent.click(screen.getByText('First Ready Task'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-worker-panel')).toHaveTextContent('todo-1');
      expect(screen.getByTestId('mock-todo-detail')).toHaveTextContent('todo-1');
    });

    fireEvent.click(screen.getByText('Second Ready Task'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-worker-panel')).toHaveTextContent('todo-2');
      expect(screen.getByTestId('mock-todo-detail')).toHaveTextContent('todo-2');
    });
  });

  it('D3 regression: no escalation surface in the inspector', () => {
    render(
      <BridgeInspector
        selectedEpic={null}
        selectedTodoId="todo-456"
        project="p"
        serverScope="s"
      />
    );
    expect(screen.queryByTestId('inspector-escalation')).toBeNull();
    expect(screen.queryByTestId('decision-card')).toBeNull();
  });
});
