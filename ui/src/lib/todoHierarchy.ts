/**
 * todoHierarchy.ts — the SINGLE sanctioned structural derivation the UI is allowed
 * to use. This module answers "who is whose child / which nodes are lanes", built
 * **on top of** the declared-`kind` predicate (never on `childrenByParent.has(id)`).
 *
 * Design rules encoded here (constraint 373a2d52):
 * 1. A lane exists for every `kind === 'epic'` todo, including one with zero children.
 * 2. A leaf with children (auto-split) is never a lane. It stays an item in its
 *    own parent-epic's lane, and its children are exposed separately as sub-tasks.
 * 3. `parentEpicId` is only set when the parent is a declared epic. A child of a
 *    split leaf has `parentEpicId === null` and appears under subtasksByParent.
 * 4. Nothing here reads `parentId` to decide a role — only to decide structure.
 *
 * Any UI file computing `new Set(childrenByParent.keys())` is a bug; this module
 * makes that pattern unnecessary and is the only source for such derivations.
 */

import {
  type IdentifiedKindBearing,
  epicIdSet,
  parentEpicIdOf,
} from './todoKind';

/** Structural view over a flat todo list. Generic in T so backend fixtures,
 *  `SessionTodo`, and narrower render shapes all work (same precedent as todoKind). */
export interface TodoHierarchy<T extends IdentifiedKindBearing> {
  /** id → todo, for every todo in the input. */
  byId: ReadonlyMap<string, T>;
  /** Ids of todos with `kind === 'epic'`. A childless epic IS here. A split leaf is NOT. */
  epicIds: ReadonlySet<string>;
  /** epicId → its direct children, in input order. Every epic id has an entry,
   *  possibly an EMPTY array (that is the childless-epic lane). */
  childrenByEpic: ReadonlyMap<string, T[]>;
  /** leafId (or land id) → its direct children — the auto-splitter's sub-tasks.
   *  Only non-epic parents appear here. */
  subtasksByParent: ReadonlyMap<string, T[]>;
  /** Todos that are neither an epic nor the child of an epic nor a sub-task of a
   *  non-epic parent — i.e. the "No epic" bucket. */
  orphans: T[];
}

export function buildTodoHierarchy<T extends IdentifiedKindBearing>(
  todos: readonly T[],
): TodoHierarchy<T> {
  const byId = new Map(todos.map(t => [t.id, t]));
  const epicIds = epicIdSet(todos);
  const childrenByEpic = new Map<string, T[]>();
  const subtasksByParent = new Map<string, T[]>();

  // Seed childrenByEpic with all epic IDs mapped to empty arrays.
  // This single line is what makes a childless epic render as an empty lane
  // instead of vanishing — it is the half of constraint 373a2d52 the old code
  // could not express.
  epicIds.forEach(id => childrenByEpic.set(id, []));

  // Track which todos have been placed as children or subtasks
  const placed = new Set<string>();

  // One pass: for each todo with a parent in the input set
  for (const t of todos) {
    if (t.parentId != null && byId.has(t.parentId)) {
      if (epicIds.has(t.parentId)) {
        childrenByEpic.get(t.parentId)!.push(t);
      } else {
        if (!subtasksByParent.has(t.parentId)) {
          subtasksByParent.set(t.parentId, []);
        }
        subtasksByParent.get(t.parentId)!.push(t);
      }
      placed.add(t.id);
    }
  }

  // Orphans = todos that are neither an epic nor placed in either child map.
  // A split leaf stays wherever its own parent puts it; it is NOT promoted out
  // of its lane.
  const orphans: T[] = [];
  for (const t of todos) {
    if (!epicIds.has(t.id) && !placed.has(t.id)) {
      orphans.push(t);
    }
  }

  return {
    byId,
    epicIds,
    childrenByEpic,
    subtasksByParent,
    orphans,
  };
}

/** The epic lane a todo belongs to, or null. Thin re-export-style wrapper over
 *  `parentEpicIdOf` so call sites need one import, not two. */
export function parentEpicOf<T extends IdentifiedKindBearing>(
  t: T,
  h: TodoHierarchy<T>,
): string | null {
  return parentEpicIdOf(t, h.epicIds);
}

/** True when `t` is a LEAF/LAND that owns children (auto-split). Render it as an
 *  expandable item, never as a lane. */
export function hasSubtasks<T extends IdentifiedKindBearing>(
  t: T,
  h: TodoHierarchy<T>,
): boolean {
  return h.subtasksByParent.has(t.id);
}

/** Every transitive descendant of `id` (children of epics AND sub-tasks), pre-order.
 *  Replaces the ad-hoc stack walk at PlanPanel.tsx:218. Cycle-safe via a seen-set. */
export function descendantsOf<T extends IdentifiedKindBearing>(
  id: string,
  h: TodoHierarchy<T>,
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();

  const walk = (parentId: string) => {
    if (seen.has(parentId)) return;
    seen.add(parentId);

    // Add direct children from childrenByEpic if it's an epic
    const epicChildren = h.childrenByEpic.get(parentId);
    if (epicChildren) {
      for (const child of epicChildren) {
        result.push(child);
        walk(child.id);
      }
    }

    // Add direct children from subtasksByParent if it has subtasks
    const subtasks = h.subtasksByParent.get(parentId);
    if (subtasks) {
      for (const subtask of subtasks) {
        result.push(subtask);
        walk(subtask.id);
      }
    }
  };

  walk(id);
  return result;
}
