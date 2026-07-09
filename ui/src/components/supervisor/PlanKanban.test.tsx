/**
 * PlanKanban — epic swimlanes (G6) + bottleneck tags + click-to-navigate.
 *
 * The Show-completed toggle and the segmented progress chart now live in PlanPanel /
 * PlanTotals (PlanKanban takes `showCompleted` as a prop and renders only the lanes).
 * A catch-all BUCKET epic (Inbox) obeys Show-completed for its completed children and
 * gets a "Clear completed" housekeeping action; cohesive epics always show theirs.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { PlanKanban } from './PlanKanban';
import type { SessionTodo } from '@/types/sessionTodo';

function todo(p: Partial<SessionTodo> & { id: string }): SessionTodo {
  return {
    id: p.id,
    kind: 'leaf',
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

// A ← B ← C : A unblocks 2. All orphans.
const TODOS = [
  todo({ id: 'A', status: 'ready' }),
  todo({ id: 'B', status: 'planned', dependsOn: ['A'] }),
  todo({ id: 'C', status: 'planned', dependsOn: ['B'] }),
];

describe('PlanKanban', () => {
  it('renders a No-epic lane for orphan todos', () => {
    render(<PlanKanban todos={TODOS} showCompleted={false} />);
    const lane = screen.getByTestId('orphan-lane');
    expect(within(lane).getByText('No epic')).toBeInTheDocument();
  });

  it('renders an epic swimlane per epic with its child todos', () => {
    const withEpic = [
      todo({ id: 'E', title: 'Epic-E', kind: 'epic' }),
      todo({ id: 'E1', status: 'planned', parentId: 'E' }),
    ];
    render(<PlanKanban todos={withEpic} showCompleted={false} />);
    const lane = screen.getByTestId('epic-lane-E');
    expect(within(lane).getByText('Epic-E')).toBeInTheDocument();
    expect(within(lane).getByText('E1')).toBeInTheDocument();
  });

  it('hides completed epics by default and reveals them via the showCompleted prop', () => {
    const todos = [
      todo({ id: 'DONE', title: 'Done-Epic', kind: 'epic' }),
      todo({ id: 'D1', status: 'done', completed: true, parentId: 'DONE' }),
      todo({ id: 'D2', status: 'done', completed: true, parentId: 'DONE' }),
    ];
    const { rerender } = render(<PlanKanban todos={todos} showCompleted={false} />);
    expect(screen.queryByTestId('epic-lane-DONE')).toBeNull();
    rerender(<PlanKanban todos={todos} showCompleted />);
    expect(screen.getByTestId('epic-lane-DONE')).toBeInTheDocument();
  });

  it('always shows a cohesive ACTIVE epic\'s completed children (progress)', () => {
    const todos = [
      todo({ id: 'E', title: 'Feature-Epic', kind: 'epic' }),
      todo({ id: 'E1', status: 'done', completed: true, parentId: 'E' }),
      todo({ id: 'E2', status: 'ready', parentId: 'E' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const lane = screen.getByTestId('epic-lane-E');
    expect(within(lane).getByText('E1')).toBeInTheDocument(); // completed child still shown
    expect(within(lane).getByText('E2')).toBeInTheDocument();
  });

  it('a BUCKET (Inbox) epic hides completed children unless showCompleted', () => {
    const inbox = [
      todo({ id: 'INBOX', title: '[EPIC] Inbox', kind: 'epic' }),
      todo({ id: 'i1', status: 'done', completed: true, parentId: 'INBOX' }),
      todo({ id: 'i2', status: 'ready', parentId: 'INBOX' }),
    ];
    const { rerender } = render(<PlanKanban todos={inbox} showCompleted={false} />);
    const lane = screen.getByTestId('epic-lane-INBOX');
    expect(within(lane).getByText('i2')).toBeInTheDocument(); // open shown
    expect(within(lane).queryByText('i1')).toBeNull(); // completed hidden
    rerender(<PlanKanban todos={inbox} showCompleted />);
    expect(within(screen.getByTestId('epic-lane-INBOX')).getByText('i1')).toBeInTheDocument();
  });

  it('shows "Clear completed" on a bucket epic and fires onClearCompleted', () => {
    const inbox = [
      todo({ id: 'INBOX', title: '[EPIC] Inbox', kind: 'epic' }),
      todo({ id: 'i1', status: 'done', completed: true, parentId: 'INBOX' }),
      todo({ id: 'i2', status: 'ready', parentId: 'INBOX' }),
    ];
    const onClear = vi.fn();
    render(<PlanKanban todos={inbox} showCompleted={false} onClearCompleted={onClear} />);
    const btn = screen.getByTestId('clear-completed-bucket');
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledWith('INBOX');
  });

  it('does NOT show "Clear completed" on a cohesive epic', () => {
    const todos = [
      todo({ id: 'E', title: 'Feature-Epic', kind: 'epic' }),
      todo({ id: 'E1', status: 'done', completed: true, parentId: 'E' }),
      todo({ id: 'E2', status: 'ready', parentId: 'E' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} onClearCompleted={vi.fn()} />);
    expect(screen.queryByTestId('clear-completed-bucket')).toBeNull();
    expect(screen.queryByTestId('clear-completed-orphans')).toBeNull();
  });

  it('shows "Clear completed" on the orphan lane and fires onClearCompleted(null)', () => {
    const orphans = [
      todo({ id: 'O1', status: 'done', completed: true }),
      todo({ id: 'O2', status: 'ready' }),
    ];
    const onClear = vi.fn();
    render(<PlanKanban todos={orphans} showCompleted onClearCompleted={onClear} />);
    const btn = screen.getByTestId('clear-completed-orphans');
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledWith(null);
  });

  it('does NOT show any clear button on a cohesive (non-bucket) epic with done children', () => {
    const todos = [
      todo({ id: 'E', title: 'Cohesive Feature', kind: 'epic' }),
      todo({ id: 'E1', status: 'done', completed: true, parentId: 'E' }),
      todo({ id: 'E2', status: 'ready', parentId: 'E' }),
    ];
    render(<PlanKanban todos={todos} showCompleted onClearCompleted={vi.fn()} />);
    expect(screen.queryByTestId('clear-completed-bucket')).toBeNull();
    expect(screen.queryByTestId('clear-completed-orphans')).toBeNull();
  });

  it('tags a bottleneck with the transitive unblocks count', () => {
    render(<PlanKanban todos={TODOS} showCompleted={false} />);
    const tags = screen.getAllByTestId('bottleneck-tag').map((n) => n.textContent);
    expect(tags.some((t) => t?.includes('unblocks 2'))).toBe(true);
  });

  it('invokes onSelectTodo when a card is clicked', () => {
    const onSelect = vi.fn();
    render(<PlanKanban todos={TODOS} showCompleted={false} onSelectTodo={onSelect} />);
    const lane = screen.getByTestId('orphan-lane');
    fireEvent.click(within(lane).getByText('A'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('A');
  });

  it('wraps a long unbroken title within the card (break-words)', () => {
    const longPath = 'src/components/' + 'x'.repeat(110); // ~125 chars, no break point
    const todos = [
      todo({ id: 'E', title: 'Feature-Epic', kind: 'epic' }),
      todo({ id: 'L', title: longPath, parentId: 'E' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const titleEl = screen.getByText(longPath);
    expect(titleEl.className).toContain('break-words');
  });
});
