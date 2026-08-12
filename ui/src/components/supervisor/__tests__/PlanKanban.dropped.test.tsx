/**
 * Regression spec (bugfix 052ca1b3): `dropped` is not a funnel state and must
 * never surface as a Backlog count. bucketTodo() returns null for dropped rows,
 * and the old `?? 'backlog'` coercion in the lane tally rendered 678 purged
 * fixture todos as "Backlog 679" on the No-epic lane.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PlanKanban } from '../PlanKanban';
import { computePlanTotals } from '../PlanTotals';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> = {}): SessionTodo {
  return {
    id: 'todo-' + Math.random().toString(36).slice(2),
    title: 'Task',
    kind: 'leaf',
    status: 'todo',
    order: 0,
    ownerSession: 'test-user',
    assigneeSession: null,
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    link: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    asanaGid: null,
    completed: false,
    ...p,
  } as SessionTodo;
}

describe('dropped todos never count as Backlog', () => {
  it('No-epic lane excludes dropped orphans from cards and chips', () => {
    const todos = [
      todo({ id: 'd1', status: 'dropped' }),
      todo({ id: 'd2', status: 'dropped' }),
      todo({ id: 'd3', status: 'dropped' }),
      todo({ id: 'live', status: 'backlog', title: 'real orphan' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const lane = screen.getByTestId('orphan-lane');
    expect(within(lane).getAllByTestId('plan-card')).toHaveLength(1);
    expect(within(lane).getByText('Backlog 1')).toBeTruthy();
    expect(within(lane).queryByText(/Backlog 4/)).toBeNull();
  });

  it('a No-epic lane of only dropped orphans does not render at all', () => {
    render(
      <PlanKanban
        todos={[todo({ status: 'dropped' }), todo({ status: 'dropped' })]}
        showCompleted={false}
      />,
    );
    expect(screen.queryByTestId('orphan-lane')).toBeNull();
  });

  it('epic lane chips skip dropped children (cards keep their faded render)', () => {
    const todos = [
      todo({ id: 'E', kind: 'epic', title: 'Epic' }),
      todo({ id: 'c1', parentId: 'E', status: 'backlog' }),
      todo({ id: 'c2', parentId: 'E', status: 'backlog' }),
      todo({ id: 'c3', parentId: 'E', status: 'dropped' }),
      todo({ id: 'c4', parentId: 'E', status: 'dropped' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const lane = screen.getByTestId('epic-lane-E');
    expect(within(lane).getByText('Backlog 2')).toBeTruthy();
    // dropped children still render as (faded) cards — only the counts exclude them
    expect(within(lane).getAllByTestId('plan-card')).toHaveLength(4);
  });

  it('computePlanTotals counts no dropped todo under any funnel key', () => {
    const { counts, total } = computePlanTotals([
      todo({ id: 'E', kind: 'epic', title: 'Epic' }),
      todo({ id: 'c1', parentId: 'E', status: 'backlog' }),
      todo({ id: 'c2', parentId: 'E', status: 'dropped' }),
      todo({ id: 'o1', status: 'backlog' }),
      todo({ id: 'o2', status: 'dropped' }),
    ]);
    expect(counts.backlog).toBe(2);
    expect(total).toBe(2);
  });
});
