import { describe, it, expect } from 'vitest';
import { selectGraphTodos } from '../BridgeDashboard';
import type { SessionTodo } from '@/types/sessionTodo';

function mk(overrides: Partial<SessionTodo> = {}): SessionTodo {
  return {
    id: overrides.id ?? 'todo-' + Math.random().toString(36).slice(2, 9),
    title: overrides.title ?? 'Untitled',
    status: overrides.status ?? 'planned',
    kind: overrides.kind ?? 'leaf',
    parentId: overrides.parentId ?? undefined,
    createdAt: overrides.createdAt ?? Date.now(),
    targetProject: overrides.targetProject ?? 'test',
    ...overrides,
  };
}

function resultIds(todos: SessionTodo[]): string[] {
  return todos.map((t) => t.id);
}

describe('selectGraphTodos', () => {
  it('splits leaf — L(kind:leaf, 9 children all done) under epic E; L survives with children', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', title: 'Epic E' });
    const leafL = mk({ id: 'leaf-l', kind: 'leaf', parentId: 'epic-e', title: 'Split Leaf L' });
    const children = Array.from({ length: 9 }, (_, i) =>
      mk({ id: `child-${i}`, kind: 'leaf', parentId: 'leaf-l', status: 'done', title: `Child ${i}` })
    );

    const todos = [epicE, leafL, ...children];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    expect(ids).toContain('epic-e');
    expect(ids).toContain('leaf-l');
    children.forEach((c) => {
      expect(ids).toContain(c.id);
    });
  });

  it('childless epic planned — E2(kind:epic, no children, status:planned) survives', () => {
    const epicE2 = mk({ id: 'epic-e2', kind: 'epic', status: 'planned', title: 'Childless Epic E2' });
    const todos = [epicE2];
    const result = selectGraphTodos(todos);

    expect(resultIds(result)).toContain('epic-e2');
  });

  it('childless epic done — E3(kind:epic, no children, status:done) survives (not orphan)', () => {
    const epicE3 = mk({ id: 'epic-e3', kind: 'epic', status: 'done', title: 'Childless Done Epic E3' });
    const todos = [epicE3];
    const result = selectGraphTodos(todos);

    expect(resultIds(result)).toContain('epic-e3');
  });

  it('done epic rollup — E(kind:epic) with 2 leaf children both done; all three filtered', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', title: 'Epic E' });
    const child1 = mk({ id: 'child-1', kind: 'leaf', parentId: 'epic-e', status: 'done' });
    const child2 = mk({ id: 'child-2', kind: 'leaf', parentId: 'epic-e', status: 'done' });

    const todos = [epicE, child1, child2];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    expect(ids).not.toContain('epic-e');
    expect(ids).not.toContain('child-1');
    expect(ids).not.toContain('child-2');
  });

  it('completed orphan — top-level kind:leaf, status:done, no children → filtered', () => {
    const orphan = mk({ id: 'orphan-todo', kind: 'leaf', status: 'done', title: 'Finished Orphan' });
    const todos = [orphan];
    const result = selectGraphTodos(todos);

    expect(resultIds(result)).not.toContain('orphan-todo');
  });

  it('completed leaf with parentId — survives if parent not a done epic', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', title: 'Epic E' });
    const doneChild = mk({ id: 'done-child', kind: 'leaf', parentId: 'epic-e', status: 'done' });
    const activeChild = mk({ id: 'active-child', kind: 'leaf', parentId: 'epic-e', status: 'in_progress' });

    const todos = [epicE, doneChild, activeChild];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    expect(ids).toContain('epic-e');
    expect(ids).toContain('done-child');
    expect(ids).toContain('active-child');
  });

  it('active epic keeps done children — epic with 1 done + 1 in_progress; all three survive', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', status: 'planned', title: 'Active Epic' });
    const doneChild = mk({ id: 'done-child', kind: 'leaf', parentId: 'epic-e', status: 'done' });
    const inProgChild = mk({ id: 'prog-child', kind: 'leaf', parentId: 'epic-e', status: 'in_progress' });

    const todos = [epicE, doneChild, inProgChild];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    expect(ids).toContain('epic-e');
    expect(ids).toContain('done-child');
    expect(ids).toContain('prog-child');
  });

  it('dropped child of done epic — filtered like done', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', title: 'Epic E' });
    const droppedChild = mk({ id: 'dropped-child', kind: 'leaf', parentId: 'epic-e', status: 'dropped' });

    const todos = [epicE, droppedChild];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    expect(ids).not.toContain('epic-e');
    expect(ids).not.toContain('dropped-child');
  });

  it('mixed statuses on epic children — only done/dropped children filtered when ALL are done/dropped', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', title: 'Epic E' });
    const doneChild = mk({ id: 'child-1', kind: 'leaf', parentId: 'epic-e', status: 'done' });
    const plannedChild = mk({ id: 'child-2', kind: 'leaf', parentId: 'epic-e', status: 'planned' });

    const todos = [epicE, doneChild, plannedChild];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    // Epic is not in doneEpics (not ALL children done), so epic survives
    expect(ids).toContain('epic-e');
    expect(ids).toContain('child-1');
    expect(ids).toContain('child-2');
  });

  it('orphan leaf planned — survives', () => {
    const orphan = mk({ id: 'orphan-leaf', kind: 'leaf', status: 'planned', title: 'Planned Orphan' });
    const todos = [orphan];
    const result = selectGraphTodos(todos);

    expect(resultIds(result)).toContain('orphan-leaf');
  });

  it('nested structure — epic with leaf child that has its own subtasks', () => {
    const epicE = mk({ id: 'epic-e', kind: 'epic', title: 'Epic E' });
    const leafL = mk({ id: 'leaf-l', kind: 'leaf', parentId: 'epic-e', status: 'in_progress' });
    const subtask1 = mk({ id: 'subtask-1', kind: 'leaf', parentId: 'leaf-l', status: 'done' });
    const subtask2 = mk({ id: 'subtask-2', kind: 'leaf', parentId: 'leaf-l', status: 'done' });

    const todos = [epicE, leafL, subtask1, subtask2];
    const result = selectGraphTodos(todos);
    const ids = resultIds(result);

    // Epic L is not done (only one child, in_progress), so everything survives
    expect(ids).toContain('epic-e');
    expect(ids).toContain('leaf-l');
    expect(ids).toContain('subtask-1');
    expect(ids).toContain('subtask-2');
  });

  it('empty input returns empty', () => {
    const result = selectGraphTodos([]);
    expect(result).toEqual([]);
  });

  it('nonexistent parent — children not filtered (parent not in todos)', () => {
    const orphanChild = mk({ id: 'child', kind: 'leaf', parentId: 'nonexistent-parent' });
    const todos = [orphanChild];
    const result = selectGraphTodos(todos);

    // Child's parent is not in the todos, so no parent-child link → child treated as orphan
    // Orphan is planned, so it survives
    expect(resultIds(result)).toContain('child');
  });
});
