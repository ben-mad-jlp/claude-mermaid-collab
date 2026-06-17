/**
 * G5: selecting a Plan todo opens the detail in a RESIZABLE SplitPane dock
 * (draggable divider) rather than a fixed-width aside.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Stub the heavy detail view — we only assert the dock wiring here.
vi.mock('@/components/editors/TodoDetailView', () => ({
  default: ({ todoId }: { todoId: string }) => <div data-testid="todo-detail-stub">{todoId}</div>,
}));

import PlanWorkspace from './PlanWorkspace';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    // De-conflated model (epic b2c858d4): readiness derives from approvedAt +
    // unblocked + no claim, not the legacy status enum. Approved by default.
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    ...p,
  } as SessionTodo;
}

describe('PlanWorkspace detail dock', () => {
  beforeEach(() => {
    useSupervisorStore.setState({ todosByProject: { '/p': [todo({ id: 'A', status: 'ready' })] } });
    useUIStore.setState({ activeProject: '/p' });
    useSessionStore.setState({ currentSession: null, sessionTodos: [] });
  });

  it('renders only the plan (no dock) until a todo is selected', () => {
    render(<PlanWorkspace />);
    expect(screen.queryByTestId('plan-detail-dock')).toBeNull();
    expect(screen.queryByTestId('split-pane')).toBeNull();
  });

  it('opens a resizable SplitPane dock with a drag handle when a todo is selected', () => {
    render(<PlanWorkspace />);
    const lane = screen.getByTestId('startable-lane');
    fireEvent.click(within(lane).getByText('A'));

    expect(screen.getByTestId('split-pane')).toBeInTheDocument();
    expect(screen.getByTestId('split-pane-handle')).toBeInTheDocument(); // draggable divider
    expect(screen.getByTestId('plan-detail-dock')).toBeInTheDocument();
    expect(screen.getByTestId('todo-detail-stub')).toHaveTextContent('A');
  });
});
