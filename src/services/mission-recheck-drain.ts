/** mission-recheck-drain.ts — GC rows from the mission_recheck queue and hand off pending rechecks
 * for the driven mission. Pure store arithmetic; fail-open on any single row.
 */

import { listPendingRechecks, clearRecheck, getMission, listCriteria, isMissionTerminal, type MissionRecheck } from './mission-store.js';

export interface RecheckDrainResult {
  cleared: string[];
  pending: MissionRecheck[];
}

/** Drain the mission_recheck queue for a given project and driven mission.
 * GC terminal/missing missions, missing criteria, and verified criteria.
 * Return pending rechecks for the driven mission only.
 *
 * Per-row failures are caught and skipped; a single corrupt row must not lose the rest.
 */
export function drainMissionRechecks(project: string, drivenMissionId: string): RecheckDrainResult {
  const cleared: string[] = [];
  const pending: MissionRecheck[] = [];

  const rows = listPendingRechecks(project);
  const missionMemo = new Map<string, ReturnType<typeof getMission>>();

  for (const row of rows) {
    try {
      // Resolve mission once per distinct todoId to avoid repeated expensive reads
      let mission = missionMemo.get(row.todoId);
      if (!missionMemo.has(row.todoId)) {
        mission = getMission(project, row.todoId);
        missionMemo.set(row.todoId, mission);
      }

      // GARBAGE: mission row missing or terminal
      if (!mission || isMissionTerminal({ status: mission.status, abandonedAt: mission.abandonedAt, closedAt: mission.closedAt })) {
        clearRecheck(project, row.criterionId);
        cleared.push(row.criterionId);
        continue;
      }

      // GARBAGE: criterion no longer exists
      const criteria = listCriteria(project, row.todoId);
      const criterion = criteria.find((c) => c.id === row.criterionId);
      if (!criterion) {
        clearRecheck(project, row.criterionId);
        cleared.push(row.criterionId);
        continue;
      }

      // GARBAGE: criterion was re-verified since the reopen
      if (criterion.verifiedAt != null) {
        clearRecheck(project, row.criterionId);
        cleared.push(row.criterionId);
        continue;
      }

      // PENDING: row on the DRIVEN live mission, unverified criterion
      if (row.todoId === drivenMissionId) {
        pending.push(row);
      }
      // UNTOUCHED: live non-driven mission — neither cleared nor returned
    } catch {
      // fail-open: skip one corrupt row, continue draining the rest
    }
  }

  return { cleared, pending };
}
