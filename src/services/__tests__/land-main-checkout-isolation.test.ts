/**
 * Tests for land/forward-integrate never resetting the main checkout.
 *
 * Three scenarios:
 * 1. guardPostLandTree: unsafe-skip when checked out on non-base branch with uncommitted work
 * 2. guardPostLandTree: safe-restore when on-base-ref, no tracked dirty, real mismatch
 * 3. Wire-through: landEpicToMaster throws MainCheckoutBranchChangedError when branch flips mid-operation
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-isolation-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { guardPostLandTree, currentHeadBranch } from '../tree-integrity';
import { WorktreeManager, type LandResult } from '../../agent/worktree-manager';
import { MainCheckoutBranchChangedError } from '../main-checkout-invariant';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

beforeAll(() => {});
afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land-main-checkout-isolation — guardPostLandTree + MainCheckoutInvariant', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const epicId = 'land-isolation-epic';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-isolation-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(repo, '.collab', 'agent-sessions', 'worktrees'),
      persistDir: join(repo, '.collab', 'agent-sessions'),
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('guardPostLandTree: unsafe-skip when checked out on non-base branch with uncommitted tracked edit', async () => {
    // Create a side branch (not master).
    await runGit(repo, ['checkout', '-q', '-b', 'feature/my-work']);
    writeFileSync(join(repo, 'feature.txt'), 'feature work\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'feature work']);
    const featureSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;

    // Back to master to land something.
    await runGit(repo, ['checkout', '-q', 'master']);

    // Create and land an epic (this advances master).
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'epic-file.txt'), 'epic output\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit']);
    const landRes = await mgr.landEpicToMaster(epicId);
    expect(landRes.landed).toBe(true);
    const landedMasterSha = landRes.masterSha!;
    const preLandSha = (await runGit(repo, ['rev-parse', 'master~1'])).stdout;

    // Now switch to the feature branch (off master).
    await runGit(repo, ['checkout', '-q', 'feature/my-work']);

    // Introduce uncommitted tracked edit.
    writeFileSync(join(repo, 'base.txt'), 'base-modified-on-feature\n');
    await runGit(repo, ['add', 'base.txt']);

    // Create an intentional tree mismatch by resetting index/tree to pre-land but keeping HEAD at feature.
    await runGit(repo, ['reset', '--hard', preLandSha]); // index + tree -> pre-land
    await runGit(repo, ['reset', '--soft', featureSha]);  // HEAD -> feature commit, tree stays stale

    // Verify preconditions.
    const currentBranch = currentHeadBranch(repo);
    expect(currentBranch).toBe('feature/my-work');
    const trackedDirtyRes = (await runGit(repo, ['diff', '--name-only', 'HEAD'])).stdout.split('\n').filter(Boolean);
    expect(trackedDirtyRes.length).toBeGreaterThan(0); // Has uncommitted changes between index and HEAD

    // Call guardPostLandTree with baseRef=master (which we're NOT on).
    const guard = guardPostLandTree(repo, {
      masterSha: landedMasterSha,
      baseRef: 'master',
      trackedDirty: trackedDirtyRes,
    });

    // Assertions: should skip-unsafe.
    expect(guard.onBaseRef).toBe(false); // Not on master
    expect(guard.mismatch).toBe(true);   // Tree is mismatched
    expect(guard.trackedDirtyCount).toBeGreaterThan(0); // Has tracked dirty
    expect(guard.skippedUnsafe).toBe(true); // Marked unsafe skip
    expect(guard.restored).toBe(false);  // Not restored
    expect(guard.snapshotRef).toBeNull(); // No snapshot created

    // Verify the branch is still feature/my-work.
    expect(currentHeadBranch(repo)).toBe('feature/my-work');
  });

  it('guardPostLandTree: safe-restore when on-base-ref, no tracked dirty, real mismatch', async () => {
    // Create and land an epic (advances master).
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'epic-added.txt'), 'added by epic\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic']);

    // Capture pre-land state.
    const preLandSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;
    const landRes = await mgr.landEpicToMaster(epicId);
    expect(landRes.landed).toBe(true);
    const landedSha = landRes.masterSha!;

    // Manually corrupt the tree: index+working-tree back to pre-land, HEAD stays at land commit.
    // This reproduces the post-land corruption that can happen if the land ref-update
    // succeeds but the source tree sync is skipped for some reason.
    await runGit(repo, ['reset', '--hard', preLandSha]);  // index+tree -> pre-land
    await runGit(repo, ['reset', '--soft', landedSha]);   // HEAD -> land commit, tree stays stale

    // Verify preconditions: on master, tree is mismatched (index stale vs HEAD).
    const currentBranch = currentHeadBranch(repo);
    expect(currentBranch).toBe('master');

    // Call guardPostLandTree.
    const guard = guardPostLandTree(repo, {
      masterSha: landedSha,
      baseRef: 'master',
      trackedDirty: [],
    });

    // Assertions: should restore safely.
    expect(guard.onBaseRef).toBe(true);  // On master
    expect(guard.mismatch).toBe(true);   // Tree was mismatched (workTree != HEAD^{tree})
    expect(guard.trackedDirtyCount).toBe(0); // No tracked dirty
    expect(guard.skippedUnsafe).toBe(false); // Safe to restore
    expect(guard.restored).toBe(true);   // Tree was restored
    expect(guard.snapshotRef).toBeTruthy(); // Snapshot created
    expect(guard.after.match).toBe(true); // Tree now matches after restoration

    // Verify the file added by the epic is now on disk.
    const { code } = await runGit(repo, ['show', 'HEAD:epic-added.txt']);
    expect(code).toBe(0); // File exists at HEAD
  });

  it('landEpicToMaster throws MainCheckoutBranchChangedError when branch flips mid-operation', async () => {
    // Create an epic to land.
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'feature.txt'), 'feature\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'feature']);

    // Monkey-patch the manager's mainCheckoutGit to flip branch mid-operation.
    // We'll intercept a symbolic-ref call and flip the branch in the main repo.
    let callCount = 0;
    const originalMainCheckoutGit = mgr['mainCheckoutGit'] as any;
    (mgr as any)['mainCheckoutGit'] = async (cwd: string, args: string[]) => {
      callCount++;
      // On the 3rd call (roughly mid-operation), flip to a different branch.
      if (callCount === 3 && args[0] === 'symbolic-ref' && args[1] === '--short') {
        // Inject a branch flip in the actual repo.
        await runGit(repo, ['checkout', '-q', '-b', 'injected-flip']);
      }
      // Call the original.
      return originalMainCheckoutGit.call(mgr, cwd, args);
    };

    // Attempt to land. It should throw MainCheckoutBranchChangedError.
    let threwError = false;
    let errorName = '';
    try {
      await mgr.landEpicToMaster(epicId);
    } catch (err) {
      threwError = true;
      errorName = (err as Error)?.name ?? '';
    }

    expect(threwError).toBe(true);
    expect(errorName).toBe('MainCheckoutBranchChangedError');
  });
});
