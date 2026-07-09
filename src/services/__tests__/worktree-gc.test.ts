/**
 * Tests for gcLeafWorktrees — the directory-driven GC pass (kill-the-running-build
 * epic, HALF 2). Builds a real temp git repo + real `git worktree add` checkouts
 * (mirrors the pattern in land-dirty-tree.test.ts / integration.worktree.test.ts)
 * so `git worktree list` / `git status --porcelain` are exercised for real, not
 * mocked — the whole point of this pass is reconciling directory state against
 * what git actually has registered.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-wt-gc-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcLeafWorktrees } from '../leaf-worktree-reaper';

const REAP_GRACE_MS = 5 * 60_000;

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

/** Backdate a leaf-exec dir's own mtime past the grace window. Must run LAST,
 *  after every fs mutation that touches the dir's entries (new files added
 *  bump the parent dir's mtime, unlike editing an existing file's content). */
async function backdate(dir: string) {
  const old = new Date(Date.now() - REAP_GRACE_MS - 60_000);
  await utimes(dir, old, old);
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('gcLeafWorktrees — directory-vs-registration reconcile', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'wt-gc-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    // Written AFTER the base commit, so it is untracked both here and (once
    // copied) in the leaf worktree — proves the shared-untracked-file case does
    // not block GC when the file exists at the same relative path in the main
    // checkout, whether or not it's ever been committed there.
    mkdirSync(join(repo, 'docs', 'designs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'designs', 'shared.md'), 'shared\n');
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('removes a done, clean, quiet worktree; refuses a dropped worktree with an uncommitted tracked edit; removes a done worktree whose only untracked file mirrors the main checkout; skips a live in_progress leaf entirely', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Fixture 1: done + clean → removed.
    const doneTodo = await createTodo(repo, {
      allowOrphan: true, title: 'done leaf', ownerSession: 'test', kind: 'leaf', status: 'done',
    });
    const doneId8 = doneTodo.id.slice(0, 8);
    const doneDir = join(wm.baseDir(), `leaf-exec-${doneId8}`);
    await runGit(repo, ['worktree', 'add', '-b', `wt-${doneId8}`, doneDir]);
    await backdate(doneDir);

    // Fixture 2: dropped + uncommitted TRACKED edit → refused.
    const droppedTodo = await createTodo(repo, {
      allowOrphan: true, title: 'dropped leaf', ownerSession: 'test', kind: 'leaf', status: 'dropped',
    });
    const droppedId8 = droppedTodo.id.slice(0, 8);
    const droppedDir = join(wm.baseDir(), `leaf-exec-${droppedId8}`);
    await runGit(repo, ['worktree', 'add', '-b', `wt-${droppedId8}`, droppedDir]);
    writeFileSync(join(droppedDir, 'README.md'), 'edited\n');
    await backdate(droppedDir);

    // Fixture 3: done, only untracked file is one that ALSO exists at the same
    // relative path in the main checkout → removed (does not block GC).
    const doneSharedTodo = await createTodo(repo, {
      allowOrphan: true, title: 'done leaf shared file', ownerSession: 'test', kind: 'leaf', status: 'done',
    });
    const doneSharedId8 = doneSharedTodo.id.slice(0, 8);
    const doneSharedDir = join(wm.baseDir(), `leaf-exec-${doneSharedId8}`);
    await runGit(repo, ['worktree', 'add', '-b', `wt-${doneSharedId8}`, doneSharedDir]);
    mkdirSync(join(doneSharedDir, 'docs', 'designs'), { recursive: true });
    writeFileSync(join(doneSharedDir, 'docs', 'designs', 'shared.md'), 'shared (untracked copy)\n');
    await backdate(doneSharedDir);

    // Fixture 4: in_progress → never touched, not even inspected as a git worktree.
    const liveTodo = await createTodo(repo, {
      allowOrphan: true, title: 'live leaf', ownerSession: 'test', kind: 'leaf', status: 'todo',
    });
    const liveId8 = liveTodo.id.slice(0, 8);
    const liveDir = join(wm.baseDir(), `leaf-exec-${liveId8}`);
    mkdirSync(liveDir, { recursive: true });
    await backdate(liveDir);

    const report = await gcLeafWorktrees(repo);

    expect(report.scanned).toBe(4);
    expect(report.removed).toContain(doneDir);
    expect(report.removed).toContain(doneSharedDir);
    expect(report.removed).not.toContain(droppedDir);
    expect(report.removed).not.toContain(liveDir);

    const droppedRefusal = report.refused.find((r) => r.path === droppedDir);
    expect(droppedRefusal).toBeTruthy();
    expect(droppedRefusal!.reason).toBe('uncommitted-tracked-changes');
    expect(droppedRefusal!.sample.length).toBeGreaterThan(0);

    expect(report.refused.find((r) => r.path === liveDir)).toBeFalsy();

    // Post-condition: removed dirs are actually gone from disk and from git's
    // registration; the untouched ones remain.
    expect(existsSync(doneDir)).toBe(false);
    expect(existsSync(doneSharedDir)).toBe(false);
    expect(existsSync(droppedDir)).toBe(true);
    expect(existsSync(liveDir)).toBe(true);

    // Compare by basename, not exact path — `git worktree list` resolves through
    // OS-level symlinks (e.g. macOS /tmp -> /private/tmp), so the printed path
    // need not string-equal the one we passed to `git worktree add`.
    const registeredNames = (await wm.listRegisteredPaths()).map((p) => p.split('/').pop());
    expect(registeredNames).not.toContain(doneDir.split('/').pop());
    expect(registeredNames).not.toContain(doneSharedDir.split('/').pop());
    expect(registeredNames).toContain(droppedDir.split('/').pop());

    const remainingLeafDirs = readdirSync(wm.baseDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('leaf-exec-'))
      .map((e) => join(wm.baseDir(), e.name));
    expect(remainingLeafDirs.sort()).toEqual([droppedDir, liveDir].sort());
  });
});
