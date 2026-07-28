/**
 * conductor-owned-todos.ts — pure selector for conductor-owned epic todoIds.
 *
 * Exposes a testable predicate that reads the conductor's freshness state and
 * resolves owned epics without incurring caller coupling to mission-store/supervisor-store.
 */

import type { ConductorLastPass } from './supervisor-store.ts';
import type { Todo, TodoFilter } from './todo-store.ts';
import type { MissionSummary } from './mission-store.ts';
import { isMissionTerminal } from './mission-store.ts';

export const RUNNING_FRESH_MS = 5 * 60 * 1000;

export interface ConductorOwnedTodosDeps {
  getConductorEnabled: (project: string) => boolean;
  getConductorLastPass: (project: string) => ConductorLastPass | null;
  listTodos: (project: string, filter?: TodoFilter) => Todo[];
  listMissions: (project: string) => MissionSummary[];
}

/**
 * Pure function: resolve conductor-owned descendant todoIds for a project.
 *
 * If the conductor is not enabled or its last pass is stale, returns [].
 * If exactly one active non-terminal mission exists, returns its live (non-dropped)
 * descendants transitively — both epics and leaves. A dropped node and its entire
 * subtree are excluded from the result.
 * Otherwise returns [] (ambiguous or no actionable mission).
 *
 * Pure: all time-dependent predicates use the `nowMs` parameter, not Date.now().
 */
export function selectConductorOwnedTodoIds(
  project: string,
  nowMs: number,
  deps: ConductorOwnedTodosDeps,
): string[] {
  // (1) Conductor disabled → no owned epics.
  if (!deps.getConductorEnabled(project)) {
    return [];
  }

  // (2) Last pass missing, not a pass-ran, or stale → no owned epics.
  const lp = deps.getConductorLastPass(project);
  if (
    !lp ||
    lp.reason !== 'pass-ran' ||
    typeof lp.tickAt !== 'number' ||
    nowMs - lp.tickAt >= RUNNING_FRESH_MS
  ) {
    return [];
  }

  // (3) Resolve missionId: the project's single active non-terminal mission.
  const candidates = deps
    .listMissions(project)
    .filter((m) => m.mission.active && !isMissionTerminal(m.mission));
  // Zero or >1 candidates → ambiguous or none.
  if (candidates.length !== 1) {
    return [];
  }
  const missionId = candidates[0]!.node.id;

  // (4) Return live (non-dropped) descendants of this mission, transitively.
  // Build a parentId -> Todo[] index for O(n) walk.
  const all = deps.listTodos(project, { includeCompleted: true });
  const childrenByParent = new Map<string, Todo[]>();
  for (const todo of all) {
    if (todo.parentId) {
      if (!childrenByParent.has(todo.parentId)) {
        childrenByParent.set(todo.parentId, []);
      }
      childrenByParent.get(todo.parentId)!.push(todo);
    }
  }

  // BFS walk from missionId, collecting live descendants and pruning dropped subtrees.
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [missionId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const children = childrenByParent.get(currentId) || [];
    for (const child of children) {
      if (child.status === 'dropped') {
        // Prune: do not add to result, do not enqueue for descent
        continue;
      }
      result.push(child.id);
      queue.push(child.id);
    }
  }

  return result;
}
