import type { SessionTodo, TodoStatus } from '@/types/sessionTodo';

export const UNASSIGNED = '(unassigned)';

export interface AssigneeGroup {
  assignee: string; // a session name, or UNASSIGNED
  todos: SessionTodo[];
}

/**
 * Group todos by assigneeSession for the manager dashboard. Unassigned bucket
 * first, then assignees alphabetically; within a group, ordered by `order`.
 * Pure — unit-testable.
 */
export function groupByAssignee(todos: SessionTodo[]): AssigneeGroup[] {
  const map = new Map<string, SessionTodo[]>();
  for (const t of todos) {
    const key = t.assigneeSession ?? UNASSIGNED;
    (map.get(key) ?? map.set(key, []).get(key)!).push(t);
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (a === UNASSIGNED) return -1;
    if (b === UNASSIGNED) return 1;
    return a.localeCompare(b);
  });
  return keys.map((assignee) => ({
    assignee,
    todos: map.get(assignee)!.slice().sort((a, b) => a.order - b.order),
  }));
}

/** Count of todos per status within a list (for the per-group status summary). */
export function statusCounts(todos: SessionTodo[]): Partial<Record<TodoStatus, number>> {
  const counts: Partial<Record<TodoStatus, number>> = {};
  for (const t of todos) {
    const s = t.status ?? (t.completed ? 'done' : 'todo');
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}
