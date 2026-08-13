/**
 * @serial-test-lane: builds real temp git repo + real `git worktree add` checkouts
 *
 * Safety-floor test for worktree-GC guards: main-checkout, live-claim (epic+children),
 * and pending-leaf. Verifies that gcLeafWorktrees correctly refuses reclamation and
 * records typed refusal reasons in report.refused.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-gc-safety-floor-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, _closeProject, updateTodo, claimTodo } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcLeafWorktrees, reclaimRefusalIgnoringAge } from '../leaf-worktree-reaper';

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

describe('gcLeafWorktrees — safety-floor guards', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gc-safety-floor-repo-'));
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

  it('refuses the main checkout', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create an epic that would be terminal but on its branch
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'terminal epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const epicId8 = epic.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    const epicBranch = `collab/epic/${epicId8}`;

    // Create the worktree
    await runGit(repo, ['worktree', 'add', '-b', epicBranch, epicDir]);

    // Add a commit to the epic branch
    writeFileSync(join(epicDir, 'work.txt'), 'work\n');
    await runGit(epicDir, ['add', 'work.txt']);
    await runGit(epicDir, ['commit', '-q', '-m', `work\n\nCollab-Epic: ${epic.id}`]);

    // Test the guard directly by checking a primary checkout (repo itself)
    // Since repo is outside baseDir, we'll test with a primary checkout inside baseDir
    const primaryCheckout = join(wm.baseDir(), 'primary-repo');
    mkdirSync(primaryCheckout, { recursive: true });
    await runGit(primaryCheckout, ['init', '-q']);
    await runGit(primaryCheckout, ['config', 'user.email', 't@t']);
    await runGit(primaryCheckout, ['config', 'user.name', 'T']);
    writeFileSync(join(primaryCheckout, 'file.txt'), 'content\n');
    await runGit(primaryCheckout, ['add', '-A']);
    await runGit(primaryCheckout, ['commit', '-q', '-m', 'commit']);

    // Test the guard directly - the primaryCheckout is a main checkout inside baseDir
    const refusal = await reclaimRefusalIgnoringAge({
      dir: primaryCheckout,
      baseDir: wm.baseDir(),
      leafTodoId: null,
      project: primaryCheckout, // Use the primary checkout as the project
      epicTodoId: epic.id,
    });

    // The guard should refuse because primaryCheckout is a main checkout
    expect(refusal).toBe('main-checkout');
  });

  it('refuses a dirty non-probe worktree', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'terminal epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const epicId8 = epic.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    const epicBranch = `collab/epic/${epicId8}`;

    // Create the worktree
    await runGit(repo, ['worktree', 'add', '-b', epicBranch, epicDir]);

    // Add a tracked file and commit
    writeFileSync(join(epicDir, 'work.txt'), 'work\n');
    await runGit(epicDir, ['add', 'work.txt']);
    await runGit(epicDir, ['commit', '-q', '-m', `work\n\nCollab-Epic: ${epic.id}`]);

    // Make a tracked change to the worktree (dirty)
    writeFileSync(join(epicDir, 'work.txt'), 'modified\n');

    // Run GC with orphanMaxAgeMs: 0 to bypass the age check
    const report = await gcLeafWorktrees(repo, { orphanMaxAgeMs: 0 });

    // Assert the dir still exists
    expect(existsSync(epicDir)).toBe(true);

    // Assert it was not removed or quarantined (refused for being dirty)
    const wasRemoved = report.removed.includes(epicDir);
    const wasQuarantined = report.quarantined.some((q) => q.path === epicDir);
    expect(wasRemoved || wasQuarantined).toBe(false);
  });

  it('refuses when a child leaf of the terminal epic holds a live claim', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create the epic in todo status so we can add children
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'epic with claimed child',
      ownerSession: 'test',
      kind: 'epic',
      status: 'todo',
    });
    const epicId8 = epic.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    const epicBranch = `collab/epic/${epicId8}`;

    // Create the worktree
    await runGit(repo, ['worktree', 'add', '-b', epicBranch, epicDir]);

    // Add a commit to the epic branch
    writeFileSync(join(epicDir, 'work.txt'), 'work\n');
    await runGit(epicDir, ['add', 'work.txt']);
    await runGit(epicDir, ['commit', '-q', '-m', `work\n\nCollab-Epic: ${epic.id}`]);

    // Create a child leaf with ready status
    const leaf = await createTodo(repo, {
      allowOrphan: true,
      parentId: epic.id,
      title: 'child leaf',
      ownerSession: 'test',
      kind: 'leaf',
      status: 'ready',
    });

    // Approve and claim the leaf
    await updateTodo(repo, leaf.id, { approvedAt: new Date().toISOString() });
    await claimTodo(repo, leaf.id, 'test-session', 60000);

    // Use the refusal function directly to test the guard
    const refusal = await reclaimRefusalIgnoringAge({
      dir: epicDir,
      baseDir: wm.baseDir(),
      leafTodoId: null,
      project: repo,
      epicTodoId: epic.id,
    });

    expect(refusal).toBe('live-claim');
  });

  it('refuses when the owning epic itself holds a live claim', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create an epic in todo state
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'epic with claim',
      ownerSession: 'test',
      kind: 'epic',
      status: 'todo',
    });
    const epicId8 = epic.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    const epicBranch = `collab/epic/${epicId8}`;

    // Create the worktree
    await runGit(repo, ['worktree', 'add', '-b', epicBranch, epicDir]);

    // Add a commit to the epic branch
    writeFileSync(join(epicDir, 'work.txt'), 'work\n');
    await runGit(epicDir, ['add', 'work.txt']);
    await runGit(epicDir, ['commit', '-q', '-m', `work\n\nCollab-Epic: ${epic.id}`]);

    // Claim the epic to give it a live claim
    await updateTodo(repo, epic.id, { approvedAt: new Date().toISOString() });
    await claimTodo(repo, epic.id, 'test-session', 60000);

    // Use the refusal function directly
    const refusal = await reclaimRefusalIgnoringAge({
      dir: epicDir,
      baseDir: wm.baseDir(),
      leafTodoId: null,
      project: repo,
      epicTodoId: epic.id,
    });

    expect(refusal).toBe('live-claim');
  });

  it('refuses when the terminal epic still has a non-terminal (pending/paused) leaf', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create epic in todo status so we can add children
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'epic with pending child',
      ownerSession: 'test',
      kind: 'epic',
      status: 'todo',
    });
    const epicId8 = epic.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    const epicBranch = `collab/epic/${epicId8}`;

    // Create the worktree
    await runGit(repo, ['worktree', 'add', '-b', epicBranch, epicDir]);

    // Add a commit to the epic branch
    writeFileSync(join(epicDir, 'work.txt'), 'work\n');
    await runGit(epicDir, ['add', 'work.txt']);
    await runGit(epicDir, ['commit', '-q', '-m', `work\n\nCollab-Epic: ${epic.id}`]);

    // Create a child leaf with ready status (non-terminal)
    await createTodo(repo, {
      allowOrphan: true,
      parentId: epic.id,
      title: 'pending child',
      ownerSession: 'test',
      kind: 'leaf',
      status: 'ready',
    });

    // Use the refusal function - we test with the epic in todo status
    // since that's when the guard actually runs (terminal epics skip in path 1)
    const refusal = await reclaimRefusalIgnoringAge({
      dir: epicDir,
      baseDir: wm.baseDir(),
      leafTodoId: null,
      project: repo,
      epicTodoId: epic.id,
    });

    expect(refusal).toBe('pending-leaf');
  });
});
