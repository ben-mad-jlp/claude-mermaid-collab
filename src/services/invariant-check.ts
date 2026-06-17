import type { Todo, TodoStatus } from './todo-store';
import { listTodos } from './todo-store';

/**
 * Work-graph invariant checker (read-only health report).
 *
 * Returns the VIOLATIONS of the documented work-graph invariants — never the
 * whole graph. The core is a PURE function (`findViolations`) over a Todo[] so
 * it is trivially unit-testable; `checkInvariants` is the thin DB-backed wrapper
 * the MCP tool calls.
 *
 * Invariants checked (with their decision/constraint ids):
 *  - orphan                  non-epic todo with no [EPIC] ancestor (373a2d52 —
 *                            every work todo must belong to an epic).
 *  - stranded-epic           [EPIC] with no [LAND] leaf among its descendants
 *                            (a383bc2c — every epic ends with a land leaf).
 *  - epic-planned-ready-child an [EPIC] still 'planned' that has a 'ready' child.
 *  - broken-depends-on       dependsOn points at a missing or dropped todo.
 *
 * Epics and land leaves are identified by their title prefix ([EPIC] / [LAND]),
 * matching coordinator-live's isEpicTodo and the planner's land-leaf convention.
 */

export type InvariantKind =
  | 'orphan'
  | 'stranded-epic'
  | 'epic-planned-ready-child'
  | 'broken-depends-on';

export interface InvariantViolation {
  kind: InvariantKind;
  todoId: string;
  title: string;
  reason: string;
}

/** True when a todo's title marks it an [EPIC] root (mirrors coordinator-live.isEpicTodo). */
export function isEpicTodo(t: Todo): boolean {
  return /^\s*\[EPIC\]/i.test(t.title ?? '');
}

/** True when a todo's title marks it a [LAND] → master leaf. */
export function isLandTodo(t: Todo): boolean {
  return /^\s*\[LAND\]/i.test(t.title ?? '');
}

/** Terminal states excluded from "active" health checks. */
function isTerminal(status: TodoStatus): boolean {
  return status === 'done' || status === 'dropped';
}

/**
 * Pure invariant checker — judges a Todo[] and returns the violations only.
 * No DB access, so unit tests can feed hand-built graphs.
 */
export function findViolations(todos: Todo[]): InvariantViolation[] {
  const byId = new Map<string, Todo>(todos.map((t) => [t.id, t]));
  const violations: InvariantViolation[] = [];

  // Children grouped by parentId, for the stranded-epic + planned-ready-child checks.
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  /** Walk parentId ancestry; true if any ancestor (or self) is an [EPIC]. Cycle-safe. */
  const hasEpicAncestor = (t: Todo): boolean => {
    const seen = new Set<string>();
    let cur: Todo | undefined = t;
    while (cur) {
      if (isEpicTodo(cur)) return true;
      if (!cur.parentId || seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    return false;
  };

  /** Any descendant (transitive) of `epic` that is a [LAND] leaf. Cycle-safe. */
  const hasLandDescendant = (epic: Todo): boolean => {
    const stack = [...(childrenOf.get(epic.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (isLandTodo(node)) return true;
      stack.push(...(childrenOf.get(node.id) ?? []));
    }
    return false;
  };

  for (const t of todos) {
    if (isTerminal(t.status)) continue;

    // 1. orphan — a non-epic active todo with no [EPIC] ancestor.
    if (!isEpicTodo(t) && !hasEpicAncestor(t)) {
      violations.push({
        kind: 'orphan',
        todoId: t.id,
        title: t.title,
        reason: 'non-epic todo with no [EPIC] ancestor (must belong to an epic)',
      });
    }

    // 2. stranded-epic — an [EPIC] with no [LAND] leaf anywhere beneath it.
    if (isEpicTodo(t) && !hasLandDescendant(t)) {
      violations.push({
        kind: 'stranded-epic',
        todoId: t.id,
        title: t.title,
        reason: 'epic has no [LAND] → master leaf among its descendants',
      });
    }

    // 3. epic-planned-ready-child — epic still 'planned' but has a 'ready' child.
    if (isEpicTodo(t) && t.status === 'planned') {
      const readyChild = (childrenOf.get(t.id) ?? []).find((c) => c.status === 'ready');
      if (readyChild) {
        violations.push({
          kind: 'epic-planned-ready-child',
          todoId: t.id,
          title: t.title,
          reason: `epic is 'planned' but child ${readyChild.id} is 'ready'`,
        });
      }
    }

    // 4. broken-depends-on — a dep points at a missing or dropped todo.
    for (const depId of t.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (!dep) {
        violations.push({
          kind: 'broken-depends-on',
          todoId: t.id,
          title: t.title,
          reason: `dependsOn references missing todo ${depId}`,
        });
      } else if (dep.status === 'dropped') {
        violations.push({
          kind: 'broken-depends-on',
          todoId: t.id,
          title: t.title,
          reason: `dependsOn references dropped todo ${depId}`,
        });
      }
    }

    // 5. (S4, epic b2c858d4) blocked-on-nothing — REMOVED. 'blocked' is no longer a
    // materialized readiness state; readiness is derived by claimability, so a 'blocked' enum
    // value whose deps are all done is just legacy noise the predicate ignores, not a violation.
  }

  return violations;
}

/** DB-backed wrapper: load the project's full work-graph and return its violations. */
export function checkInvariants(project: string): InvariantViolation[] {
  const todos = listTodos(project, { includeCompleted: true });
  return findViolations(todos);
}
