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

  it('symlinks main-repo node_modules into a fresh worktree for each package.json dir', async () => {
    // Main repo has deps at root and in ui/ (the auto-detect case the fix targets).
    // node_modules is gitignored (as in reality) → worktrees start WITHOUT it.
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'react'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'react', 'index.js'), 'module.exports=2\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'add packages']);

    const integ = await mgr.ensureIntegration();
    const wt = await mgr.ensure('deps-lane', { baseBranch: integ!.branch });

    // Root node_modules is a symlink resolving to the main repo's deps.
    const rootNM = path.join(wt.path, 'node_modules');
    expect((await fs.lstat(rootNM)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(rootNM, 'left-pad', 'index.js'), 'utf8')).toBe('module.exports=1\n');

    // Nested ui/node_modules is symlinked too (auto-detected via ui/package.json).
    const uiNM = path.join(wt.path, 'ui', 'node_modules');
    expect((await fs.lstat(uiNM)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(uiNM, 'react', 'index.js'), 'utf8')).toBe('module.exports=2\n');
  });

  it('node_modules symlink is git-excluded in the worktree even when repo .gitignore does NOT cover it', async () => {
    // Reproduce the master-corrupting incident's precondition: the repo .gitignore
    // uses the trailing-slash form `node_modules/` (matches DIRS only), so git does
    // NOT treat the node_modules SYMLINK as ignored. The worktree-local git exclude
    // must still hide it so a worker can never `git add` the self-referential
    // symlink that once merged to master (ELOOP).
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'react'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'react', 'index.js'), 'module.exports=2\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'add packages without node_modules ignore']);

    const integ = await mgr.ensureIntegration();
    const wt = await mgr.ensure('excl-lane', { baseBranch: integ!.branch });

    // The symlinks exist...
    expect((await fs.lstat(path.join(wt.path, 'node_modules'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(wt.path, 'ui', 'node_modules'))).isSymbolicLink()).toBe(true);

    // ...but git status in the worktree ignores them (covered by .git/info/exclude,
    // independent of the repo .gitignore semantics).
    const status = await runGit(wt.path, ['status', '--porcelain']);
    expect(status.stdout).not.toContain('node_modules');

    // And even an explicit `git add -A` cannot stage a node_modules symlink.
    await runGit(wt.path, ['add', '-A']);
    const staged = await runGit(wt.path, ['diff', '--cached', '--name-only']);
    expect(staged.stdout).not.toContain('node_modules');
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
