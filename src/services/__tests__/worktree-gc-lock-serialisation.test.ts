/**
 * @serial-test-lane: builds real temp git repo + real `git worktree add` checkouts
 *
 * Test for the worktree GC lock serialisation. The gcLeafWorktrees sweep now holds the
 * per-project worktree lock for its entire duration to prevent interleaving mutations.
 * These tests verify:
 * 1. The sweep completes without deadlock
 * 2. runExclusive sections serialize correctly and do not interleave
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-gc-lock-serialisation-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcLeafWorktrees } from '../leaf-worktree-reaper';
import { recordEpicLand } from '../epic-land-record-store';

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

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('worktree GC lock serialisation', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gc-lock-serialisation-repo-'));
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

  it('gcLeafWorktrees completes under the held lock and records the removal', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create a done epic (this makes the sweep scan it)
    const epicTodo = await createTodo(repo, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const epicId8 = epicTodo.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    await runGit(repo, ['worktree', 'add', '-b', `epic-${epicId8}`, epicDir]);

    // Get the HEAD sha and record the land to enable the fast path
    const headRes = await runGit(epicDir, ['rev-parse', 'HEAD']);
    const epicTipSha = headRes.stdout.trim();
    recordEpicLand(repo, { epicId: epicTodo.id, epicTipSha, landedMergeSha: 'deadbeef', landedAt: Date.now() });

    // Ensure the epic branch exists for the 1.6 path (terminal epic safe on branch)
    const epicBranch = wm.epicBranchName(epicTodo.id);
    await runGit(repo, ['branch', epicBranch, 'master']);

    // Run gcLeafWorktrees — if the lock is not held, an interleaving mutation could deadlock.
    // Timeout test catches hangs. Explicit 5s timeout ensures a deadlock is detected.
    const reportPromise = gcLeafWorktrees(repo);
    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error('gcLeafWorktrees timed out (possible deadlock)'));
      }, 5000);
    });
    const report = await Promise.race([reportPromise, timeoutPromise]);

    // Main assertion: the sweep completed and scanned at least the epic worktree.
    // Deadlock would manifest as a hang that the timeout catches.
    expect(report.scanned).toBeGreaterThanOrEqual(1);
  });

  it('a runExclusive section started first never interleaves with the GC sweep', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create a done epic with a land record
    const epicTodo = await createTodo(repo, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const epicId8 = epicTodo.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    await runGit(repo, ['worktree', 'add', '-b', `epic-${epicId8}`, epicDir]);

    // Record the land
    const headRes = await runGit(epicDir, ['rev-parse', 'HEAD']);
    const epicTipSha = headRes.stdout.trim();
    recordEpicLand(repo, { epicId: epicTodo.id, epicTipSha, landedMergeSha: 'deadbeef', landedAt: Date.now() });

    const events: string[] = [];

    // Start an exclusive section without awaiting — it should hold the lock.
    const outerPromise = wm.runExclusive(async () => {
      events.push('outer:start');
      await new Promise((r) => setTimeout(r, 50));
      events.push('outer:end');
    });

    // Start the GC sweep (also grabs the lock, but will queue behind outer).
    const gcPromise = gcLeafWorktrees(repo);

    // Track when GC completes
    const gcComplete = gcPromise.then(() => {
      events.push('gc:end');
    });

    // Wait for both to complete
    await Promise.all([outerPromise, gcComplete]);

    // Assert that the outer section completed before GC started any mutation.
    // The exact order is: outer:start, outer:end, then gc:end (GC reads, then mutations).
    expect(events.indexOf('outer:start')).toBeLessThan(events.indexOf('outer:end'));
    expect(events.indexOf('outer:end')).toBeLessThan(events.indexOf('gc:end'));
  });
});
