/**
 * Canonical API for three distinct landed-ness notions.
 *
 * INTENT STAMP: `epic.landedAt` — a land path stamped intent to land.
 * GIT-REACHED-MASTER: a merge sha in the land record — durable proof the epic's tip reached master.
 * REACHABILITY: descendant work audit — all accepted code leaves carry committed trailers reachable from the epic branch.
 *
 * These three disagree in real states: a stamp without a merge (land started, then failed),
 * a merge without a status (completed by direct commit), or landed-but-stranded work (a leaf
 * committed elsewhere). They must NEVER be collapsed into one boolean — each has distinct
 * call sites and implications.
 */

import type { Todo } from './todo-store.js';
import { getEpicLandRecord } from './epic-land-record-store.js';
import { getEpicLandReadiness, type LandFinding } from './epic-land-readiness.js';

/**
 * Characterization of whether an epic's descendant work is reachable from the epic branch.
 * On probe failure, safe-defaults to indeterminate (reachable=false, indeterminate=true).
 */
export interface EpicWorkReachability {
  /** True if all accepted code descendants are reachable from the epic branch. */
  reachable: boolean;
  /** True if reachability could not be determined due to a probe/DB error. */
  indeterminate: boolean;
  /** Findings whose kind is 'missing' or 'stranded' (reachability-blocking). */
  stranded: LandFinding[];
}

/**
 * Is the epic considered "landed" from a rollup-status perspective?
 *
 * Returns true if either the epic's status is 'done' OR it has a stamped landedAt.
 * The dual predicate is necessary because land paths can leave an epic landed while
 * its status lags at 'todo' (observed on 7 build123d epics, 2026-07-24), and such an
 * epic could never satisfy a status-only test — masking its criterion forever.
 *
 * Entitled call sites: criterion rollup (mission-store.ts:1477), any consumer deriving
 * mission-level done/active status from epic status.
 */
export function isLanded(epic: Todo): boolean {
  return epic.status === 'done' || epic.landedAt != null;
}

/**
 * Does the epic have a stamped landedAt field, independent of status rollup?
 *
 * Returns true only if the land path set the intentional stamp. Entitled call sites
 * are those asking "did a land path set intent?" independent of the epic's status —
 * e.g., invariant-check.ts:172 (landedAt-divergence checks). Using isLanded there
 * would make a status-done, never-stamped epic read as stamped (false positive).
 */
export function hasLandStamp(epic: Todo): boolean {
  return epic.landedAt != null;
}

/**
 * Does the epic's status field read as 'done'?
 *
 * Returns true only for status === 'done', independent of whether a land stamp exists.
 * Entitled call sites: rollup-status consumers (mission-store.ts:1465, hasLandedEpic),
 * any criterion satisfied by completion status alone. Using isLanded there would widen
 * the predicate to stamped-but-open epics and change derived mission status — a behaviour
 * change, not a cleanup.
 */
export function isEpicStatusDone(epic: Todo): boolean {
  return epic.status === 'done';
}

/**
 * Has the epic's tip reached master via a land merge?
 *
 * Reads the durable land record (proof from a successful landEpicToMaster call) and
 * returns true only if a record exists AND the landedMergeSha is non-empty after trim.
 * Never throws (the underlying reader guards all errors).
 */
export function hasGitReachedMaster(project: string, epicId: string): boolean {
  try {
    const record = getEpicLandRecord(project, epicId);
    if (!record) return false;
    return record.landedMergeSha.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Audit whether an epic's descendant work is reachable from its branch.
 *
 * Shells out to git via makeCommitProbe; runs async and never throws on probe failure
 * (returns safe-default indeterminate shape). Filtering on reachability-relevant findings:
 * 'missing' and 'stranded' block work acceptance; 'orphaned-proof' is a different concern.
 */
export async function isEpicWorkReachable(project: string, epicId: string): Promise<EpicWorkReachability> {
  try {
    const report = await getEpicLandReadiness(project, epicId);
    return {
      reachable: !report.blocking,
      indeterminate: false,
      stranded: report.findings.filter((f) => f.kind === 'missing' || f.kind === 'stranded'),
    };
  } catch {
    return {
      reachable: false,
      indeterminate: true,
      stranded: [],
    };
  }
}

// Re-export LandFinding for use in EpicWorkReachability interface.
export type { LandFinding } from './epic-land-readiness.js';
