/**
 * PlanKanban (Bridge P6) — wave columns + pinned Ready-Now lane + segmented
 * progress + bottleneck tags + click-to-navigate.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { PlanKanban } from './PlanKanban';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    ownerSession: '',
    assigneeSession: null,
    title: p.id,
    description: null,
    status: 'planned',
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

// A (startable) ← B ← C : A unblocks 2, and only A is Startable.
const TODOS = [
  todo({ id: 'A', status: 'ready' }),
  todo({ id: 'B', status: 'planned', dependsOn: ['A'] }),
  todo({ id: 'C', status: 'planned', dependsOn: ['B'] }),
];

describe('PlanKanban', () => {
  it('renders a column per wave (dependency depth)', () => {
    render(<PlanKanban todos={TODOS} />);
    expect(screen.getByTestId('wave-col-0')).toBeInTheDocument();
    expect(screen.getByTestId('wave-col-1')).toBeInTheDocument();
    expect(screen.getByTestId('wave-col-2')).toBeInTheDocument();
  });

  it('pins a Startable lane with only the startable, unclaimed todos', () => {
    render(<PlanKanban todos={TODOS} />);
    const lane = screen.getByTestId('startable-lane');
    expect(within(lane).getByText('A')).toBeInTheDocument();
    // B depends on A (not done) → not ready; C likewise.
    expect(within(lane).queryByText('B')).toBeNull();
    expect(within(lane).queryByText('C')).toBeNull();
  });

  it('excludes a claimed todo from Startable', () => {
    const claimed = [todo({ id: 'A', status: 'ready', claimedBy: 'worker-1' })];
    render(<PlanKanban todos={claimed} />);
    const lane = screen.getByTestId('startable-lane');
    expect(within(lane).queryByText('A')).toBeNull();
  });

  it('tags a bottleneck with the transitive unblocks count', () => {
    render(<PlanKanban todos={TODOS} />);
    // A unblocks B and C → "unblocks 2" appears at least once.
    const tags = screen.getAllByTestId('bottleneck-tag').map((n) => n.textContent);
    expect(tags.some((t) => t?.includes('unblocks 2'))).toBe(true);
  });

  it('builds a segmented progress header from the funnel buckets', () => {
    render(<PlanKanban todos={TODOS} />);
    // A → ready bucket; B, C → backlog bucket.
    expect(screen.getByTestId('progress-seg-ready')).toBeInTheDocument();
    expect(screen.getByTestId('progress-seg-backlog')).toBeInTheDocument();
  });

  it('invokes onSelectTodo when a card is clicked', () => {
    const onSelect = vi.fn();
    render(<PlanKanban todos={TODOS} onSelectTodo={onSelect} />);
    const lane = screen.getByTestId('startable-lane');
    fireEvent.click(within(lane).getByText('A'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('A');
  });
});
