/**
 * Tests for epicMergeClean isolation (L1 land-path hardening):
 *   3a. The dry-merge validation runs in an isolated detached worktree;
 *       a dirty main checkout does NOT contaminate it and the dirty file survives.
 *   3b. A conflicting epic fails on mergeability regardless of dirty main state.
 *
 * epicMergeClean is a member of the non-exported `realRunners` object in steward-proof.ts.
 * We drive it through the public validateStewardProof('land_epic', ...) entrypoint
 * with `tscClean` stubbed to `() => true` and `epicChildIds` empty (no children to
 * check) so only epicMergeClean gates the verdict — matching the approach in steward-proof.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateStewardProof } from '../steward-proof';
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
  return { code: code ?? 0, stdout, stderr };
}

/** Build a validateStewardProof context with tscClean stubbed, epicMergeClean using the real runner. */
function makeCtx(opts: { repo: string; epicBranch: string }) {
  return {
    project: opts.repo,
    dependsOn: [],
    getDep: () => null,
    epicChildIds: [],
    epicWorktreeCwd: opts.repo,
    masterCwd: opts.repo,
    runners: {
      tscClean: () => true,
      commitsBehindMaster: () => 0,
      grepPresent: () => false,
      fileExists: () => false,
      // epicMergeClean is intentionally NOT overridden — the real runner runs.
    },
  };
}

describe('epicMergeClean — isolation: dirty main does not contaminate validation', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const epicId = 'test-epic-iso';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'epic-merge-iso-'));
    // Must be 'master' — epicMergeClean hardcodes `git worktree add --detach … master`.
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

  it('test 3a — clean merge passes even when the main checkout is dirty', async () => {
    // Create an epic branch with a non-conflicting new file.
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'new-feature.txt'), 'epic content\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'add feature']);
    const epicBranch = mgr.epicBranchName(epicId);

    // Make the main checkout dirty with an untracked contaminant.
    writeFileSync(join(repo, 'contaminant.txt'), 'dirty\n');

    // Run the validation — only epicMergeClean is the real runner here.
    const verdict = validateStewardProof(
      'land_epic',
      { kind: 'epic-landable', epicId, epicBranch },
      makeCtx({ repo, epicBranch }),
    );

    // The clean epic branch should pass validation regardless of the dirty main.
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBe('ok');

    // The dirty file must still be present — the isolated trial worktree left it untouched.
    const statusRes = await runGit(repo, ['status', '--porcelain']);
    expect(statusRes.stdout).toContain('contaminant.txt');

    // No stale trial worktree should be left behind.
    const wtListRes = await runGit(repo, ['worktree', 'list']);
    const nonMainWorktrees = wtListRes.stdout
      .split('\n')
      .filter((l) => l.includes('collab-land-trial'));
    expect(nonMainWorktrees).toHaveLength(0);
  });

  it('test 3b — conflicting epic fails on mergeability regardless of dirty main', async () => {
    // Commit a file on master that the epic will conflict with.
    writeFileSync(join(repo, 'conflict.txt'), 'master version\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master adds conflict.txt']);

    // Create the epic branch from the commit BEFORE the conflict file was added.
    // We do this by branching from the first commit (the base), then adding a conflicting change.
    const firstSha = (await runGit(repo, ['rev-list', '--max-parents=0', 'master'])).stdout.trim();
    await runGit(repo, ['branch', 'collab/epic/conflict1', firstSha]);
    // Add conflicting content to the same file on the epic branch.
    const epicWt = join(repo, '.collab', 'agent-sessions', 'worktrees', 'conflict-test');
    await runGit(repo, ['worktree', 'add', '--detach', epicWt, 'collab/epic/conflict1']);
    writeFileSync(join(epicWt, 'conflict.txt'), 'epic version — conflicts\n');
    await runGit(epicWt, ['add', '-A']);
    await runGit(epicWt, ['commit', '-q', '-m', 'epic changes conflict.txt']);
    // Move the branch ref to this new commit.
    const epicSha = (await runGit(epicWt, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(repo, ['worktree', 'remove', '--force', epicWt]);
    await runGit(repo, ['update-ref', 'refs/heads/collab/epic/conflict1', epicSha]);

    // Make main dirty too (unrelated file).
    writeFileSync(join(repo, 'dirty2.txt'), 'dirty\n');

    const epicBranch = 'collab/epic/conflict1';
    const verdict = validateStewardProof(
      'land_epic',
      { kind: 'epic-landable', epicId: 'conflict1', epicBranch },
      makeCtx({ repo, epicBranch }),
    );

    // Conflict → epic-merge-conflict, not dirty-tree or any other reason.
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('epic-merge-conflict');
  });
});
