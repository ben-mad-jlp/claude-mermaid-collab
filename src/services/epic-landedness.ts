/**
 * Canonical API for distinct landed-ness notions.
 *
 * INTENT STAMP: `epic.landedAt` — a land path stamped intent to land.
 * GIT-REACHED-MASTER: a merge sha in the land record — durable, RECORD-BACKED proof the
 *   epic's tip reached master (`hasGitReachedMaster`, unchanged by this module).
 * GIT-REACHED-TRUNK: `git log --grep=Collab-Epic` on the detected trunk branch — a durable,
 *   GIT-BACKED probe (`isEpicLandedInGit`) that proves reachability WITHOUT the land record,
 *   so it can still detect a real land even when the record write was skipped.
 * REACHABILITY: descendant work audit — all accepted code leaves carry committed trailers reachable from the epic branch.
 *
 * These notions disagree in real states: a stamp without a merge (land started, then failed),
 * a merge without a status (completed by direct commit), landed-but-stranded work (a leaf
 * committed elsewhere), or a real trunk merge whose land record was never written (git says
 * landed, the record says not). They must NEVER be collapsed into one boolean — each has
 * distinct call sites and implications.
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

/** Result of a git-only trunk-reachability probe. */
export type GitLandStatus = 'landed' | 'not-landed' | 'indeterminate';

/** Runs git in `cwd` with `args`, returning its exit code and stdout. Injectable for tests. */
export interface GitRunner {
  (cwd: string, args: string[]): Promise<{ code: number; stdout: string }>;
}

/** Hard cap on any single git probe. */
const GIT_PROBE_TIMEOUT_MS = 15_000;

/** Default async GitRunner: Bun.spawn + await exited, never spawnSync (would block the
 *  sidecar event loop), never throws (probe failures resolve to a non-zero code). */
async function defaultRunGit(cwd: string, gitArgs: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const p = Bun.spawn(['git', ...gitArgs], {
      cwd,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const killTimer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, GIT_PROBE_TIMEOUT_MS);
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

/**
 * Detect the repo's trunk branch: the current HEAD's symbolic ref name, falling back to
 * the raw commit sha on a detached/bare HEAD. Sibling implementation to
 * `WorktreeManager.detectBaseBranch` (src/agent/worktree-manager.ts:2465) — that one lives
 * on the class and isn't reusable here without constructing a WorktreeManager, so this is a
 * module-local mirror rather than an import.
 */
export async function detectTrunkBranch(projectRoot: string, runGit: GitRunner = defaultRunGit): Promise<string> {
  const sym = await runGit(projectRoot, ['symbolic-ref', '--short', 'HEAD']).catch(() => ({ code: 1, stdout: '' }));
  if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim();
  const rev = await runGit(projectRoot, ['rev-parse', 'HEAD']);
  return rev.stdout.trim();
}

/**
 * Git-only probe: has a commit carrying `Collab-Epic: <epicId>` reached the detected trunk?
 *
 * Deliberately independent of the durable land record (see `hasGitReachedMaster`) — it can
 * prove reachability even when the record write was skipped. Never reads `todo.landedAt` and
 * never calls `getEpicLandRecord`. Never throws.
 */
export async function isEpicLandedInGit(
  project: string,
  epicId: string,
  deps?: { runGit?: GitRunner; trunk?: string },
): Promise<GitLandStatus> {
  try {
    const runGit = deps?.runGit ?? defaultRunGit;
    const trunk = deps?.trunk ?? (await detectTrunkBranch(project, runGit).catch(() => undefined));
    if (!trunk) return 'indeterminate';
    const res = await runGit(project, ['log', trunk, `--grep=Collab-Epic: ${epicId}`, '--format=%H', '-1']).catch(() => null);
    if (res === null) return 'indeterminate';
    if (res.code !== 0) return 'indeterminate';
    return res.stdout.trim().length > 0 ? 'landed' : 'not-landed';
  } catch {
    return 'indeterminate';
  }
}

export interface EpicLandCommit {
  status: GitLandStatus;
  sha: string | null;
  committedAtIso: string | null;
}

export async function getEpicLandCommit(
  project: string,
  epicId: string,
  deps?: { runGit?: GitRunner; trunk?: string },
): Promise<EpicLandCommit> {
  try {
    const runGit = deps?.runGit ?? defaultRunGit;
    const trunk = deps?.trunk ?? (await detectTrunkBranch(project, runGit).catch(() => undefined));
    if (!trunk) return { status: 'indeterminate', sha: null, committedAtIso: null };
    const res = await runGit(project, ['log', trunk, `--grep=Collab-Epic: ${epicId}`, '--format=%H%x09%cI', '-1']).catch(() => null);
    if (res === null) return { status: 'indeterminate', sha: null, committedAtIso: null };
    if (res.code !== 0) return { status: 'indeterminate', sha: null, committedAtIso: null };
    const trimmed = res.stdout.trim();
    if (trimmed.length === 0) return { status: 'not-landed', sha: null, committedAtIso: null };
    const parts = trimmed.split('\x09');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return { status: 'indeterminate', sha: null, committedAtIso: null };
    return { status: 'landed', sha: parts[0], committedAtIso: parts[1] };
  } catch {
    return { status: 'indeterminate', sha: null, committedAtIso: null };
  }
}

// Re-export LandFinding for use in EpicWorkReachability interface.
export type { LandFinding } from './epic-land-readiness.js';
