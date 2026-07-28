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
  getConductorTargetMission: (project: string) => string | null;
  getConductorLastPass: (project: string) => ConductorLastPass | null;
  listTodos: (project: string, filter?: TodoFilter) => Todo[];
  listMissions: (project: string) => MissionSummary[];
}

/**
 * Pure function: resolve conductor-owned epic todoIds for a project.
 *
 * If the conductor is not enabled or its last pass is stale, returns [].
 * If a target mission is pinned and active, returns its live epic children.
 * If no pin and exactly one active non-terminal mission exists, returns its live epic children.
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

  // (3) Resolve missionId: try pinned target; fall back to single active+non-terminal.
  let missionId = deps.getConductorTargetMission(project);
  if (missionId == null) {
    // No pin → look for exactly one active non-terminal mission.
    const candidates = deps
      .listMissions(project)
      .filter((m) => m.mission.active && !isMissionTerminal(m.mission));
    // Zero or >1 candidates → ambiguous or none.
    if (candidates.length !== 1) {
      return [];
    }
    missionId = candidates[0]!.node.id;
  }

  // (4) Resolved missionId is required; if still null, return [].
  if (missionId == null) {
    return [];
  }

  // (5) Return live epic children of this mission.
  return deps
    .listTodos(project, { includeCompleted: true })
    .filter(
      (t) =>
        t.parentId === missionId &&
        t.kind === 'epic' &&
        t.status !== 'dropped',
    )
    .map((t) => t.id);
}
