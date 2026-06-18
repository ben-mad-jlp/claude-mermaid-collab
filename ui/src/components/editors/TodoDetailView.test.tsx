/**
 * G5: the TodoDetailView header must wrap (never overflow to the right) at the
 * narrow Plan detail-dock width — so the status/assignee selects and edit
 * controls are shrink-0 + width-capped + the header is flex-wrap.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('shows the derived state as a single read-only badge (no raw lifecycle select)', () => {
    render(<TodoDetailView todoId="T1" />);
    // default todo: stored status 'ready' but approvedAt unset → derives 'planned'
    const status = screen.getByTestId('todo-detail-status');
    expect(status.textContent?.toLowerCase()).toContain('planned');
    // menu is closed until the badge is clicked
    expect(screen.queryByTestId('todo-detail-status-menu')).toBeNull();
    // the old raw lifecycle select is gone
    expect(screen.queryByLabelText('Lifecycle')).toBeNull();
  });

  it('the status menu offers approve + lifecycle writes, never raw ready/blocked/in_progress (epic b2c858d4)', () => {
    render(<TodoDetailView todoId="T1" />);
    fireEvent.click(screen.getByTestId('todo-detail-status'));
    const menu = screen.getByTestId('todo-detail-status-menu');
    expect(screen.getByTestId('todo-detail-approve')).toBeTruthy();
    const labels = Array.from(menu.querySelectorAll('[role="menuitem"]')).map(
      (b) => (b.textContent ?? '').toLowerCase(),
    );
    expect(labels.some((l) => l.includes('done'))).toBe(true);
    expect(labels.some((l) => l.includes('drop'))).toBe(true);
    // derived values are NEVER offered as raw set-able options
    expect(labels.some((l) => l === 'ready' || l === 'blocked' || l === 'in progress' || l === 'in_progress')).toBe(false);
  });

  it('exposes a Hold intent toggle separate from the status badge', () => {
    render(<TodoDetailView todoId="T1" />);
    expect(screen.getByTestId('todo-detail-hold')).toBeTruthy();
  });
});
