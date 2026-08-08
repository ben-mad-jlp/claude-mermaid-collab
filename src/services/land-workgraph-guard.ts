/**
 * Land-workgraph guard — snapshot and restore descendants during land failure.
 *
 * When landEpic refuses or errors on a particular stage (checkDirtyTree,
 * runStewardPrecheck, checkStaleness, etc.), intermediate stages may have
 * modified children's stored state (claims, status, decisions). This module
 * snapshots the epic's work-graph BEFORE the first stage, then restores it
 * on any non-success outcome, using a durable diff to rebuild leaf state.
 */

import type { Todo, TodoStatus, ClaimStruct } from './todo-store';

/**
 * Stored-state tuple: the minimal set of columns that stages might mutate
 * before a refusal decision is made. Excludes id/title/description/kind
 * (immutable) and other cosmetic columns.
 */
export interface WorkGraphStoredState {
  status: TodoStatus;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  approvedAt: string | null;
  heldAt: string | null;
  claim: ClaimStruct | null;
  claimedBy: string | null;
  claimToken: string | null;
  claimedAt: string | null;
  completedAt: string | null;
}

/**
 * Snapshot the epic's entire work-graph (all descendants, excluding the epic
 * itself and any land-kind children) before the first land stage runs.
 *
 * Returns a Map of leafId → stored state, e.g.:
 * ```
 * {
 *   "leaf1": { status: 'todo', claim: null, ... },
 *   "leaf2": { status: 'in_progress', claim: { by: 'w1', ... }, ... },
 * }
 * ```
 *
 * Mirrors checkLandDeps's descendant-walk pattern (land-authority.ts:229)
 * to catch the same tree shape: all transitive descendants, cycle-safe,
 * excluding the epic root and any land-kind child.
 */
export function snapshotEpicWorkGraph(
  project: string,
  epicId: string,
  todos: Todo[],
): Map<string, WorkGraphStoredState> {
  const snapshot = new Map<string, WorkGraphStoredState>();

  // Build parent → children index, same as checkLandDeps.
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  // Transitive walk: start from epic's direct children, walk all descendants,
  // cycle-safe via `seen` set. Do NOT include the epic itself.
  const descendants: Todo[] = [];
  const stack = [...(childrenOf.get(epicId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    descendants.push(node);
    stack.push(...(childrenOf.get(node.id) ?? []));
  }

  // Exclude land-kind children (they are the gating leaves under the epic;
  // the land process handles them separately).
  const nonLandDescendants = descendants.filter((t) => t.kind !== 'land');

  // Snapshot each descendant's mutable state.
  for (const todo of nonLandDescendants) {
    snapshot.set(todo.id, {
      status: todo.status,
      acceptanceStatus: todo.acceptanceStatus,
      approvedAt: todo.approvedAt,
      heldAt: todo.heldAt,
      claim: todo.claim,
      claimedBy: todo.claimedBy,
      claimToken: todo.claimToken,
      claimedAt: todo.claimedAt,
      completedAt: todo.completedAt,
    });
  }

  return snapshot;
}

/**
 * Diff two snapshots and emit one entry per changed field.
 *
 * @param before - the pre-land snapshot (authority on which leaves were in scope)
 * @param after - the post-land snapshot
 * @returns array of { leafId, field, before: unknown, after: unknown }
 *
 * For each leafId in `before`:
 * - If missing from `after`, emit entries for every field with `after: undefined`
 * - If present, compare each field:
 *   - `claim`: JSON.stringify equality (object-or-null)
 *   - Others: !== comparison
 * - Emit one entry per differing field, not one per leaf
 */
export function diffWorkGraphSnapshot(
  before: Map<string, WorkGraphStoredState>,
  after: Map<string, WorkGraphStoredState>,
): Array<{ leafId: string; field: keyof WorkGraphStoredState; before: unknown; after: unknown }> {
  const drift: Array<{ leafId: string; field: keyof WorkGraphStoredState; before: unknown; after: unknown }> = [];

  for (const [leafId, beforeState] of before.entries()) {
    const afterState = after.get(leafId);

    if (!afterState) {
      // Leaf deleted mid-land. Record every field as drifted.
      for (const field of Object.keys(beforeState) as Array<keyof WorkGraphStoredState>) {
        drift.push({ leafId, field, before: beforeState[field], after: undefined });
      }
      continue;
    }

    // Leaf still present, compare per-field.
    for (const field of Object.keys(beforeState) as Array<keyof WorkGraphStoredState>) {
      const beforeVal = beforeState[field];
      const afterVal = afterState[field];

      let changed = false;
      if (field === 'claim') {
        // claim is object-or-null: use JSON.stringify for equality.
        changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
      } else {
        // All other fields: !== comparison.
        changed = beforeVal !== afterVal;
      }

      if (changed) {
        drift.push({ leafId, field, before: beforeVal, after: afterVal });
      }
    }
  }

  return drift;
}

/**
 * Restore changed leaves to their pre-land state, grouped by leafId.
 *
 * For each unique leafId in the drift array, reconstruct the target
 * WorkGraphStoredState by reading `before` values off the drift entries,
 * then call restoreTodoStoredState once per leaf with all drifted columns.
 *
 * Imported from todo-store.ts (declared locally there to avoid circular
 * dependency).
 */
export async function restoreWorkGraphSnapshot(
  project: string,
  drift: Array<{ leafId: string; field: keyof WorkGraphStoredState; before: unknown; after: unknown }>,
): Promise<void> {
  // Import at call time to avoid circular dependency on todo-store.ts.
  const { restoreTodoStoredState } = require('./todo-store') as {
    restoreTodoStoredState: (project: string, id: string, cols: any) => Promise<void>;
  };

  // Group drift entries by leafId.
  const byLeafId = new Map<string, typeof drift>();
  for (const entry of drift) {
    const arr = byLeafId.get(entry.leafId) ?? [];
    arr.push(entry);
    byLeafId.set(entry.leafId, arr);
  }

  // For each leaf, reconstruct its target state from the "before" values.
  for (const [leafId, entries] of byLeafId.entries()) {
    const targetState: Partial<WorkGraphStoredState> = {};
    for (const entry of entries) {
      (targetState as any)[entry.field] = entry.before;
    }
    // Call the todo-store writer exactly once per leaf.
    await restoreTodoStoredState(project, leafId, targetState);
  }
}
