/**
 * Land-card reconciliation core: for converged-mission epics whose branch has fully
 * landed (ahead===0) and whose `landedAt` stamp is already set, finalize the [LAND]
 * leaf — completing it if it isn't already done. Idempotent: a second pass over an
 * already-reconciled epic makes zero writes.
 */
import { listTodos, stampEpicLandedAt, completeTodo, type Todo } from './todo-store.js';
import { listMissions, promoteQueuedMissions } from './mission-store.js';
import { isEpic } from './todo-kind.js';
import { buildEpicBranchStatus, makeGitProbe, epicBranchName, type GitProbe } from './epic-branch-status.js';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { yieldToLoop } from './loop-yield.js';
import { syncMissionSubscription } from './mission-subscription.js';

/** Minimum spacing between PERIODIC landed-epic sweeps for a single project. Same
 *  throttle shape as ARCHIVAL_SWEEP_INTERVAL_MS (archival-sweep.ts) — hygiene, not
 *  claim/build-latency-sensitive. */
export const LANDED_EPIC_SWEEP_INTERVAL_MS = 300_000; // 5 min

const lastLandedEpicSweepMs = new Map<string, number>();

export function shouldRunLandedEpicSweep(project: string, now: number = Date.now()): boolean {
  const last = lastLandedEpicSweepMs.get(project);
  if (last !== undefined && now - last < LANDED_EPIC_SWEEP_INTERVAL_MS) return false;
  lastLandedEpicSweepMs.set(project, now);
  return true;
}

export function _resetLandedEpicSweepThrottle(project?: string): void {
  if (project === undefined) lastLandedEpicSweepMs.clear();
  else lastLandedEpicSweepMs.delete(project);
}

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

/** A git delete/tip-read runner — injected so branch deletion is hermetically
 *  testable without a real repo. Mirrors GitProbe's injection shape
 *  (epic-branch-status.ts:44). */
export interface BranchGcRunner {
  /** HEAD SHA of `branch`, or null if it doesn't resolve. */
  revParse(branch: string): string | null;
  /** Force-delete `branch` (git branch -D). Returns true on success. */
  deleteBranch(branch: string): boolean;
}

export interface GcEpicBranchesResult {
  /** Branches deleted this pass (branch name, not epic id). */
  deleted: string[];
  /** Epic ids whose branch is ahead>0 and was left intact for human review. */
  flagged: string[];
  /** Epics inspected but with no branch to act on (missing/already gone). */
  skipped: number;
}

function runGitLocal(cwd: string, args: string[]): { code: number; stdout: string } {
  try {
    const p = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore' });
    return { code: p.exitCode ?? 1, stdout: p.stdout?.toString() ?? '' };
  } catch {
    return { code: 1, stdout: '' };
  }
}

export function makeBranchGcRunner(project: string): BranchGcRunner {
  return {
    revParse(branch: string): string | null {
      const r = runGitLocal(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      const sha = r.stdout.trim();
      return r.code === 0 && sha ? sha : null;
    },
    deleteBranch(branch: string): boolean {
      return runGitLocal(project, ['branch', '-D', branch]).code === 0;
    },
  };
}

/** Recovery log: one line per deleted branch, so a wrongly-deleted branch's tip
 *  can be recovered by hand (`git branch <name> <sha>`). Mirrors the recovery-log
 *  shape of docs/designs/ui-cleanup/pruned-branches-recovery.md. */
function appendRecoveryLog(project: string, branch: string, tipSha: string, whenIso: string): void {
  const path = join(project, '.collab', 'pruned-branches-recovery.md');
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `- ${whenIso} ${branch} ${tipSha}\n`);
}

/**
 * Delete an epic's `collab/epic/<id8>` branch ONLY when git proves it carries zero
 * unlanded commits (exists && ahead===0). A branch with ahead>0 is flagged for
 * human/supervisor review and left intact — never deleted speculatively. Before
 * any delete, the branch's tip SHA is captured to a recovery log
 * (.collab/pruned-branches-recovery.md) so a wrong delete is recoverable.
 *
 * Read-only fallback: an epic with no branch (exists:false) is skipped, not flagged
 * — there's nothing to GC or recover.
 */
export function gcEpicBranches(
  project: string,
  opts: { probe?: GitProbe; runner?: BranchGcRunner; baseRef?: string; now?: () => string } = {},
): GcEpicBranchesResult {
  const probe = opts.probe ?? makeGitProbe(project);
  const runner = opts.runner ?? makeBranchGcRunner(project);
  const baseRef = opts.baseRef ?? 'master';
  const now = opts.now ?? (() => new Date().toISOString());

  const todos = listTodos(project, { includeCompleted: true });
  const report = buildEpicBranchStatus(todos, probe, baseRef, project);

  const deleted: string[] = [];
  const flagged: string[] = [];
  let skipped = 0;

  for (const e of report.epics) {
    if (!e.exists) { skipped++; continue; }
    if ((e.ahead ?? 0) > 0) { flagged.push(e.epicId); continue; }
    const tip = runner.revParse(e.branch);
    if (tip == null) { skipped++; continue; }
    if (runner.deleteBranch(e.branch)) {
      appendRecoveryLog(project, e.branch, tip, now());
      deleted.push(e.branch);
    } else {
      skipped++;
    }
  }

  return { deleted, flagged, skipped };
}

export interface RunLandedEpicSweepResult {
  reconcile: LandedEpicSweepResult;
  gc: GcEpicBranchesResult;
  promoted: string[];
}

/**
 * Throttled composed pass: reconcileLandedEpics then gcEpicBranches, yielding to the
 * event loop between the two batches (same two-batch yield shape as
 * runArchivalSweep's todo/mission batches — archival-sweep.ts).
 */
export async function runLandedEpicSweep(
  project: string,
  opts: {
    now?: number;
    yieldFn?: () => Promise<void>;
    force?: boolean;
    probe?: GitProbe;
    runner?: BranchGcRunner;
    baseRef?: string;
  } = {},
): Promise<RunLandedEpicSweepResult> {
  const now = opts.now ?? Date.now();
  if (!opts.force && !shouldRunLandedEpicSweep(project, now)) {
    return { reconcile: { reconciled: [], skipped: 0 }, gc: { deleted: [], flagged: [], skipped: 0 }, promoted: [] };
  }
  const doYield = opts.yieldFn ?? yieldToLoop;

  const reconcile = await reconcileLandedEpics(project, { probe: opts.probe, baseRef: opts.baseRef });
  await doYield();
  const gc = gcEpicBranches(project, { probe: opts.probe, runner: opts.runner, baseRef: opts.baseRef });

  await doYield();
  let promoted: string[] = [];
  try {
    promoted = promoteQueuedMissions(project);
    for (const missionId of promoted) {
      try {
        syncMissionSubscription(project, missionId);
      } catch {
        /* fail-open, per mission-subscription.ts's own idempotent contract */
      }
    }
  } catch (err) {
    console.warn(
      `[landed-epic-sweep] queued-mission promotion failed for ${project}:`,
      err instanceof Error ? err.message : err,
    );
  }

  return { reconcile, gc, promoted };
}
