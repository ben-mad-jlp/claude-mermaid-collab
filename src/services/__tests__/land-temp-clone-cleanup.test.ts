/**
 * Tests for temp-clone cleanup during land operations.
 *
 * Pin the `finally` teardown of the throwaway `__land-master__` land worktree
 * with a listing-equality fixture that holds on both the success path and a
 * mid-cycle THROW path.
 *
 * @serial-test-lane
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-temp-clone-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager';
import { MainCheckoutResidueError } from '../main-checkout-invariant';

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

/**
 * Capture the current state of the temp-clone directory and registered worktrees.
 * Returns a sorted array combining:
 * - Directory entries in baseDir (if it exists)
 * - Worktree paths from `git worktree list --porcelain`
 */
async function captureTempListing(repo: string, baseDir: string): Promise<string[]> {
  // Get baseDir entries if the directory exists
  const baseEntries = existsSync(baseDir) ? readdirSync(baseDir).sort() : [];

  // Get worktree paths from git worktree list --porcelain
  const worktreeResult = await runGit(repo, ['worktree', 'list', '--porcelain']);
  const worktreePaths = worktreeResult.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.replace(/^worktree /, ''))
    .sort();

  return [...baseEntries, ...worktreePaths];
}

beforeAll(() => {});
afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land-temp-clone-cleanup — temp __land-master__ worktree cleanup', () => {
  let repo: string;
  let baseDir: string;
  let mgr: WorktreeManager;
  const epicId = 'land-temp-clone-epic';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-temp-clone-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    baseDir = join(repo, '.collab', 'agent-sessions', 'worktrees');
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir,
      persistDir: join(repo, '.collab', 'agent-sessions'),
    });
  });

  afterEach(() => {
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('a land attempt removes its temp clone', async () => {
    // Create an epic and commit a new file to it
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'epic-file.txt'), 'epic output\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit']);

    // Capture the temp-clone state before landing
    const before = await captureTempListing(repo, baseDir);

    // Land the epic
    const result = await mgr.landEpicToMaster(epicId);
    expect(result.landed).toBe(true);

    // Capture the temp-clone state after landing
    const after = await captureTempListing(repo, baseDir);

    // The temp clone should have been removed: both directory and git worktree registry
    expect(after).toEqual(before);
    expect(existsSync(join(baseDir, '__land-master__'))).toBe(false);
  });

  it('a failed land attempt also removes its temp clone', async () => {
    // Create an epic and commit a new file to it
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');
    writeFileSync(join(epicInfo.path, 'epic-file.txt'), 'epic output\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit']);

    // Stage a tracked edit in the main checkout on master
    // This will cause MainCheckoutResidueError during land
    writeFileSync(join(repo, 'base.txt'), 'base-modified\n');
    await runGit(repo, ['add', 'base.txt']);

    // Capture the temp-clone state before the failed land
    const before = await captureTempListing(repo, baseDir);

    // Attempt to land; it should throw MainCheckoutResidueError
    let caught: any = null;
    try {
      await mgr.landEpicToMaster(epicId);
    } catch (err) {
      caught = err;
    }

    // Verify the error was thrown and it is MainCheckoutResidueError
    expect(caught).toBeTruthy();
    expect(caught.name).toBe('MainCheckoutResidueError');
    expect(caught instanceof MainCheckoutResidueError).toBe(true);

    // Capture the temp-clone state after the failed land
    const after = await captureTempListing(repo, baseDir);

    // Even though the land failed, the temp clone should have been removed
    // by the finally block in landEpicToMaster
    expect(after).toEqual(before);
    expect(existsSync(join(baseDir, '__land-master__'))).toBe(false);
  });
});
