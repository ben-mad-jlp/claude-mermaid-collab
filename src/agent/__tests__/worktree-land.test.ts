import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

/**
 * FBPE P4 — the land click. landEpicToMaster performs ONE --no-ff epic→master merge
 * in a throwaway detached master checkout, then advances the master ref via a CAS
 * update-ref. A conflict aborts and leaves master UNTOUCHED. removeEpic tears down the
 * epic branch + worktree after a successful land. These run against REAL git in a temp
 * repo (hermetic + fast).
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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const EPIC = 'epic-aaaaaaaa';

describe('WorktreeManager — landEpicToMaster + removeEpic (FBPE P4)', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-land-repo-'));
    // Master is the land target — init the repo's default branch as master.
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-land-persist-'));
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

  /** Create the epic branch + worktree and commit `file`=`content` on it. */
  async function epicWith(file: string, content: string) {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    expect(epic).not.toBeNull();
    await fs.writeFile(path.join(epic!.path, file), content);
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', `epic: add ${file}`]);
    return epic!;
  }

  it('lands a clean epic onto master with one --no-ff merge and advances master', async () => {
    await epicWith('feature.txt', 'epic-output\n');
    const beforeSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.conflict).toBe(false);
    expect(res.landed).toBe(true);
    expect(res.masterSha).toBeTruthy();

    // master advanced to the merge commit and now carries the epic's output.
    const afterSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();
    expect(afterSha).toBe(res.masterSha!);
    expect(afterSha).not.toBe(beforeSha);
    expect((await runGit(repo, ['show', 'master:feature.txt'])).stdout).toBe('epic-output\n');

    // --no-ff → master HEAD is a merge commit (two parents).
    const parents = (await runGit(repo, ['rev-list', '--parents', '-n', '1', 'master'])).stdout.trim().split(/\s+/);
    expect(parents.length).toBe(3);

    // The throwaway land worktree was torn down.
    expect(await exists(path.join(persistDir, 'worktrees', '__land-master__'))).toBe(false);
  });

  it('leaves master UNTOUCHED on a conflicting epic and reports conflict', async () => {
    await epicWith('clash.txt', 'epic-side\n');
    // Diverge master on the SAME file so the merge conflicts.
    await fs.writeFile(path.join(repo, 'clash.txt'), 'master-side\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master: clash']);
    const beforeSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.landed).toBe(false);
    expect(res.conflict).toBe(true);

    // master ref is exactly where it was — untouched.
    const afterSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();
    expect(afterSha).toBe(beforeSha);
    // No mid-merge state lingering in the main tree.
    expect(await exists(path.join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
  });

  it('removeEpic deletes the epic branch + worktree (idempotent)', async () => {
    const epic = await epicWith('x.txt', 'x\n');
    await mgr.landEpicToMaster(EPIC);

    await mgr.removeEpic(EPIC);
    expect((await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epic.branch}`])).code).not.toBe(0);
    expect(await exists(epic.path)).toBe(false);

    // Idempotent — a second call is a no-op, never throws.
    await mgr.removeEpic(EPIC);
  });

  it('reports a missing epic branch without touching master', async () => {
    const res = await mgr.landEpicToMaster('epic-nonexistent');
    expect(res.landed).toBe(false);
    expect(res.conflict).toBe(false);
    expect(res.reason).toContain('epic-branch-missing');
  });
});
