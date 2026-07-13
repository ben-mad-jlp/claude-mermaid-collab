/**
 * Tests for the second candidate class in gcLeafWorktrees — the orphan non-leaf/lane
 * worktree GC pass. Builds a real temp git repo + real `git worktree add` checkouts
 * so `git worktree list --porcelain` / `git status --porcelain` / git log are exercised
 * for real (mirrors the pattern in worktree-gc.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-orphan-gc-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcLeafWorktrees } from '../leaf-worktree-reaper';

const REAP_GRACE_MS = 5 * 60_000;
const ORPHAN_WORKTREE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Backdate a dir's own mtime past the grace window. Must run LAST,
 *  after every fs mutation that touches the dir's entries. */
async function backdate(dir: string) {
  const old = new Date(Date.now() - REAP_GRACE_MS - 60_000);
  await utimes(dir, old, old);
}

/** Commit with an OLD GIT_COMMITTER_DATE so headCommitAgeMs sees a >7-day HEAD
 *  without waiting (used for testing age-based orphan detection). */
async function commitOld(cwd: string, message: string) {
  // First, create a file to commit (worktree might have nothing new to commit)
  writeFileSync(join(cwd, 'work.txt'), 'old work\n');
  await runGit(cwd, ['add', '-A']);

  const sevenDaysAgo = Math.floor((Date.now() - ORPHAN_WORKTREE_MAX_AGE_MS - 60_000) / 1000);
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, 'commit', '--message', message], {
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
      GIT_COMMITTER_DATE: `${sevenDaysAgo} +0000`,
    },
  });
  const [, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return code ?? 0;
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('gcLeafWorktrees — orphan non-leaf/lane worktree GC', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'orphan-gc-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('case 1: old pristine orphan lane worktree → removed', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create a lane worktree with an old commit, no wm record, pristine.
    const laneDir = join(wm.baseDir(), 'lane-old');
    await runGit(repo, ['worktree', 'add', '-b', 'lane-old-branch', laneDir]);
    // Commit with an old date so headCommitAgeMs sees it as >7 days old.
    await commitOld(laneDir, 'old work');
    // Backdate the dir's mtime past the grace window.
    await backdate(laneDir);

    const report = await gcLeafWorktrees(repo);

    expect(report.scanned).toBeGreaterThanOrEqual(1);
    expect(report.removed).toContain(laneDir);
    expect(existsSync(laneDir)).toBe(false);
  });

  it('case 2: dirty orphan → flagged, not removed', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    const laneDir = join(wm.baseDir(), 'lane-dirty');
    await runGit(repo, ['worktree', 'add', '-b', 'lane-dirty-branch', laneDir]);
    // First commit old work to establish an old HEAD
    await commitOld(laneDir, 'old work');
    // THEN write an uncommitted tracked edit to make it dirty (after the old commit).
    writeFileSync(join(laneDir, 'README.md'), 'edited\n');
    await backdate(laneDir);

    const report = await gcLeafWorktrees(repo);

    expect(report.removed).not.toContain(laneDir);
    expect(existsSync(laneDir)).toBe(true);

    const dirtyRefusal = report.refused.find((r) => r.path === laneDir);
    expect(dirtyRefusal).toBeTruthy();
    expect(dirtyRefusal!.reason).toBe('orphan-dirty');
    expect(dirtyRefusal!.sample.length).toBeGreaterThan(0);
  });

  it('case 3: locked orphan → flagged, not removed', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    const laneDir = join(wm.baseDir(), 'lane-locked');
    await runGit(repo, ['worktree', 'add', '-b', 'lane-locked-branch', laneDir]);
    await commitOld(laneDir, 'old work');
    // Lock the worktree.
    await runGit(repo, ['worktree', 'lock', laneDir]);
    await backdate(laneDir);

    const report = await gcLeafWorktrees(repo);

    expect(report.removed).not.toContain(laneDir);
    expect(existsSync(laneDir)).toBe(true);

    const lockedRefusal = report.refused.find((r) => r.path === laneDir);
    expect(lockedRefusal).toBeTruthy();
    expect(lockedRefusal!.reason).toBe('orphan-locked');
  });

  it('case 4: leaf-exec-* worktree → handled by existing path, not orphan class', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create a done leaf todo and its worktree.
    const doneTodo = await createTodo(repo, {
      allowOrphan: true,
      title: 'done leaf',
      ownerSession: 'test',
      kind: 'leaf',
      status: 'done',
    });
    const doneId8 = doneTodo.id.slice(0, 8);
    const doneDir = join(wm.baseDir(), `leaf-exec-${doneId8}`);
    await runGit(repo, ['worktree', 'add', '-b', `wt-${doneId8}`, doneDir]);
    // Commit with old date and backdate.
    await commitOld(doneDir, 'done work');
    await backdate(doneDir);

    const report = await gcLeafWorktrees(repo);

    // The leaf-exec-* worktree should be removed.
    expect(report.removed).toContain(doneDir);
    expect(existsSync(doneDir)).toBe(false);

    // Verify it was handled by the leaf-exec class, not the orphan class
    // (i.e., no orphan-* prefixed refusal).
    const refusalForDir = report.refused.find((r) => r.path === doneDir);
    if (refusalForDir) {
      expect(refusalForDir.reason).not.toMatch(/^orphan-/);
    }
  });

  it('case 5: non-terminal epic worktree → silently skipped, not removed', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create a non-terminal epic todo (status 'planned' or 'todo').
    const epicTodo = await createTodo(repo, {
      allowOrphan: true,
      title: 'live epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId8 = epicTodo.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    await runGit(repo, ['worktree', 'add', '-b', `epic-${epicId8}`, epicDir]);
    // Commit with old date to make it look old.
    await commitOld(epicDir, 'epic work');
    await backdate(epicDir);

    const report = await gcLeafWorktrees(repo);

    // The epic worktree should NOT be removed (live epic guard).
    expect(report.removed).not.toContain(epicDir);
    expect(existsSync(epicDir)).toBe(true);

    // Verify it was silently skipped (no refused entry).
    const refusalForDir = report.refused.find((r) => r.path === epicDir);
    expect(refusalForDir).toBeFalsy();
  });
});
