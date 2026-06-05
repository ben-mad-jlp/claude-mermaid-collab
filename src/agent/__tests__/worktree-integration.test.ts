import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager, INTEGRATION_BRANCH } from '../worktree-manager.ts';

/**
 * DOGFOOD #5 — worker write-isolation via the integration-branch recombination
 * model. These run against REAL git in a temp repo (no INTEGRATION gating: they
 * are hermetic and fast). They prove the two properties the design requires:
 *   1. accepted worker output lands on the shared `collab/integration` branch; and
 *   2. dependent-todo data-flow is preserved — a worker branched off integration
 *      AFTER a dep merged sees the dep's committed output (the regression a naive
 *      per-lane-worktree fix would introduce).
 */

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

describe('WorktreeManager — integration-branch recombination (DOGFOOD #5)', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-integ-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-integ-persist-'));
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

  it('ensureIntegration creates the integration branch + worktree', async () => {
    const integ = await mgr.ensureIntegration();
    expect(integ).not.toBeNull();
    expect(integ!.branch).toBe(INTEGRATION_BRANCH);
    // Branch exists in the repo.
    const verify = await runGit(repo, ['rev-parse', '--verify', `refs/heads/${INTEGRATION_BRANCH}`]);
    expect(verify.code).toBe(0);
    // Idempotent — second call returns the same path without error.
    const again = await mgr.ensureIntegration();
    expect(again!.path).toBe(integ!.path);
  });

  it('commits a worker worktree and merges it into integration', async () => {
    const integ = await mgr.ensureIntegration();
    const wt = await mgr.ensure('worker-a', { baseBranch: integ!.branch });
    expect(wt.path).not.toBe(repo); // a real worktree, not the shared tree

    await fs.writeFile(path.join(wt.path, 'a.txt'), 'from-a\n');
    const res = await mgr.commitAndMergeToIntegration('worker-a', { message: 'todo a' });
    expect(res.committed).toBe(true);
    expect(res.merged).toBe(true);
    expect(res.conflict).toBe(false);

    // The integration branch now contains a.txt.
    const show = await runGit(repo, ['show', `${INTEGRATION_BRANCH}:a.txt`]);
    expect(show.code).toBe(0);
    expect(show.stdout).toBe('from-a\n');
  });

  it('preserves dependent-todo data-flow: a later worker sees a prior merged dep', async () => {
    const integ = await mgr.ensureIntegration();

    // Worker A produces a.txt and merges it.
    const wtA = await mgr.ensure('lane-1', { baseBranch: integ!.branch });
    await fs.writeFile(path.join(wtA.path, 'a.txt'), 'A-output\n');
    const ra = await mgr.commitAndMergeToIntegration('lane-1', { message: 'A' });
    expect(ra.merged).toBe(true);
    await mgr.remove('lane-1');

    // Worker B (a DIFFERENT lane, dependsOn A) branches off the LATEST integration
    // → it must see A's committed output even though A ran in a different worktree.
    const wtB = await mgr.ensure('lane-2', { baseBranch: integ!.branch });
    const seen = await fs.readFile(path.join(wtB.path, 'a.txt'), 'utf8');
    expect(seen).toBe('A-output\n');

    // B builds on it and merges back.
    await fs.writeFile(path.join(wtB.path, 'b.txt'), 'B-output\n');
    const rb = await mgr.commitAndMergeToIntegration('lane-2', { message: 'B' });
    expect(rb.merged).toBe(true);

    // Integration holds BOTH.
    expect((await runGit(repo, ['show', `${INTEGRATION_BRANCH}:a.txt`])).stdout).toBe('A-output\n');
    expect((await runGit(repo, ['show', `${INTEGRATION_BRANCH}:b.txt`])).stdout).toBe('B-output\n');
  });

  it('reports a conflict and leaves integration untouched (never corrupts it)', async () => {
    const integ = await mgr.ensureIntegration();

    // Lane 1 sets shared.txt and merges.
    const wt1 = await mgr.ensure('c-1', { baseBranch: integ!.branch });
    await fs.writeFile(path.join(wt1.path, 'shared.txt'), 'one\n');
    await mgr.commitAndMergeToIntegration('c-1', { message: 'one' });

    // Lane 2 branched off the ORIGINAL integration (before lane 1's merge) edits the
    // same file divergently → conflict on merge-back.
    const wt2 = await mgr.ensure('c-2', { baseBranch: 'main' });
    await fs.writeFile(path.join(wt2.path, 'shared.txt'), 'two\n');
    const res = await mgr.commitAndMergeToIntegration('c-2', { message: 'two' });
    expect(res.conflict).toBe(true);
    expect(res.merged).toBe(false);

    // Integration still has lane 1's content — untouched by the failed merge.
    expect((await runGit(repo, ['show', `${INTEGRATION_BRANCH}:shared.txt`])).stdout).toBe('one\n');
    // And the integration worktree is not left mid-merge.
    const status = await runGit(integ!.path, ['status', '--porcelain']);
    expect(status.stdout.trim()).toBe('');
  });
});
