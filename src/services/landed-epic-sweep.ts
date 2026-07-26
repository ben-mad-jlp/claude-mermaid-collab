/**
 * Land-card reconciliation core: for converged-mission epics whose branch has fully
 * landed (ahead===0) and whose `landedAt` stamp is already set, finalize the [LAND]
 * leaf — completing it if it isn't already done. Idempotent: a second pass over an
 * already-reconciled epic makes zero writes.
 */
import { listTodos, completeTodo, type Todo } from './todo-store.js';
import { stampEpicLandedAtGated } from './epic-landed-stamp-gate.js';
import { listMissions, promoteQueuedMissions } from './mission-store.js';
import { isEpic } from './todo-kind.js';
import { buildEpicBranchStatus, makeGitProbe, epicBranchName, effectiveNewCount, type BranchLister, type GitProbe } from './epic-branch-status.js';
import { rescueOrphanedLeafCommitsForBranch } from './rescue-ref.js';
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
  opts: { probe?: GitProbe; baseRef?: string; now?: () => string; listBranches?: BranchLister } = {},
): Promise<LandedEpicSweepResult> {
  const probe = opts.probe ?? makeGitProbe(project);
  const baseRef = opts.baseRef ?? 'master';
  // Prefilter probes to branches that actually exist (crit-5). When a fake probe is
  // injected WITHOUT an explicit lister, skip the prefilter so hermetic tests keep
  // their exact semantics (their probe already answers exists:false for free).
  const listBranches =
    opts.listBranches ?? (opts.probe ? undefined : () => makeBranchGcRunner(project).listEpicBranches());
  const missions = listMissions(project).filter((m) => m.mission.status === 'converged' || m.mission.status === 'closed');
  const todos = listTodos(project, { includeCompleted: true });

  const missionEpicIds = new Set<string>();
  for (const m of missions) {
    for (const t of todos) {
      if (t.parentId === m.node.id && t.status !== 'dropped' && isEpic(t)) {
        missionEpicIds.add(t.id);
      }
    }
  }

  const report = await buildEpicBranchStatus(todos, probe, baseRef, project, listBranches);
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
    const known = {
      exists: branchStatus.exists,
      ahead: branchStatus.ahead,
      behind: branchStatus.behind,
      mergeable: branchStatus.mergeable,
      newCount: branchStatus.newCount,
    };
    const { stamped } = await stampEpicLandedAtGated(project, epic.id, epic.landedAt, { probe, baseRef, known });
    if (!stamped) {
      skipped++;
      continue;
    }
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
  revParse(branch: string): Promise<string | null>;
  /** Force-delete `branch` (git branch -D). Returns true on success. */
  deleteBranch(branch: string): Promise<boolean>;
  /** All local `collab/epic/<id8>` branch names (short refs) — including ORPHANS whose epic
   *  todo no longer exists, which buildEpicBranchStatus (built from live todos) cannot see. */
  listEpicBranches(): Promise<string[]>;
  /** Commits on `branch` not on `baseRef` (git rev-list --count baseRef..branch). Returns -1 on
   *  error so the caller treats it as ahead>0 and never deletes speculatively (fail-closed). */
  aheadCount(branch: string, baseRef: string): Promise<number>;
  /** Commits on `branch` with no patch-equivalent on baseRef (--cherry-pick --right-only).
   *  Returns -1 on error (fail-closed, never deletes). Optional (older/injected runners may omit it). */
  newCount?(branch: string, baseRef: string): Promise<number>;
  /** Remove the worktree holding `branch` (if any) so `git branch -D` can then delete it — a
   *  fully-on-master epic's post-land worktree is stale cruft. Uses `git worktree remove` WITHOUT
   *  --force, so a worktree with uncommitted changes (an active build) is preserved and its branch
   *  stays undeleted. Optional (older/injected runners may omit it). */
  pruneWorktreeFor?(branch: string): Promise<void>;
}

export interface GcEpicBranchesResult {
  /** Branches deleted this pass (branch name, not epic id). */
  deleted: string[];
  /** Epic ids whose branch is ahead>0 and was left intact for human review. */
  flagged: string[];
  /** Epics inspected but with no branch to act on (missing/already gone). */
  skipped: number;
}

/** Hard cap on any single GC git op. */
const GC_GIT_TIMEOUT_MS = 10_000;

/** Run git in `cwd` ASYNC, returning { code, stdout }. Never throws; never hangs
 *  (timeout kill). Async spawn (Bun.spawn + await exited) — never spawnSync, which
 *  would pin the sidecar event loop for the git call's full duration inside the
 *  sweep loop. */
async function runGitLocal(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'ignore' });
    const killTimer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, GC_GIT_TIMEOUT_MS);
    try {
      const [stdout, code] = await Promise.all([
        p.stdout ? new Response(p.stdout).text() : Promise.resolve(''),
        p.exited,
      ]);
      return { code: code ?? 1, stdout };
    } finally {
      clearTimeout(killTimer);
    }
  } catch {
    return { code: 1, stdout: '' };
  }
}

