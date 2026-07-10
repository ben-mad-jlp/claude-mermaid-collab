import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

/**
 * trackedDirtyPaths (0949289b) — untracked files must NOT count as dirty for the post-land
 * tree-integrity guard. The guard was gated on dirtyPaths() (which includes untracked), so
 * every allowDirty land (untracked docs/designs/ present) skipped it and the stale-checkout
 * corruption went undetected. trackedDirtyPaths() uses --untracked-files=no. Real git, hermetic.
 */
async function runGit(cwd: string, args: string[]): Promise<void> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  await proc.exited;
}

describe('WorktreeManager.trackedDirtyPaths', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-td-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'v1\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-td-persist-'));
    mgr = new WorktreeManager({ projectRoot: repo, baseDir: path.join(persistDir, 'worktrees'), persistDir });
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  it('a clean tree is tracked-clean and dirty-clean', async () => {
    expect(await mgr.trackedDirtyPaths()).toEqual([]);
    expect(await mgr.dirtyPaths()).toEqual([]);
  });

  it('an UNTRACKED file is dirty but NOT tracked-dirty (the 0949289b case)', async () => {
    await fs.writeFile(path.join(repo, 'docs-designs-note.md'), 'untracked\n');
    // dirtyPaths sees it (would have suppressed the guard); trackedDirtyPaths does not.
    expect((await mgr.dirtyPaths()).length).toBeGreaterThan(0);
    expect(await mgr.trackedDirtyPaths()).toEqual([]);
  });

  it('a MODIFIED tracked file IS tracked-dirty (the guard still protects real work)', async () => {
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'v2\n');
    expect(await mgr.trackedDirtyPaths()).toContain('tracked.txt');
  });
});
