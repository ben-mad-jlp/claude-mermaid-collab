/**
 * Human inbox selector (user-todo B3).
 *
 * The single source of "what a PERSON needs to pick up or finish" for a project:
 * the work-graph todos whose `assigneeKind === 'human'` that are actionable by a
 * human right now — i.e. `ready` (claim & start) or `in_progress` (complete).
 * Done / blocked / backlog human todos are NOT inbox items.
 *
 * Pure + unit-testable; mirrors the escalationSelectors pattern. Callers pass an
 * already project-scoped todo list (the Bridge scopes via `todosByProject[p]`),
 * so this selector does NOT take a project param — keeping it composable.
 *
 * Per design Q2: collab LISTS the item, the program RENDERS the work. The inbox
 * row carries the todo's deep-link (`todo.link`) so a person can jump into the
 * program's native UI; this module only decides membership + ordering.
 */

import type { SessionTodo } from '@/types/sessionTodo';

/** Work-graph statuses a human can act on from the inbox. */
const ACTIONABLE: ReadonlySet<SessionTodo['status']> = new Set(['ready', 'in_progress']);

/** True when a todo is a human-actionable inbox item. */
export function isHumanInboxItem(t: SessionTodo): boolean {
  return t.assigneeKind === 'human' && ACTIONABLE.has(t.status);
}

/**
 * The human inbox set for an (already project-scoped) todo list. Ordered
 * `in_progress` first (finish what you started), then `ready` (new work), each
 * group by the sibling `order` ascending so it matches the Plan's sort.
 */
export function selectHumanInbox(todos: SessionTodo[]): SessionTodo[] {
  const rank = (t: SessionTodo): number => (t.status === 'in_progress' ? 0 : 1);
  return todos
    .filter(isHumanInboxItem)
    .slice()
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.order - b.order;
    });
}

export interface HumanInboxCounts {
  total: number;
  ready: number;
  inProgress: number;
}

/** Glanceable counts for the inbox header / a badge. */
export function humanInboxCounts(todos: SessionTodo[]): HumanInboxCounts {
  const items = selectHumanInbox(todos);
  return {
    total: items.length,
    ready: items.filter((t) => t.status === 'ready').length,
    inProgress: items.filter((t) => t.status === 'in_progress').length,
  };
}