export function makeBranchGcRunner(project: string): BranchGcRunner {
  return {
    async revParse(branch: string): Promise<string | null> {
      const r = await runGitLocal(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      const sha = r.stdout.trim();
      return r.code === 0 && sha ? sha : null;
    },
    async deleteBranch(branch: string): Promise<boolean> {
      return (await runGitLocal(project, ['branch', '-D', branch])).code === 0;
    },
    async listEpicBranches(): Promise<string[]> {
      const r = await runGitLocal(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/collab/epic']);
      return r.code === 0 ? r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    },
    async aheadCount(branch: string, baseRef: string): Promise<number> {
      const r = await runGitLocal(project, ['rev-list', '--count', `${baseRef}..${branch}`]);
      const n = Number(r.stdout.trim());
      return r.code === 0 && Number.isFinite(n) ? n : -1; // -1 → fail-closed (treat as ahead, never delete)
    },
    async newCount(branch: string, baseRef: string): Promise<number> {
      const r = await runGitLocal(project, ['rev-list', '--count', '--cherry-pick', '--right-only', `${baseRef}...${branch}`]);
      const n = Number(r.stdout.trim());
      return r.code === 0 && Number.isFinite(n) ? n : -1; // -1 → fail-closed (treat as ahead, never delete)
    },
    async pruneWorktreeFor(branch: string): Promise<void> {
      const r = await runGitLocal(project, ['worktree', 'list', '--porcelain']);
      if (r.code !== 0) return;
      let wtPath = '';
      for (const line of r.stdout.split('\n')) {
        if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim();
        else if (line.trim() === `branch refs/heads/${branch}` && wtPath) {
          await runGitLocal(project, ['worktree', 'remove', wtPath]); // no --force → refuses if dirty (fail-safe)
          return;
        }
      }
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
export async function gcEpicBranches(
  project: string,
  opts: { probe?: GitProbe; runner?: BranchGcRunner; baseRef?: string; now?: () => string; listBranches?: BranchLister; rescue?: (branch: string) => Promise<unknown> } = {},
): Promise<GcEpicBranchesResult> {
  const probe = opts.probe ?? makeGitProbe(project);
  const runner = opts.runner ?? makeBranchGcRunner(project);
  const baseRef = opts.baseRef ?? 'master';
  const now = opts.now ?? (() => new Date().toISOString());
  const rescue = opts.rescue ?? ((branch: string) => rescueOrphanedLeafCommitsForBranch(project, branch, { baseRef }));

  // Same prefilter rule as reconcileLandedEpics: with the REAL probe, enumerate
  // collab/epic/* once (via the runner, one spawn) so per-epic probing is bounded by
  // real branch count, not todo count. Injected-probe tests keep exact old semantics.
  const listBranches = opts.listBranches ?? (opts.probe ? undefined : () => runner.listEpicBranches());

  const todos = listTodos(project, { includeCompleted: true });
  const report = await buildEpicBranchStatus(todos, probe, baseRef, project, listBranches);

  const deleted: string[] = [];
  const flagged: string[] = [];
  let skipped = 0;

  const handled = new Set<string>();
  for (const e of report.epics) {
    handled.add(e.branch);
    if (!e.exists) { skipped++; continue; }
    // LIVE-EPIC GUARD: a non-terminal epic's branch is NEVER GC'd, no matter how
    // "fully-on-master" it looks. A brand-new epic branch forked from master is
    // ahead===0 by definition until its first accepted merge, and an optimistically
    // landed epic (landedAt set, children still building) returns to ahead===0
    // between merges — deleting either yanks the base out from under in-flight
    // leaves (worktree add fails "invalid reference", burning attempts toward the
    // re-dispatch cap; observed 2026-07-22: c72e635c deleted twice mid-build,
    // 48a3cc6e with two leaves in flight, 234f0021 four times).
    if (e.status !== 'done' && e.status !== 'dropped') { skipped++; continue; }
    if (effectiveNewCount(e) > 0) { flagged.push(e.epicId); continue; }
    const tip = await runner.revParse(e.branch);
    if (tip == null) { skipped++; continue; }
    await runner.pruneWorktreeFor?.(e.branch); // remove a stale post-land worktree so the delete can succeed
    await rescue(e.branch).catch(() => undefined);
    if (await runner.deleteBranch(e.branch)) {
      appendRecoveryLog(project, e.branch, tip, now());
      deleted.push(e.branch);
    } else {
      skipped++;
    }
  }

  // ORPHAN branches: `collab/epic/<id8>` refs whose epic todo no longer exists are absent from
  // report.epics (built from live todos), so the loop above structurally cannot reach them — this is
  // exactly the gap that left fully-on-master orphan branches accumulating. Enumerate ALL collab/epic
  // refs directly and GC the orphans by the SAME fail-closed rule: delete only when git proves the
  // branch fully-on-master (newCount===0, fallback to ahead===0), flag newCount>0 (or error) for
  // review, and capture every deleted tip to the recovery log. `flagged` carries the branch name for
  // orphans (they have no epic id).
  for (const branch of await runner.listEpicBranches()) {
    if (handled.has(branch)) continue; // already processed via its live epic todo above
    const n = runner.newCount ? await runner.newCount(branch, baseRef) : await runner.aheadCount(branch, baseRef);
    if (n !== 0) { flagged.push(branch); continue; } // newCount>0 (or ahead>0, or error -1) → keep (fail-closed)
    const tip = await runner.revParse(branch);
    if (tip == null) { skipped++; continue; }
    await runner.pruneWorktreeFor?.(branch); // remove a stale post-land worktree so the delete can succeed
    await rescue(branch).catch(() => undefined);
    if (await runner.deleteBranch(branch)) {
      appendRecoveryLog(project, branch, tip, now());
      deleted.push(branch);
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
 *
 * Event-loop-hold bound (crit-5): every git call is an ASYNC bounded spawn (never
 * spawnSync — pins the sidecar event loop), and both sweep halves additionally
 * prefilter probes to existing collab/epic/* branches, so each pass is O(real
 * branches) spawns (~6 today), not O(epic todos) (~211 → ~500+ spawns → the >45s
 * watchdog kill of 2026-07-22).
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
  const gc = await gcEpicBranches(project, { probe: opts.probe, runner: opts.runner, baseRef: opts.baseRef });

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
