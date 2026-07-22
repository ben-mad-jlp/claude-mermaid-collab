/**
 * Tree integrity checking and recovery for post-land corruption.
 *
 * When landEpicToMaster advances the master ref via git update-ref on a checked-out
 * branch, the ref moves but the working tree and index do not. This leaves a corrupted
 * checkout where HEAD points to the new commit but files on disk are stale.
 *
 * These functions use spawnSync (not Bun.spawn) so they work synchronously in both
 * async contexts (landEpic) and sync contexts (requestSelfDeploy).
 */
import { spawnSync } from 'node:child_process';

function git(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): { code: number; out: string; err: string } {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export interface TreeStatus {
  /** false when git failed / not a repo — callers must treat this as "cannot assert", not "ok". */
  resolved: boolean;
  headTree: string;   // git rev-parse HEAD^{tree}
  workTree: string;   // git write-tree  (the INDEX's tree)
  match: boolean;     // resolved && headTree === workTree
}

/** Compare the checkout's index tree against HEAD's tree. Pure read. Never throws. */
export function treeStatus(repoRoot: string): TreeStatus {
  const headResult = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const workResult = git(repoRoot, ['write-tree']);

  if (headResult.code !== 0 || workResult.code !== 0) {
    return { resolved: false, headTree: '', workTree: '', match: false };
  }

  const headTree = headResult.out;
  const workTree = workResult.out;
  return {
    resolved: true,
    headTree,
    workTree,
    match: headTree === workTree,
  };
}

export interface DivergenceReport {
  /** false when git failed / not a repo — callers must treat this as "cannot assert". */
  resolved: boolean;
  files: string[];
}

/** Named, forensic superset of treeStatus's boolean `match`: which tracked files diverge
 *  between the worktree/index and HEAD. Pure read (`git diff --name-only HEAD`). Never throws. */
export function divergentTrackedFiles(repoRoot: string): DivergenceReport {
  const result = git(repoRoot, ['diff', '--name-only', 'HEAD']);
  if (result.code !== 0) {
    return { resolved: false, files: [] };
  }
  const files = result.out.split('\n').map((s) => s.trim()).filter(Boolean);
  return { resolved: true, files };
}

/** Get the currently-checked-out branch name. Returns null on failure or detached HEAD. */
export function currentHeadBranch(repoRoot: string): string | null {
  const result = git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (result.code !== 0) {
    return null;
  }
  return result.out || null;
}

export interface PostLandGuardResult {
  /** The checkout is on the baseRef (if baseRef was provided). */
  onBaseRef: boolean;
  /** Number of tracked files with uncommitted changes. */
  trackedDirtyCount: number;
  /** Tree mismatch detected (index tree !== HEAD^{tree}). */
  mismatch: boolean;
  /** Tree was restored to landSha via reset --hard. */
  restored: boolean;
  /** Restoration was skipped (unsafe to reset due to dirty work or off-base-ref branch). */
  skippedUnsafe: boolean;
  /** Snapshot commit ref if created (only set when restored === true). */
  snapshotRef: string | null;
  /** Tree status before restoration attempt. */
  before: TreeStatus;
  /** Tree status after restoration (or noop state if skipped). */
  after: TreeStatus;
  /** Tracked files that diverged between worktree/index and HEAD. */
  divergentFiles: string[];
}

/** Single decision point for post-land tree restoration. Guards against unsafe resets
 *  by checking (1) whether there is tracked-dirty work, and (2) whether HEAD is on the
 *  base ref. Only resets when both are safe (no tracked dirty AND on baseRef).
 *  Otherwise marks the outcome as skippedUnsafe and returns without modifying the tree. */
export function guardPostLandTree(
  repoRoot: string,
  opts: {
    masterSha?: string;
    baseRef?: string;
    trackedDirty: string[];
  },
): PostLandGuardResult {
  const onBaseRef = !!opts.baseRef && currentHeadBranch(repoRoot) === opts.baseRef;
  const before = treeStatus(repoRoot);
  const mismatch = before.resolved && !before.match;
  const divergentFiles = divergentTrackedFiles(repoRoot).files;

  // No masterSha or no mismatch — nothing to restore.
  if (!opts.masterSha || !mismatch) {
    return {
      onBaseRef,
      trackedDirtyCount: opts.trackedDirty.length,
      mismatch,
      restored: false,
      skippedUnsafe: false,
      snapshotRef: null,
      before,
      after: before,
      divergentFiles,
    };
  }

  // Mismatch exists. Check if safe to restore.
  const hasDirtyWork = opts.trackedDirty.length > 0;
  if (hasDirtyWork || !onBaseRef) {
    // Unsafe: either tracked dirty work present or not on base ref. Skip restoration.
    return {
      onBaseRef,
      trackedDirtyCount: opts.trackedDirty.length,
      mismatch,
      restored: false,
      skippedUnsafe: true,
      snapshotRef: null,
      before,
      after: before,
      divergentFiles,
    };
  }

  // Safe: no tracked dirty, on base ref, and mismatch exists. Restore now.
  const rep = restorePostLandTree(repoRoot, opts.masterSha);
  return {
    onBaseRef,
    trackedDirtyCount: opts.trackedDirty.length,
    mismatch,
    restored: rep.restored && rep.after.match,
    skippedUnsafe: false,
    snapshotRef: rep.snapshotRef,
    before: rep.before,
    after: rep.after,
    divergentFiles,
  };
}

/**
 * The post-land repair. ONLY call when the tree was known-clean before the land
 * (otherwise `reset --hard` destroys real uncommitted work).
 *   1. snapshot: commit-tree <workTree> -p HEAD -m 'snapshot: corrupted post-land tree'
 *                update-ref refs/snapshots/pre-restore-<epochMs> <sha>
 *   2. restore:  reset --hard <landSha>          // never past the land commit
 *   3. re-assert treeStatus()
 */
export function restorePostLandTree(
  repoRoot: string,
  landSha: string,
  nowMs: number = Date.now(),
): { restored: boolean; snapshotRef: string | null; before: TreeStatus; after: TreeStatus } {
  const before = treeStatus(repoRoot);

  // Snapshot first, unconditionally, before any mutation.
  let snapshotRef: string | null = null;
  if (before.resolved) {
    const snapshotCommitResult = git(
      repoRoot,
      ['commit-tree', before.workTree, '-p', 'HEAD', '-m', 'snapshot: corrupted post-land tree'],
      {
        GIT_AUTHOR_NAME: 'mermaid-collab',
        GIT_AUTHOR_EMAIL: 'collab@localhost',
        GIT_COMMITTER_NAME: 'mermaid-collab',
        GIT_COMMITTER_EMAIL: 'collab@localhost',
      },
    );

    if (snapshotCommitResult.code === 0) {
      const snapshotSha = snapshotCommitResult.out;
      snapshotRef = `refs/snapshots/pre-restore-${nowMs}`;
      const updateRefResult = git(repoRoot, ['update-ref', snapshotRef, snapshotSha]);
      if (updateRefResult.code !== 0) {
        // If update-ref fails, forensic evidence outranks the repair (WRONG FIX #4).
        // Do not reset — return failure.
        return {
          restored: false,
          snapshotRef: null,
          before,
          after: { resolved: false, headTree: '', workTree: '', match: false },
        };
      }
    } else {
      // If commit-tree fails, do not reset — forensic evidence outranks the repair.
      return {
        restored: false,
        snapshotRef: null,
        before,
        after: { resolved: false, headTree: '', workTree: '', match: false },
      };
    }
  }

  // Reset with exactly ['reset', '--hard', landSha]. No 'clean', no 'checkout .'.
  const resetResult = git(repoRoot, ['reset', '--hard', landSha]);
  const restored = resetResult.code === 0;

  const after = treeStatus(repoRoot);

  return { restored, snapshotRef, before, after };
}

// P0-fix proof-land marker (0949289b verified live v6.17.9) — safe to remove.
