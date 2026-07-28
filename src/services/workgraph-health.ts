import type { Todo, TodoStatus } from './todo-store';
import { isEpic, isMission } from './todo-kind';
import { isTerminalStatus, isTerminalEpic } from './invariant-check';
import { hasLandStamp } from './epic-landedness';

/** Workgraph health report — pure facts about epics, orphans, and structural issues. */
export interface WorkgraphHealth {
  /** Per-epic child counts grouped by status, with landed/terminal flags. */
  epicChildCounts: Array<{
    epicId: string;
    title: string;
    landed: boolean;
    terminal: boolean;
    counts: Record<TodoStatus, number>;
    total: number;
  }>;
  /** Live leaves with broken parent references. */
  orphanLeaves: Array<{
    todoId: string;
    title: string;
    parentId: string | null;
    reason: 'missing-parent' | 'parent-is-mission' | 'parent-is-terminal-epic';
  }>;
  /** Terminal epics that still retain open children. */
  terminalEpicsWithOpenChildren: Array<{
    epicId: string;
    title: string;
    openChildren: Array<{
      todoId: string;
      title: string;
      status: TodoStatus;
    }>;
  }>;
}

/** Pure workgraph-health computation over a Todo[] — no DB access. */
export function computeWorkgraphHealth(todos: Todo[]): WorkgraphHealth {
  // Build lookup maps: todo by id, and children grouped by parentId.
  const byId = new Map<string, Todo>(todos.map((t) => [t.id, t]));
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  // Initialize counts record with all status values set to 0.
  const initCounts = (): Record<TodoStatus, number> => ({
    backlog: 0,
    planned: 0,
    todo: 0,
    ready: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    dropped: 0,
  });

  // 1. epicChildCounts: for each epic, count children by status.
  const epicChildCounts: WorkgraphHealth['epicChildCounts'] = [];
  for (const t of todos) {
    if (!isEpic(t)) continue;
    const counts = initCounts();
    const children = childrenOf.get(t.id) ?? [];
    for (const child of children) {
      counts[child.status]++;
    }
    epicChildCounts.push({
      epicId: t.id,
      title: t.title ?? '',
      landed: hasLandStamp(t),
      terminal: isTerminalEpic(t),
      counts,
      total: children.length,
    });
  }

  // 2. orphanLeaves: non-epic, non-mission, non-terminal leaves with broken parent references.
  const orphanLeaves: WorkgraphHealth['orphanLeaves'] = [];
  for (const t of todos) {
    // Skip epics, missions, and terminal leaves (they are settled).
    if (isEpic(t) || isMission(t) || isTerminalStatus(t.status)) continue;
    // Only report leaves that have a problem with their parent.
    // If parentId is null OR parent doesn't exist → missing-parent.
    // If parent exists and is a mission → parent-is-mission.
    // If parent exists, is an epic, and is terminal → parent-is-terminal-epic.
    // Otherwise (live parent that is an epic, or other non-epic parent) → not orphaned.
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    let reason: 'missing-parent' | 'parent-is-mission' | 'parent-is-terminal-epic' | null = null;
    if (!t.parentId || !parent) {
      reason = 'missing-parent';
    } else if (isMission(parent)) {
      reason = 'parent-is-mission';
    } else if (isEpic(parent) && isTerminalEpic(parent)) {
      reason = 'parent-is-terminal-epic';
    }
    if (reason) {
      orphanLeaves.push({
        todoId: t.id,
        title: t.title ?? '',
        parentId: t.parentId ?? null,
        reason,
      });
    }
  }

  // 3. terminalEpicsWithOpenChildren: for each terminal epic with live children.
  const terminalEpicsWithOpenChildren: WorkgraphHealth['terminalEpicsWithOpenChildren'] = [];
  for (const t of todos) {
    if (!isEpic(t) || !isTerminalEpic(t)) continue;
    const children = childrenOf.get(t.id) ?? [];
    const openChildren = children.filter((c) => !isTerminalStatus(c.status));
    if (openChildren.length > 0) {
      terminalEpicsWithOpenChildren.push({
        epicId: t.id,
        title: t.title ?? '',
        openChildren: openChildren.map((c) => ({
          todoId: c.id,
          title: c.title ?? '',
          status: c.status,
        })),
      });
    }
  }

  return {
    epicChildCounts,
    orphanLeaves,
    terminalEpicsWithOpenChildren,
  };
}
