import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanPanel from '../PlanPanel';
import { useSupervisorStore } from '@/stores/supervisorStore';
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
    approvedAt: '2026-06-16T00:00:00Z',
    heldAt: null,
    claim: null,
    kind: 'leaf',
    ...p,
  } as SessionTodo;
}

describe('PlanPanel list mode', () => {
  beforeEach(() => {
    useSupervisorStore.setState({
      todosByProject: {
        '/p': [
          todo({ id: 'M', title: 'Converge X', kind: 'mission' }),
          todo({ id: 'A', title: 'Regular task', kind: 'leaf' }),
        ],
      },
    });
  });

  it('excludes mission rows from the list view', () => {
    render(<PlanPanel serverId="local" project="/p" />);
    fireEvent.click(screen.getByText('List'));
    expect(screen.queryByText('Converge X')).toBeNull();
    expect(screen.getByText('Regular task')).toBeTruthy();
    // Footer count (PlanPanel.tsx:406, `{todos.length} items`) is derived from the
    // same excludeMissions(todosByProject[project]) call as the rendered rows
    // (PlanPanel.tsx:136) — 1 item, not 2, proves the mission never entered `todos`.
    expect(screen.getByText(/1 items/)).toBeTruthy();
  });

  it('excludes mission rows from the kanban view (default mode)', () => {
    render(<PlanPanel serverId="local" project="/p" />);
    // Default mode is 'kanban' (PlanPanel.tsx:138) — no click needed.
    expect(screen.queryByText('Converge X')).toBeNull();
    expect(screen.getByText('Regular task')).toBeTruthy();
    expect(screen.getAllByTestId('plan-card')).toHaveLength(1);
  });
});
