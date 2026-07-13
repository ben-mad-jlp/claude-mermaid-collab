/**
 * Acceptance spec for [kind E]: Kanban renders by declared `kind`, never by
 * has-children. Asserts that a split leaf (auto-splitter-given children)
 * renders as an expandable card, NOT as a lane. A brand-new epic with zero
 * children renders as an empty lane. The Inbox bucket rule survives the label
 * strip. And a source-text guard that no render file (PlanKanban/PlanPanel)
 * decides "epic" from structure (childrenByParent).
 *
 * Structural unit tests for buildTodoHierarchy live in
 * ui/src/lib/__tests__/todoHierarchy.test.ts.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PlanKanban } from '../PlanKanban';
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

// The 9acb7cb2 shape: a LEAF that the auto-splitter gave children.
const SPLIT_LEAF = [
  todo({ id: 'E', title: 'Feature-Epic', kind: 'epic' }),
  todo({ id: 'SPLIT', title: 'split leaf', kind: 'leaf', parentId: 'E' }),
  ...Array.from({ length: 9 }, (_, i) =>
    todo({ id: `s${i}`, title: `part ${i}`, kind: 'leaf', parentId: 'SPLIT' }),
  ),
];

describe('PlanKanban [kind E] acceptance spec', () => {
  it('split leaf is not a lane', () => {
    render(<PlanKanban todos={SPLIT_LEAF} showCompleted={false} />);
    expect(screen.queryByTestId('epic-lane-SPLIT')).toBeNull();
  });

  it('split leaf renders as a card inside its epic\'s lane', () => {
    render(<PlanKanban todos={SPLIT_LEAF} showCompleted={false} />);
    const lane = screen.getByTestId('epic-lane-E');
    expect(within(lane).getByText('split leaf')).toBeTruthy();
    const card = within(lane).getByTestId('plan-card');
    expect(card).toHaveAttribute('data-todo-id', 'SPLIT');
  });

  it('split leaf exposes its 9 children as collapsed sub-tasks', () => {
    render(<PlanKanban todos={SPLIT_LEAF} showCompleted={false} />);
    const toggle = screen.getByTestId('subtask-toggle');
    expect(toggle).toHaveAttribute('data-todo-id', 'SPLIT');
    expect(toggle.textContent).toMatch(/9 sub-tasks/);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('subtask-list')).toBeNull();

    fireEvent.click(toggle);
    const items = screen.getAllByTestId('subtask-item');
    expect(items).toHaveLength(9);
    expect(screen.getByText('part 0')).toBeTruthy();
  });

  it('split-leaf children are NOT lane items and NOT orphans', () => {
    render(<PlanKanban todos={SPLIT_LEAF} showCompleted={false} />);
    expect(screen.queryByTestId('orphan-lane')).toBeNull();
    const lane = screen.getByTestId('epic-lane-E');
    const cards = within(lane).getAllByTestId('plan-card');
    expect(cards).toHaveLength(1);
    expect(within(lane).getByText('1')).toBeTruthy();
  });

  it('a childless epic is hidden (board hygiene, crit 13)', () => {
    render(
      <PlanKanban
        todos={[todo({ id: 'NEW', title: 'Brand-new epic', kind: 'epic' })]}
        showCompleted={false}
      />,
    );
    expect(screen.queryByTestId('epic-lane-NEW')).toBeNull();
  });

  it('a dropped epic is hidden', () => {
    const epic = todo({ id: 'DROP', title: 'Dead epic', kind: 'epic', status: 'dropped' });
    const child = todo({ id: 'c1', title: 'child', kind: 'leaf', parentId: 'DROP' });
    render(<PlanKanban todos={[epic, child]} showCompleted={false} />);
    expect(screen.queryByTestId('epic-lane-DROP')).toBeNull();
  });

  it('an epic whose only children are dropped is hidden', () => {
    const epic = todo({ id: 'E2', title: 'Stale epic', kind: 'epic' });
    const d1 = todo({ id: 'd1', title: 'x', kind: 'leaf', parentId: 'E2', status: 'dropped' });
    render(<PlanKanban todos={[epic, d1]} showCompleted={false} />);
    expect(screen.queryByTestId('epic-lane-E2')).toBeNull();
  });

  it('mission nodes render in a dedicated Missions lane, not No-epic', () => {
    const mission = todo({ id: 'M', title: 'Converge X', kind: 'mission' });
    render(<PlanKanban todos={[mission]} showCompleted={false} />);
    const lane = screen.getByTestId('missions-lane');
    expect(within(lane).getByText('Converge X')).toBeTruthy();
    expect(within(lane).getByText('Missions')).toBeTruthy();
    expect(screen.queryByTestId('orphan-lane')).toBeNull();
  });

  it('bucket-epic matching survives the label strip', () => {
    const inboxEpic = todo({
      id: 'INBOX',
      title: '[EPIC] Inbox',
      kind: 'epic',
      isBucket: true,
    });
    const done = todo({
      id: 'd1',
      title: 'done item',
      kind: 'leaf',
      parentId: 'INBOX',
      status: 'done',
    });
    const ready = todo({
      id: 'r1',
      title: 'ready item',
      kind: 'leaf',
      parentId: 'INBOX',
      status: 'ready',
    });

    const { rerender } = render(
      <PlanKanban
        todos={[inboxEpic, done, ready]}
        showCompleted={false}
        onClearCompleted={() => {}}
      />,
    );
    const lane = screen.getByTestId('epic-lane-INBOX');
    expect(within(lane).queryByText('done item')).toBeNull();
    expect(within(lane).getByText('ready item')).toBeTruthy();
    expect(screen.getByTestId('clear-completed-bucket')).toBeTruthy();

    rerender(
      <PlanKanban
        todos={[inboxEpic, done, ready]}
        showCompleted={true}
        onClearCompleted={() => {}}
      />,
    );
    expect(within(lane).getByText('done item')).toBeTruthy();
    expect(within(lane).getByText('ready item')).toBeTruthy();
  });

  it('no UI render file decides "epic" from structure', () => {
    const planKanbanPath = resolve(__dirname, '../PlanKanban.tsx');
    const planPanelPath = resolve(__dirname, '../PlanPanel.tsx');

    const planKanbanSrc = readFileSync(planKanbanPath, 'utf8');
    const planPanelSrc = readFileSync(planPanelPath, 'utf8');

    // Assert that PlanKanban.tsx does NOT reference childrenByParent.
    // parentId may legitimately appear in the structure modules (todoHierarchy.ts),
    // which decide structure. Render components must not.
    expect(!/childrenByParent/.test(planKanbanSrc)).toBe(true);
    expect(!/childrenByParent/.test(planPanelSrc)).toBe(true);
  });
});
