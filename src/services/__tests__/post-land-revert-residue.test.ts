/**
 * Tests for narrow-repair of post-land revert residue.
 *
 * Case (a): A pure revert of the landed paths (index AND worktree both equal the
 * pre-land state) is detected and narrowly restored, leaving the checkout clean.
 *
 * Case (b): A pure revert plus an unrelated tracked file that is dirty is present.
 * The pure reverts are restored (and snapshotted), the unrelated file is left untouched,
 * and the guard reports skippedUnsafe for the residue.
 *
 * These tests work at the landEpicToMaster + guardPostLandTree seam, running the REAL
 * WorktreeManager.landEpicToMaster and the real defaultLandStageDeps.runPostLandGuard
 * against a real temp git repo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'post-revert-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { guardPostLandTree } from '../tree-integrity';
import { WorktreeManager } from '../../agent/worktree-manager';

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

beforeAll(() => { /* setup */ });
afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('post-land revert residue — narrow repair', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const epicId = 'revert-residue-epic';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'revert-residue-repo-'));
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

  it('case (a): repairs a staged+worktree revert of the landed paths, leaving the checkout clean', async () => {
    // Create a file that will be modified by the epic.
    const modifiedFile = join(repo, 'modified.txt');
    writeFileSync(modifiedFile, 'base content\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'add file to be modified']);

    // Capture pre-land state.
    const preLandSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;

    // Create the epic branch and modify the file.
    const epicBranch = mgr.epicBranchName(epicId);
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');

    writeFileSync(join(epicInfo.path, 'modified.txt'), 'epic content\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit modifies file']);

    // Land the epic → master. This will auto-sync the tree.
    const landRes = await mgr.landEpicToMaster(epicId);
    expect(landRes.landed).toBe(true);
    expect(landRes.baseSha).toBeTruthy();
    const landSha = landRes.masterSha!;
    const baseSha = landRes.baseSha!;

    // Manually corrupt the tree post-land by moving HEAD back to pre-land (soft reset),
    // leaving the index+worktree at the post-land state. This simulates a different kind
    // of corruption scenario. Actually, we want the opposite: HEAD at post-land, but
    // index+worktree at pre-land. So: soft reset to pre-land, then hard reset to land.
    // Actually simpler: just do a hard reset to pre-land, then soft reset to land.
    await runGit(repo, ['reset', '--hard', preLandSha]); // index+worktree -> pre-land tree
    await runGit(repo, ['reset', '--soft', landSha]);    // HEAD -> land commit, tree stays at pre-land

    // Verify precondition: the file is at pre-land content and tree is mismatched.
    const contentBefore = readFileSync(join(repo, 'modified.txt'), 'utf-8');
    expect(contentBefore).toBe('base content\n');

    const dirtyBefore = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout;
    const trackedDirtyPaths = dirtyBefore.split('\n').map((line) => line.slice(3)).filter(Boolean);
    expect(dirtyBefore).toBeTruthy(); // modified.txt is staged+dirty.

    // Call the guard with baseSha set — it should narrow-repair the revert.
    const guard = await guardPostLandTree(repo, {
      masterSha: landSha,
      baseRef: 'master',
      baseSha,
      trackedDirty: trackedDirtyPaths,
    });

    // Assert the repair succeeded and paths were restored.
    expect(guard.mismatch).toBe(true); // There was a mismatch before repair.
    expect(guard.restored).toBe(true); // Narrow repair via git restore succeeded; tree is restored.
    expect(guard.skippedUnsafe).toBe(false); // No unsafe skip — repair succeeded.
    expect(guard.revertPathsRestored).toContain('modified.txt');
    expect(guard.snapshotRef).toBeTruthy(); // Snapshot was created.

    // Assert the checkout is now clean (no tracked-dirty files).
    const dirtyAfter = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout;
    expect(dirtyAfter).toBe(''); // Clean tree after repair.

    // Assert the file content matches the land commit (not the revert).
    const contentAfter = readFileSync(join(repo, 'modified.txt'), 'utf-8');
    expect(contentAfter).toBe('epic content\n');

    // Assert we never moved HEAD past the land commit.
    const currentHead = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;
    expect(currentHead).toBe(landSha);
  });

  it('case (b): preserves an unrelated dirty tracked file byte-for-byte and still reports skippedUnsafe for it', async () => {
    // Create two files that will both be modified by the epic.
    const landedFile = join(repo, 'landed.txt');
    const unrelatedFile = join(repo, 'unrelated.txt');
    writeFileSync(landedFile, 'base landed\n');
    writeFileSync(unrelatedFile, 'base unrelated\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'add files to be modified']);

    // Capture pre-land state.
    const preLandSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;

    // Create the epic branch and modify both files.
    const epicBranch = mgr.epicBranchName(epicId);
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');

    writeFileSync(join(epicInfo.path, 'landed.txt'), 'epic landed\n');
    writeFileSync(join(epicInfo.path, 'unrelated.txt'), 'epic unrelated\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit modifies both files']);

    // Land the epic → master.
    const landRes = await mgr.landEpicToMaster(epicId);
    expect(landRes.landed).toBe(true);
    expect(landRes.baseSha).toBeTruthy();
    const landSha = landRes.masterSha!;
    const baseSha = landRes.baseSha!;

    // Manually corrupt the tree: move index+worktree to pre-land state, HEAD to post-land.
    await runGit(repo, ['reset', '--hard', preLandSha]); // index+worktree -> pre-land tree
    await runGit(repo, ['reset', '--soft', landSha]);    // HEAD -> land commit, tree stays at pre-land

    // Now dirty the unrelated file differently (make it different from both base and post-land epic).
    writeFileSync(join(repo, 'unrelated.txt'), 'manually modified unrelated\n');

    // Verify precondition: both files are dirty (landed.txt is reverted, unrelated.txt is manually modified).
    const dirtyBefore = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout
      .split('\n')
      .map((line) => line.slice(3))
      .filter(Boolean);
    expect(dirtyBefore).toHaveLength(2);
    expect(dirtyBefore).toContain('landed.txt');
    expect(dirtyBefore).toContain('unrelated.txt');

    // Call the guard with baseSha set.
    const guard = await guardPostLandTree(repo, {
      masterSha: landSha,
      baseRef: 'master',
      baseSha,
      trackedDirty: dirtyBefore,
    });

    // Assert the repair partially succeeded: landed.txt was restored, unrelated.txt was not.
    expect(guard.mismatch).toBe(true);
    expect(guard.skippedUnsafe).toBe(true); // Still unsafe due to residual dirty file.
    expect(guard.revertPathsRestored).toContain('landed.txt'); // The proven-revert was restored.
    expect(guard.revertPathsRestored).not.toContain('unrelated.txt'); // Unrelated file not in the revert set.

    // Assert the unrelated file content is byte-for-byte preserved (not restored).
    const unrelatedContent = readFileSync(join(repo, 'unrelated.txt'), 'utf-8');
    expect(unrelatedContent).toBe('manually modified unrelated\n');

    // Assert the landed file was restored to its post-land state (epic content).
    const landedContent = readFileSync(join(repo, 'landed.txt'), 'utf-8');
    expect(landedContent).toBe('epic landed\n');

    // Assert the tree still has exactly one dirty file (the unrelated one).
    const dirtyAfter = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout
      .split('\n')
      .filter(Boolean);
    expect(dirtyAfter).toHaveLength(1);
    expect(dirtyAfter[0]).toContain('unrelated.txt');
  });
});
