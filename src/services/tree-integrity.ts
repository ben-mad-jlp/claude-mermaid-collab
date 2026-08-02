/**
 * Tree integrity checking and recovery for post-land corruption.
 *
 * When landEpicToMaster advances the master ref via git update-ref on a checked-out
 * branch, the ref moves but the working tree and index do not. This leaves a corrupted
 * checkout where HEAD points to the new commit but files on disk are stale.
 *
 * These functions are async-only (Bun.spawn, not spawnSync) because both call sites are
 * async contexts: landEpic (async handler) and requestSelfDeploy (sidecar async MCP
 * dispatcher + async route handler). The sync spawn blocked the event loop under the
 * 45s Electron liveness watchdog, causing kill-loops (bug 944408c2, 2026-07-24 09:08).
 */

async function git(
  cwd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ code: number; out: string; err: string }> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } }, 10_000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code: code ?? 1, out: (stdout ?? '').trim(), err: (stderr ?? '').trim() };
    } finally {
      clearTimeout(killTimer);
    }
  } catch (e) {
    return { code: 1, out: '', err: String(e) };
  }
}

export interface TreeStatus {
  /** false when git failed / not a repo — callers must treat this as "cannot assert", not "ok". */
  resolved: boolean;
  headTree: string;   // git rev-parse HEAD^{tree}
  workTree: string;   // git write-tree  (the INDEX's tree)
  match: boolean;     // resolved && headTree === workTree
}

