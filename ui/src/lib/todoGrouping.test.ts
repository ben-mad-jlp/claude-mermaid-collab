import { describe, it, expect } from 'vitest';
import { groupByAssignee, statusCounts, UNASSIGNED } from './todoGrouping';
import type { SessionTodo } from '@/types/sessionTodo';

const mk = (over: Partial<SessionTodo>): SessionTodo => ({
  id: over.id ?? 'x', ownerSession: 'me', assigneeSession: null, title: 't', text: undefined,
  description: null, status: 'todo', completed: false, priority: null, dueDate: null,
  parentId: null, dependsOn: [], order: over.order ?? 10, link: null,
  createdAt: '', updatedAt: '', completedAt: null, asanaGid: null, ...over,
});

describe('groupByAssignee', () => {
  it('puts unassigned first, then assignees alphabetically, ordered within', () => {
    const groups = groupByAssignee([
      mk({ id: '1', assigneeSession: 'bob', order: 20 }),
      mk({ id: '2', assigneeSession: null, order: 10 }),
      mk({ id: '3', assigneeSession: 'amy', order: 5 }),
      mk({ id: '4', assigneeSession: 'bob', order: 10 }),
    ]);
    expect(groups.map((g) => g.assignee)).toEqual([UNASSIGNED, 'amy', 'bob']);
    expect(groups.find((g) => g.assignee === 'bob')!.todos.map((t) => t.id)).toEqual(['4', '1']); // by order
  });
});

describe('statusCounts', () => {
  it('counts by status, defaulting missing status', () => {
    const counts = statusCounts([
      mk({ status: 'in_progress' }), mk({ status: 'in_progress' }), mk({ status: 'done' }),
    ]);
    expect(counts).toEqual({ in_progress: 2, done: 1 });
  });
});
