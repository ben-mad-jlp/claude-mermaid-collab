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

  it('a legacy bucketType=inbox epic renders under the explore view and no inbox view exists', () => {
    const inbox = [
      todo({ id: 'INBOX', kind: 'epic', bucketType: 'inbox' }),
      todo({ id: 'i1', status: 'done', completed: true, parentId: 'INBOX' }),
      todo({ id: 'i2', status: 'ready', parentId: 'INBOX' }),
    ];
    render(<PlanKanban todos={inbox} showCompleted={false} />);
    expect(screen.getByTestId('work-requests-section')).toBeInTheDocument();
    expect(screen.getByTestId('work-request-view-explore')).toBeInTheDocument();
    expect(screen.queryByTestId('work-request-view-inbox')).toBeNull();
    expect(screen.queryByTestId('epic-lane-INBOX')).toBeNull();
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

  it('renders bucket epics in work-requests section with non-terminal children only', () => {
    const todos = [
      todo({ id: 'INBOX', kind: 'epic', bucketType: 'inbox' }),
      todo({ id: 'i1', status: 'ready', parentId: 'INBOX' }),
      todo({ id: 'i2', status: 'done', completed: true, parentId: 'INBOX' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const workRequestsSection = screen.getByTestId('work-requests-section');
    const exploreLane = screen.getByTestId('work-request-view-explore');
    expect(within(workRequestsSection).getByText('i1')).toBeInTheDocument();
    expect(within(exploreLane).queryByText('i2')).toBeNull(); // done item filtered out
  });

  it('renders explore, bugfix and feature views when all three bucket epics are present', () => {
    const todos = [
      todo({ id: 'EXPLORE', kind: 'epic', bucketType: 'explore' }),
      todo({ id: 'e1', status: 'ready', parentId: 'EXPLORE' }),
      todo({ id: 'BUGFIX', kind: 'epic', bucketType: 'bugfix' }),
      todo({ id: 'b1', status: 'ready', parentId: 'BUGFIX' }),
      todo({ id: 'FEATURE', kind: 'epic', bucketType: 'feature' }),
      todo({ id: 'f1', status: 'ready', parentId: 'FEATURE' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    expect(screen.getByTestId('work-request-view-explore')).toBeInTheDocument();
    expect(screen.getByTestId('work-request-view-bugfix')).toBeInTheDocument();
    expect(screen.getByTestId('work-request-view-feature')).toBeInTheDocument();
  });

  it('renders a friction-layer tag only for items carrying a frictionLayer', () => {
    const todos = [
      todo({ id: 'EXPLORE', kind: 'epic', bucketType: 'explore' }),
      todo({ id: 'e1', status: 'ready', parentId: 'EXPLORE', frictionLayer: 'domain' }),
      todo({ id: 'e2', status: 'ready', parentId: 'EXPLORE' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const chips = screen.getAllByTestId('friction-layer-tag');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('data-friction-layer', 'domain');
    expect(chips[0]).toHaveTextContent('domain');
  });

  it('frictionLayer filter narrows work-request view items', () => {
    const todos = [
      todo({ id: 'EXPLORE', kind: 'epic', bucketType: 'explore' }),
      todo({ id: 'e1', status: 'ready', parentId: 'EXPLORE', frictionLayer: 'domain' }),
      todo({ id: 'e2', status: 'ready', parentId: 'EXPLORE', frictionLayer: 'operational' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const exploreLane = screen.getByTestId('work-request-view-explore');
    expect(within(exploreLane).getByText('e1')).toBeInTheDocument();
    expect(within(exploreLane).getByText('e2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('friction-filter-domain'));
    expect(within(exploreLane).getByText('e1')).toBeInTheDocument();
    expect(within(exploreLane).queryByText('e2')).toBeNull();
  });

  it('renders promote-to-epic affordance disabled by default', () => {
    const todos = [
      todo({ id: 'INBOX', kind: 'epic', bucketType: 'inbox' }),
      todo({ id: 'i1', status: 'ready', parentId: 'INBOX' }),
    ];
    render(<PlanKanban todos={todos} showCompleted={false} />);
    const promoteBtn = screen.getByTestId('promote-to-epic');
    expect(promoteBtn).toBeDisabled();
  });

  it('calls onPromoteToEpic when promote-to-epic button is clicked', () => {
    const todos = [
      todo({ id: 'INBOX', kind: 'epic', bucketType: 'inbox' }),
      todo({ id: 'i1', status: 'ready', parentId: 'INBOX' }),
    ];
    const onPromote = vi.fn();
    render(<PlanKanban todos={todos} showCompleted={false} onPromoteToEpic={onPromote} />);
    const promoteBtn = screen.getByTestId('promote-to-epic');
    expect(promoteBtn).not.toBeDisabled();
    fireEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote.mock.calls[0][0].id).toBe('i1');
  });

  it('enables promote-to-epic with a handler and forwards the full clicked todo', () => {
    const todos = [
      todo({ id: 'INBOX', kind: 'epic', bucketType: 'inbox' }),
      todo({ id: 'i1', title: 'promote me', status: 'ready', parentId: 'INBOX' }),
    ];
    const onPromote = vi.fn();
    render(<PlanKanban todos={todos} showCompleted={false} onPromoteToEpic={onPromote} />);
    const promoteBtn = screen.getByTestId('promote-to-epic');
    expect(promoteBtn).not.toBeDisabled();
    fireEvent.click(promoteBtn);
    expect(onPromote).toHaveBeenCalledTimes(1);
    const arg = onPromote.mock.calls[0][0];
    expect(arg.id).toBe('i1');
    expect(arg.title).toBe('promote me');
  });

  it('renders criterion tag in swimlane header when criterionTagIndex is provided', () => {
    const todos = [
      todo({ id: 'A', title: 'Epic A', kind: 'epic', servesCriterionIds: ['critX'] }),
      todo({ id: 'A1', status: 'ready', parentId: 'A' }),
      todo({ id: 'B', title: 'Epic B', kind: 'epic', servesCriterionIds: [] }),
      todo({ id: 'B1', status: 'ready', parentId: 'B' }),
    ];
    const index = new Map([
      ['critX', { missionTitle: 'Mission M', criterionOrder: 1, criterionText: 'Criterion Text' }],
    ]);
    render(<PlanKanban todos={todos} showCompleted={false} criterionTagIndex={index} />);

    const laneA = screen.getByTestId('epic-lane-A');
    const laneB = screen.getByTestId('epic-lane-B');

    const tagInA = within(laneA).getByTestId('epic-criterion-tag');
    expect(tagInA).toBeInTheDocument();
    expect(tagInA.textContent).toContain('Mission M');
    expect(tagInA.textContent).toContain('C1');

    expect(within(laneB).queryByTestId('epic-criterion-tag')).toBeNull();
  });

  it('renders an open-graph control in the epic lane header and calls onOpenEpicGraph with the epic id', () => {
    const withEpic = [
      todo({ id: 'E', title: 'Epic-E', kind: 'epic' }),
      todo({ id: 'E1', status: 'planned', parentId: 'E' }),
    ];
    const onOpenEpicGraph = vi.fn();
    render(<PlanKanban todos={withEpic} showCompleted={false} onOpenEpicGraph={onOpenEpicGraph} />);
    const lane = screen.getByTestId('epic-lane-E');
    const button = within(lane).getByTestId('open-epic-graph');
    expect(button).toBeInTheDocument();
    expect(button.getAttribute('data-epic-id')).toBe('E');
    fireEvent.click(button);
    expect(onOpenEpicGraph).toHaveBeenCalledTimes(1);
    expect(onOpenEpicGraph).toHaveBeenCalledWith('E');
  });

  it('renders no open-graph control in the orphan lane', () => {
    const onOpenEpicGraph = vi.fn();
    render(<PlanKanban todos={TODOS} showCompleted={false} onOpenEpicGraph={onOpenEpicGraph} />);
    const lane = screen.getByTestId('orphan-lane');
    expect(within(lane).queryByTestId('open-epic-graph')).toBeNull();
  });
});
