import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

/**
 * Build-base consistency (todo 38d87ab3). forwardIntegrateEpic merges trunk INTO the
 * epic accumulation branch BEFORE a lane forks its build worktree off the epic tip, so
 * a foundation that landed to trunk after the epic branched is present in the build base
 * (the claim-time union admits it; the build base must agree). Forward-MERGE, never
 * rebase. Conflict-safe: a conflict aborts and leaves the epic branch UNTOUCHED. Real
 * git in a temp repo (hermetic).
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

const EPIC = 'epic-bbbbbbbb';

describe('WorktreeManager — forwardIntegrateEpic (38d87ab3)', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-fi-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-fi-persist-'));
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

  /** Commit `file`=`content` directly on master in the main checkout (simulates a
   *  cross-epic foundation landing to trunk after the epic branched). */
  async function commitOnMaster(file: string, content: string) {
    await fs.writeFile(path.join(repo, file), content);
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', `master: add ${file}`]);
  }

  it('is a no-op when the epic branch already contains trunk (fresh epic)', async () => {
    await mgr.ensureEpic(EPIC, undefined, 'master'); // branched off master's tip
    const res = await mgr.forwardIntegrateEpic(EPIC, 'master');
    expect(res.integrated).toBe(true);
    expect(res.advanced).toBe(false);
    expect(res.conflict).toBe(false);
  });

  it('advances the epic branch when trunk moved ahead (the build-base fix)', async () => {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    expect(epic).not.toBeNull();
    // Trunk gains a foundation file AFTER the epic branched.
    await commitOnMaster('foundation.txt', 'dep\n');

    // Before forward-integration the foundation is absent from the epic worktree.
    expect(await exists(path.join(epic!.path, 'foundation.txt'))).toBe(false);

    const res = await mgr.forwardIntegrateEpic(EPIC, 'master');
    expect(res.conflict).toBe(false);
    expect(res.integrated).toBe(true);
    expect(res.advanced).toBe(true);

    // Now the foundation is present in the build base, and trunk is an ancestor.
    expect(await exists(path.join(epic!.path, 'foundation.txt'))).toBe(true);
    const anc = await runGit(epic!.path, ['merge-base', '--is-ancestor', 'master', mgr.epicBranchName(EPIC)]);
    expect(anc.code).toBe(0);

    // Idempotent: a second call is a clean no-op.
    const again = await mgr.forwardIntegrateEpic(EPIC, 'master');
    expect(again.integrated).toBe(true);
    expect(again.advanced).toBe(false);
  });

  it('aborts on conflict and leaves the epic branch UNTOUCHED', async () => {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    expect(epic).not.toBeNull();
    // Both sides edit the SAME file differently after the fork → a real conflict.
    await fs.writeFile(path.join(epic!.path, 'clash.txt'), 'epic-side\n');
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', 'epic: clash']);
    const epicTipBefore = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();

    await commitOnMaster('clash.txt', 'master-side\n');

    const res = await mgr.forwardIntegrateEpic(EPIC, 'master');
    expect(res.conflict).toBe(true);
    expect(res.integrated).toBe(false);
    expect(res.advanced).toBe(false);
    expect(res.conflictedPaths).toContain('clash.txt');

    // Epic branch tip is unchanged and the worktree is clean (merge aborted).
    const epicTipAfter = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(epicTipAfter).toBe(epicTipBefore);
    const status = await runGit(epic!.path, ['status', '--porcelain']);
    expect(status.stdout.trim()).toBe('');
  });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
