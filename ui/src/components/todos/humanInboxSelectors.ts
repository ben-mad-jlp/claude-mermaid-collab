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
import { claimReason, buildById } from '@/lib/claimability';

/**
 * True when a todo is a human-actionable inbox item. A human can act on a todo
 * that is in-flight (claim != null → "complete it") or fully-unblocked-and-approved
 * (claimReason 'human-assignee' → "claim & start"). Readiness/in-flight are DERIVED
 * via the predicate (epic b2c858d4), never read off the shadow `status` enum.
 */
export function isHumanInboxItem(t: SessionTodo, byId: Map<string, SessionTodo>): boolean {
  if (t.assigneeKind !== 'human') return false;
  if (t.claim != null) return true; // in-flight → completable
  return claimReason(t, byId) === 'human-assignee';
}

/**
 * The human inbox set for an (already project-scoped) todo list. Ordered
 * in-flight first (finish what you started), then claimable (new work), each
 * group by the sibling `order` ascending so it matches the Plan's sort.
 */
export function selectHumanInbox(todos: SessionTodo[]): SessionTodo[] {
  const byId = buildById(todos);
  const rank = (t: SessionTodo): number => (t.claim != null ? 0 : 1);
  return todos
    .filter((t) => isHumanInboxItem(t, byId))
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
  // In-flight = claim != null; the rest of the inbox set is the claimable/ready
  // human work. Derived via `claim`, never the shadow status enum (epic b2c858d4).
  const inProgress = items.filter((t) => t.claim != null).length;
  return {
    total: items.length,
    ready: items.length - inProgress,
    inProgress,
  };
}
