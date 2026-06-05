/**
 * G5: the TodoDetailView header must wrap (never overflow to the right) at the
 * narrow Plan detail-dock width — so the status/assignee selects and edit
 * controls are shrink-0 + width-capped + the header is flex-wrap.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodoDetailView } from './TodoDetailView';
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
    ...p,
  } as SessionTodo;
}

describe('TodoDetailView header layout', () => {
  beforeEach(() => {
    // currentSession null → the sibling-fetch effect short-circuits (no network).
    useSessionStore.setState({ sessionTodos: [todo({ id: 'T1', title: 'A todo' })], currentSession: null });
  });

  it('the header wraps so controls never overflow past the edge', () => {
    render(<TodoDetailView todoId="T1" />);
    expect(screen.getByTestId('todo-detail-header').className).toContain('flex-wrap');
  });

  it('the status select is shrink-0 and width-capped', () => {
    render(<TodoDetailView todoId="T1" />);
    const status = screen.getByLabelText('Status');
    expect(status.className).toContain('shrink-0');
    expect(status.className).toContain('max-w-');
  });
});
