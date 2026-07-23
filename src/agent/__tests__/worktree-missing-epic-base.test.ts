import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

describe('WorktreeManager — missing epic base branch materialization', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-epic-base-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-epic-base-persist-'));
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: path.join(persistDir, 'worktrees'),
      persistDir,
    });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  it('ensure() succeeds with a missing epic base branch and materialises it', async () => {
    const sessionId = 'test-session-001';
    const epicBaseId = 'deadbeef12345678'; // 16-char, will be 8-char in branch name
    const epicBaseBranch = `collab/epic/${epicBaseId.substring(0, 8)}`; // collab/epic/deadbeef

    // The epic base branch does NOT exist yet — this is the cold-start scenario.
    const checkBranchBefore = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBaseBranch}`]);
    expect(checkBranchBefore.code).not.toBe(0); // branch should not exist

    // Call ensure with fresh=true and baseBranch pointing to the missing epic branch.
    const result = await mgr.ensure(sessionId, { baseBranch: epicBaseBranch, fresh: true });

    // Should succeed and return a WorktreeInfo, not a NonGitFallback.
    expect('branch' in result).toBe(true);
    if ('branch' in result) {
      expect(result.baseBranch).toBe(epicBaseBranch);
      expect(result.path).toBeDefined();
    }

    // Verify the epic base branch was created.
    const checkBranchAfter = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBaseBranch}`]);
    expect(checkBranchAfter.code).toBe(0); // branch should now exist

    // Verify it branches off master (same commit sha).
    const masterSha = await runGit(repo, ['rev-parse', 'refs/heads/master']);
    const epicBaseSha = await runGit(repo, ['rev-parse', `refs/heads/${epicBaseBranch}`]);
    expect(masterSha.stdout.trim()).toBe(epicBaseSha.stdout.trim());
  });

  it('ensure() succeeds even if epic base is deleted between attempts', async () => {
    const sessionId = 'test-session-002';
    const epicBaseBranch = `collab/epic/cafe1234`;

    // Pre-create the branch so the first attempt can find it.
    const masterSha = await runGit(repo, ['rev-parse', 'refs/heads/master']);
    await runGit(repo, ['branch', epicBaseBranch, masterSha.stdout.trim()]);

    // Verify it exists before calling ensure.
    const checkBefore = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBaseBranch}`]);
    expect(checkBefore.code).toBe(0);

    // Delete it to simulate a concurrent sibling cleanup.
    await runGit(repo, ['branch', '-D', epicBaseBranch]);

    // Verify it's gone.
    const checkDeleted = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBaseBranch}`]);
    expect(checkDeleted.code).not.toBe(0);

    // Call ensure — it should still succeed, re-materialising the branch.
    const result = await mgr.ensure(sessionId, { baseBranch: epicBaseBranch, fresh: true });

    expect('branch' in result).toBe(true);
    if ('branch' in result) {
      expect(result.baseBranch).toBe(epicBaseBranch);
    }

    // Verify the branch was re-created.
    const checkAfter = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epicBaseBranch}`]);
    expect(checkAfter.code).toBe(0);
  });

  it('ensure() does not materialise non-epic base branches', async () => {
    const sessionId = 'test-session-003';
    // Use the default base branch (master), which is not an epic branch.
    // This verifies that non-epic branches go through ensure() unchanged.
    const result = await mgr.ensure(sessionId, { fresh: true });

    // Should succeed with master as the base.
    expect('branch' in result).toBe(true);
    if ('branch' in result) {
      expect(result.baseBranch).toBe('master');
      expect(result.path).toBeDefined();
    }
  });
});