/** Compare the checkout's index tree against HEAD's tree. Pure read. Never throws. */
export async function treeStatus(repoRoot: string): Promise<TreeStatus> {
  const headResult = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const workResult = await git(repoRoot, ['write-tree']);

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
export async function divergentTrackedFiles(repoRoot: string): Promise<DivergenceReport> {
  const result = await git(repoRoot, ['diff', '--name-only', 'HEAD']);
  if (result.code !== 0) {
    return { resolved: false, files: [] };
  }
  const files = result.out.split('\n').map((s) => s.trim()).filter(Boolean);
  return { resolved: true, files };
}

/** Get the currently-checked-out branch name. Returns null on failure or detached HEAD. */
export async function currentHeadBranch(repoRoot: string): Promise<string | null> {
  const result = await git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (result.code !== 0) {
    return null;
  }
  return result.out || null;
}

/** Get the set of tracked files with uncommitted changes (index or worktree). */
async function trackedDirtyPaths(repoRoot: string): Promise<string[]> {
  const result = await git(repoRoot, ['status', '--porcelain', '--untracked-files=no']);
  if (result.code !== 0) return [];
  const lines = result.out.split('\n').filter(Boolean);
  return lines.map((line) => line.slice(3).trim()); // Skip the 2-char status + space prefix
}

/** Compute the set of paths touched by a land (git diff --name-only oldBaseSha..landSha). */
async function diffPaths(
  repoRoot: string,
  oldBaseSha: string,
  landSha: string,
): Promise<string[]> {
  const result = await git(repoRoot, ['diff', '--name-only', `${oldBaseSha}..${landSha}`]);
  if (result.code !== 0) return [];
  return result.out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Get the blob hash for a path in a commit (resolved via git rev-parse). */
async function getBlobAtRef(repoRoot: string, ref: string, path: string): Promise<string | null> {
  const result = await git(repoRoot, ['rev-parse', `${ref}:${path}`]);
  if (result.code !== 0) return null;
  return result.out || null;
}

/** Get the blob hash of a path in the index (stage 0). */
async function getBlobInIndex(repoRoot: string, path: string): Promise<string | null> {
  const result = await git(repoRoot, ['rev-parse', `:${path}`]);
  if (result.code !== 0) return null;
  return result.out || null;
}

/** Get the blob hash of a path in the worktree (via git hash-object). */
async function getBlobInWorktree(repoRoot: string, path: string): Promise<string | null> {
  const result = await git(repoRoot, ['hash-object', path]);
  if (result.code !== 0) return null;
  return result.out || null;
}

/**
 * Compute the subset of trackedDirty paths that are PROVABLE pure reverts.
 *
 * A path is a pure revert iff:
 *  1. It was touched by the land (in landedSet = diff oldBaseSha..landSha)
 *  2. Both the index and worktree now match the blob at oldBaseSha (the pre-land state)
 *
 * Any resolution failure (path added by the land so absent at oldBaseSha; or deleted
 * in the worktree) excludes that path — conservative by construction, never a false-positive.
 */
export async function landedRevertPaths(
  repoRoot: string,
  opts: { landSha: string; baseSha: string; trackedDirty: string[] },
): Promise<string[]> {
  // Compute the set of paths touched by the land.
  const landedSet = new Set(await diffPaths(repoRoot, opts.baseSha, opts.landSha));

  const reverted: string[] = [];
  for (const path of opts.trackedDirty) {
    // Only consider paths the land touched.
    if (!landedSet.has(path)) continue;

    // Resolve the base blob (pre-land).
    const baseBlob = await getBlobAtRef(repoRoot, opts.baseSha, path);
    if (!baseBlob) continue; // Path added by the land or git error — exclude.

    // Resolve index blob.
    const indexBlob = await getBlobInIndex(repoRoot, path);
    if (!indexBlob || indexBlob !== baseBlob) continue; // Index changed or error — exclude.

    // Resolve worktree blob.
    const wtBlob = await getBlobInWorktree(repoRoot, path);
    if (!wtBlob || wtBlob !== baseBlob) continue; // Worktree changed or error — exclude.

    // All three match: this is a pure revert (index AND worktree both equal base blob).
    reverted.push(path);
  }
  return reverted;
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
  /** Paths that were restored via the narrow revert-repair (revertPathsRestored). */
  revertPathsRestored: string[];
}

/** Single decision point for post-land tree restoration. Guards against unsafe resets
 *  by checking (1) whether there is tracked-dirty work, and (2) whether HEAD is on the
 *  base ref. Only resets when both are safe (no tracked dirty AND on baseRef).
 *  When mismatch exists, dirty work is present, and baseSha is provided, attempt a
 *  narrower repair: restore ONLY the proven-revert subset of dirty paths, leaving
 *  unrelated dirty files untouched.
 *  Otherwise marks the outcome as skippedUnsafe and returns without modifying the tree. */
export async function guardPostLandTree(
  repoRoot: string,
  opts: {
    masterSha?: string;
    baseRef?: string;
    baseSha?: string;
    trackedDirty: string[];
  },
): Promise<PostLandGuardResult> {
  const onBaseRef = !!opts.baseRef && (await currentHeadBranch(repoRoot)) === opts.baseRef;
  const before = await treeStatus(repoRoot);
  const mismatch = before.resolved && !before.match;
  const divergentFiles = (await divergentTrackedFiles(repoRoot)).files;

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
      revertPathsRestored: [],
    };
  }

  // Mismatch exists. Try narrow repair if we have baseSha and dirty work present.
  const hasDirtyWork = opts.trackedDirty.length > 0;
  if (mismatch && hasDirtyWork && opts.baseSha && onBaseRef) {
    // Narrow-repair path: compute proven-revert subset and restore only those.
    const revertPaths = await landedRevertPaths(repoRoot, {
      landSha: opts.masterSha,
      baseSha: opts.baseSha,
      trackedDirty: opts.trackedDirty,
    });

    if (revertPaths.length > 0) {
      // Found proven reverts. Snapshot first, then restore only those paths.
      let snapshotRef: string | null = null;
      if (before.resolved) {
        const snapshotCommitResult = await git(
          repoRoot,
          ['commit-tree', before.workTree, '-p', 'HEAD', '-m', 'snapshot: pre-narrow-restore tree'],
          {
            GIT_AUTHOR_NAME: 'mermaid-collab',
            GIT_AUTHOR_EMAIL: 'collab@localhost',
            GIT_COMMITTER_NAME: 'mermaid-collab',
            GIT_COMMITTER_EMAIL: 'collab@localhost',
          },
        );

        if (snapshotCommitResult.code === 0) {
          const snapshotSha = snapshotCommitResult.out;
          snapshotRef = `refs/snapshots/pre-restore-${Date.now()}`;
          const updateRefResult = await git(repoRoot, ['update-ref', snapshotRef, snapshotSha]);
          if (updateRefResult.code !== 0) {
            // Snapshot failed — abort repair, keep skippedUnsafe: true.
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
              revertPathsRestored: [],
            };
          }
        } else {
          // Snapshot creation failed — abort repair.
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
            revertPathsRestored: [],
          };
        }
      }

      // Restore exactly the proven-revert paths from landSha.
      const restoreRes = await git(
        repoRoot,
        ['restore', '--source', opts.masterSha, '--staged', '--worktree', '--', ...revertPaths],
      );

      if (restoreRes.code === 0) {
        // Re-read tracked-dirty state.
        const nowDirty = await trackedDirtyPaths(repoRoot);

        if (nowDirty.length === 0) {
          // No more tracked-dirty files — repair succeeded.
          const after = await treeStatus(repoRoot);
          return {
            onBaseRef,
            trackedDirtyCount: 0,
            mismatch, // Mismatch is whether there WAS a mismatch before repair (always true here).
            restored: true, // Narrow repair via git restore succeeded; tree is now restored.
            skippedUnsafe: false,
            snapshotRef,
            before,
            after,
            divergentFiles,
            revertPathsRestored: revertPaths,
          };
        } else {
          // Residual dirty work remains outside the revert set — report partially restored.
          const after = await treeStatus(repoRoot);
          return {
            onBaseRef,
            trackedDirtyCount: nowDirty.length,
            mismatch, // Mismatch is whether there WAS a mismatch before repair (always true here).
            restored: false,
            skippedUnsafe: true, // Still unsafe due to residual dirty work.
            snapshotRef,
            before,
            after,
            divergentFiles,
            revertPathsRestored: revertPaths,
          };
        }
      }
      // restore command failed — abort and return skippedUnsafe.
      return {
        onBaseRef,
        trackedDirtyCount: opts.trackedDirty.length,
        mismatch,
        restored: false,
        skippedUnsafe: true,
        snapshotRef,
        before,
        after: before,
        divergentFiles,
        revertPathsRestored: [],
      };
    }
    // No proven reverts — fall through to the unsafe path below.
  }

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
      revertPathsRestored: [],
    };
  }

  // Safe: no tracked dirty, on base ref, and mismatch exists. Restore now.
  const rep = await restorePostLandTree(repoRoot, opts.masterSha);
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
    revertPathsRestored: [],
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
export async function restorePostLandTree(
  repoRoot: string,
  landSha: string,
  nowMs: number = Date.now(),
): Promise<{ restored: boolean; snapshotRef: string | null; before: TreeStatus; after: TreeStatus }> {
  const before = await treeStatus(repoRoot);

  // Snapshot first, unconditionally, before any mutation.
  let snapshotRef: string | null = null;
  if (before.resolved) {
    const snapshotCommitResult = await git(
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
      const updateRefResult = await git(repoRoot, ['update-ref', snapshotRef, snapshotSha]);
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
  const resetResult = await git(repoRoot, ['reset', '--hard', landSha]);
  const restored = resetResult.code === 0;

  const after = await treeStatus(repoRoot);

  return { restored, snapshotRef, before, after };
}

// P0-fix proof-land marker (0949289b verified live v6.17.9) — safe to remove.
