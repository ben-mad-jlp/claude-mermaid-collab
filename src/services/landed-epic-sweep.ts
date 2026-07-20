/**
 * Land-card reconciliation core: for converged-mission epics whose branch has fully
 * landed (ahead===0) and whose `landedAt` stamp is already set, finalize the [LAND]
 * leaf — completing it if it isn't already done. Idempotent: a second pass over an
 * already-reconciled epic makes zero writes.
 */
import { listTodos, stampEpicLandedAt, completeTodo, type Todo } from './todo-store.js';
import { listMissions } from './mission-store.js';
import { isEpic } from './todo-kind.js';
import { buildEpicBranchStatus, makeGitProbe, type GitProbe } from './epic-branch-status.js';

export interface LandedEpicSweepResult {
  /** Epics whose [LAND] leaf was completed this pass. */
  reconciled: string[];
  /** Epics inspected but already reconciled (no-op) or not yet eligible. */
  skipped: number;
}

export async function reconcileLandedEpics(
  project: string,
  opts: { probe?: GitProbe; baseRef?: string; now?: () => string } = {},
): Promise<LandedEpicSweepResult> {
  const probe = opts.probe ?? makeGitProbe(project);
  const baseRef = opts.baseRef ?? 'master';
  const missions = listMissions(project).filter((m) => m.mission.status === 'converged');
  const todos = listTodos(project, { includeCompleted: true });

  const missionEpicIds = new Set<string>();
  for (const m of missions) {
    for (const t of todos) {
      if (t.parentId === m.node.id && t.status !== 'dropped' && isEpic(t)) {
        missionEpicIds.add(t.id);
      }
    }
  }

  const report = buildEpicBranchStatus(todos, probe, baseRef, project);
  const statusByEpicId = new Map(report.epics.map((e) => [e.epicId, e]));

  const reconciled: string[] = [];
  let skipped = 0;

  for (const epicId of missionEpicIds) {
    const epic = todos.find((t) => t.id === epicId) as Todo | undefined;
    const branchStatus = statusByEpicId.get(epicId);
    if (!epic || !branchStatus || branchStatus.landLeafId == null || epic.landedAt == null || (branchStatus.ahead ?? 0) !== 0) {
      skipped++;
      continue;
    }
    if (branchStatus.landLeafDone === true) {
      skipped++;
      continue;
    }
    stampEpicLandedAt(project, epic.id, epic.landedAt);
    await completeTodo(project, branchStatus.landLeafId, 'accepted');
    reconciled.push(epic.id);
  }

  return { reconciled, skipped };
}
