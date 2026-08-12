/**
 * Proof that the narrow post-land index sync brings landed paths current while
 * preserving pre-existing residue and still raising loud.
 *
 * Builds on the real-git harness at land-staged-deletion-residue.test.ts to test the
 * new narrowSyncLandedPaths function integrated into WorktreeManager.landEpicToMaster.
 *
 * Arms A/B/C prove:
 * - A: Land with an unrelated staged entry leaves no residue of its own (the land's paths are synced)
 * - B: The pre-existing staged entry is byte-preserved
 * - C: Clean checkout is unchanged
 */

import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (worktree-manager pulls in the
// main-checkout escalation adapter). Mirrors land-staged-deletion-residue.test.ts:14-15.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-post-land-index-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { WorktreeManager } from '../../agent/worktree-manager';
import {
  MainCheckoutResidueError,
  type MainCheckoutBranchChangedError,
} from '../main-checkout-invariant';

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

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

const EPIC = 'epic-narrow-sync';

describe('post-land index sync — narrow syncing of landed paths while preserving residue', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;
  let violations: Array<MainCheckoutResidueError | MainCheckoutBranchChangedError>;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'post-land-index-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    mkdirSync(join(repo, 'datum_planes'), { recursive: true });
    writeFileSync(join(repo, 'datum_planes', 'a.py'), 'a = 1\n');
    writeFileSync(join(repo, 'datum_planes', 'b.py'), 'b = 2\n');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = mkdtempSync(join(tmpdir(), 'post-land-index-persist-'));
    violations = [];
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(persistDir, 'worktrees'),
      persistDir,
      // Spy: keeps the default escalation sink (which opens the supervisor DB) out of the test.
      onMainCheckoutViolation: (err) => { violations.push(err); },
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(persistDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Real epic branch + worktree carrying a modification and an addition under datum_planes/. */
  async function buildEpic(): Promise<void> {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'datum_planes', 'a.py'), 'a = 1  # epic\n');
    writeFileSync(join(epic.path, 'datum_planes', 'c.py'), 'c = 3\n');
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: datum_planes work']);
  }

  /** Real epic branch + worktree carrying a modification, an addition, and a deletion under datum_planes/. */
  async function buildDeletingEpic(): Promise<void> {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    if (!epic) throw new Error('ensureEpic returned null');
    writeFileSync(join(epic.path, 'datum_planes', 'a.py'), 'a = 1  # epic\n');
    writeFileSync(join(epic.path, 'datum_planes', 'c.py'), 'c = 3\n');
    await runGit(epic.path, ['rm', '-q', 'datum_planes/b.py']);
    await runGit(epic.path, ['add', '-A']);
    await runGit(epic.path, ['commit', '-q', '-m', 'epic: datum_planes work + delete b.py']);
  }

  it('Arm A — land with an unrelated staged entry leaves no residue of its own', async () => {
    await buildEpic();

    // Stage a real edit to an unrelated file (never touched by the epic), then restore
    // the HEAD content on disk so the worktree diff is blind to it (MM pattern).
    // Use base.txt which exists in HEAD.
    writeFileSync(join(repo, 'base.txt'), 'base edited\n');
    await runGit(repo, ['add', 'base.txt']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');

    let caught: unknown = null;
    try {
      await mgr.landEpicToMaster(EPIC);
    } catch (err) {
      caught = err;
    }

    // Verify the error was thrown (residue present).
    expect(caught).toBeInstanceOf(MainCheckoutResidueError);
    expect(caught instanceof MainCheckoutResidueError && caught.addedResidue).toContain('base.txt');

    // Verify that the epic's own paths are now at HEAD content (not in git status).
    // This proves the narrow sync ran.
    const gitStatus = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout;
    expect(gitStatus).not.toContain('datum_planes/a.py');
    expect(gitStatus).not.toContain('datum_planes/c.py');

    // Verify the epic's paths match HEAD (the narrow sync brought them current).
    const showA = await runGit(repo, ['show', ':datum_planes/a.py']);
    expect(showA.stdout).toBe('a = 1  # epic\n');
    const showC = await runGit(repo, ['show', ':datum_planes/c.py']);
    expect(showC.stdout).toBe('c = 3\n');

    // The pre-existing residue (base.txt) is still staged.
    const staged = (await runGit(repo, ['diff', '--cached', '--name-status'])).stdout;
    expect(staged).toContain('M\tbase.txt');
  });

  it('Arm B — the pre-existing staged entry is byte-preserved', async () => {
    await buildEpic();

    // Stage an edit to an existing file (base.txt), then restore HEAD content.
    const editedContent = 'base modified by user\n';
    writeFileSync(join(repo, 'base.txt'), editedContent);
    await runGit(repo, ['add', 'base.txt']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');

    let caught: unknown = null;
    try {
      await mgr.landEpicToMaster(EPIC);
    } catch (err) {
      caught = err;
    }

    // Verify the error was thrown.
    expect(caught).toBeInstanceOf(MainCheckoutResidueError);

    // Verify the staged blob content survived byte-for-byte.
    const showStaged = await runGit(repo, ['show', ':base.txt']);
    expect(showStaged.code).toBe(0);
    expect(showStaged.stdout).toBe(editedContent);

    // Verify it's still in the index as modified.
    const staged = (await runGit(repo, ['diff', '--cached', '--name-status'])).stdout;
    expect(staged).toContain('M\tbase.txt');
  });

  it('Arm C — clean checkout is unchanged', async () => {
    await buildEpic();

    // No pre-existing residue; the land should succeed cleanly.
    const result = await mgr.landEpicToMaster(EPIC);

    expect(result.landed).toBe(true);
    expect(result.treeSynced).toBe('reset-hard');
    expect(result.narrowSyncedPaths).toBeUndefined();

    // Checkout is clean.
    const gitStatus = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout;
    expect(gitStatus.trim()).toBe('');
  });

  it('Arm D — land-authored deletion on an otherwise-clean checkout leaves no staged deletions', async () => {
    await buildDeletingEpic();

    // No pre-existing residue; the land should succeed cleanly.
    const result = await mgr.landEpicToMaster(EPIC);

    expect(result.landed).toBe(true);

    // Verify no staged deletions (no lines starting with D\t).
    const staged = (await runGit(repo, ['diff', '--cached', '--name-status'])).stdout;
    staged.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
      expect(l.startsWith('D\t')).toBe(false);
    });

    // Checkout is clean.
    const gitStatus = (await runGit(repo, ['status', '--porcelain', '--untracked-files=no'])).stdout;
    expect(gitStatus.trim()).toBe('');

    // datum_planes/b.py is deleted and not recoverable.
    expect(existsSync(join(repo, 'datum_planes', 'b.py'))).toBe(false);
    const showB = await runGit(repo, ['show', ':datum_planes/b.py']);
    expect(showB.code).not.toBe(0);
  });

  it('Arm E — anti-vacuity: a pre-existing human deletion survives a land-authored deletion', async () => {
    await buildDeletingEpic();

    // Stage a pre-existing human deletion: remove base.txt from the index.
    await runGit(repo, ['rm', '--cached', '-q', 'base.txt']);

    // Capture the pre-land staged status.
    const preLandStaged = (await runGit(repo, ['diff', '--cached', '--name-status'])).stdout;
    const preLine = preLandStaged.split('\n').find(l => l.includes('base.txt'))!;
    expect(preLine).toBeDefined();
    expect(preLine.startsWith('D\t')).toBe(true);

    // Attempt to land; should throw due to residue.
    let caught: unknown = null;
    try {
      await mgr.landEpicToMaster(EPIC);
    } catch (err) {
      caught = err;
    }

    // Verify it threw MainCheckoutResidueError.
    expect(caught).toBeInstanceOf(MainCheckoutResidueError);
    expect(caught instanceof MainCheckoutResidueError && caught.opName).toBe('land_epic');
    expect(violations.length).toBe(1);

    // Verify the staged deletion survived byte-identical.
    const postLandStaged = (await runGit(repo, ['diff', '--cached', '--name-status'])).stdout;
    const postLine = postLandStaged.split('\n').find(l => l.includes('base.txt'));
    expect(postLine).toBe(preLine);

    // Verify we're still on master.
    const branch = await runGit(repo, ['symbolic-ref', '--short', 'HEAD']);
    expect(branch.stdout.trim()).toBe('master');
  });
});
