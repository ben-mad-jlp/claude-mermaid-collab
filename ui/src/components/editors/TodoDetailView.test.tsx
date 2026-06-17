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

  it('the lifecycle select is shrink-0 and width-capped', () => {
    render(<TodoDetailView todoId="T1" />);
    const lifecycle = screen.getByLabelText('Lifecycle');
    expect(lifecycle.className).toContain('shrink-0');
    expect(lifecycle.className).toContain('max-w-');
  });

  it('exposes Approve/Hold intent toggles and a read-only derived state (epic b2c858d4)', () => {
    render(<TodoDetailView todoId="T1" />);
    expect(screen.getByTestId('todo-detail-approve')).toBeTruthy();
    expect(screen.getByTestId('todo-detail-hold')).toBeTruthy();
    // Derived label shown read-only; it must NOT offer ready/blocked/in_progress
    // as a raw lifecycle option.
    expect(screen.getByTestId('todo-detail-derived').textContent).toMatch(/^now:/);
    const lifecycle = screen.getByLabelText('Lifecycle') as HTMLSelectElement;
    const opts = Array.from(lifecycle.options).map((o) => o.value);
    expect(opts).toEqual(['planned', 'done', 'dropped']);
  });
});
