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

describe('WorktreeManager.pruneMissingWorktrees (crit d7f5eb20)', () => {
  let repo: string;
  let persistDir: string;
  let baseDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    // realpath() the temp dirs: on macOS os.tmpdir() is under a symlink (/var -> /private/var)
    // and git resolves worktree admin paths to the realpath, so raw mkdtemp() output would
    // mismatch git's reported paths in string/resolve comparisons below.
    repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prune-test-repo-')));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prune-test-persist-')));
    baseDir = path.join(persistDir, 'worktrees');
    mgr = new WorktreeManager({ projectRoot: repo, baseDir, persistDir });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  it("clears a worktree whose dir was rm'd out-of-band, leaves a real dir untouched", async () => {
    const gonePath = path.join(baseDir, 'wt-gone');
    const livePath = path.join(baseDir, 'wt-live');
    await fs.mkdir(baseDir, { recursive: true });

    const addGone = await runGit(repo, ['worktree', 'add', '-b', 'wt-gone', gonePath, 'main']);
    expect(addGone.code).toBe(0);
    const addLive = await runGit(repo, ['worktree', 'add', '-b', 'wt-live', livePath, 'main']);
    expect(addLive.code).toBe(0);

    // Simulate a dir deleted out-of-band (without `git worktree remove`).
    await fs.rm(gonePath, { recursive: true, force: true });

    // Pre-condition: git still lists the now-missing worktree as prunable.
    const preList = await runGit(repo, ['worktree', 'list', '--porcelain']);
    expect(preList.stdout).toContain(gonePath);
    expect(preList.stdout).toContain(livePath);

    const pruned = await mgr.pruneMissingWorktrees();
    expect(pruned.some((p) => path.resolve(p.path) === path.resolve(gonePath))).toBe(true);
    expect(pruned.some((p) => path.resolve(p.path) === path.resolve(livePath))).toBe(false);

    const postList = await runGit(repo, ['worktree', 'list', '--porcelain']);
    expect(postList.stdout).not.toContain(gonePath);
    // The real, still-present worktree is untouched.
    expect(postList.stdout).toContain(livePath);
    const liveStat = await fs.stat(livePath).catch(() => null);
    expect(liveStat).not.toBeNull();
  });
});
