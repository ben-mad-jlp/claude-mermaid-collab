/**
 * Tests for the dropped-epic worktree release sweep (H6a). Builds a real temp git repo
 * with an epic's accumulation worktree, drops the epic, and verifies the sweep:
 * - pristine worktree is removed, branch survives
 * - dirty worktree is kept, friction is recorded
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-epic-drop-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager, releaseDroppedEpicWorktrees, _resetDroppedEpicSweepState } from '../coordinator-live';
import { createTodo, updateTodo, _closeProject } from '../todo-store';
import { listFriction, _closeProject as _closeFrictionProject } from '../friction-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

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

describe('releaseDroppedEpicWorktrees — dropped-epic worktree release (H6a)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'epic-drop-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    _closeFrictionProject(repo);
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test A: pristine dropped epic → worktree gone, branch renamed to collab/dropped/', async () => {
    _resetDroppedEpicSweepState();
    const wm = getWorktreeManager(repo);

    // Create an epic todo
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId = epic.id;
    const branch = wm.epicBranchName(epicId);
    const droppedBranch = branch.replace('collab/epic/', 'collab/dropped/');

    // Ensure the epic accumulation worktree exists
    await wm.ensureEpic(epicId, undefined, 'master');

    // Commit a file on the epic worktree
    const wtPath = wm.epicWorktreePath(epicId);
    writeFileSync(join(wtPath, 'test.txt'), 'test content\n');
    await runGit(wtPath, ['add', '-A']);
    await runGit(wtPath, ['commit', '-q', '-m', 'test commit']);

    // Drop the epic todo
    await updateTodo(repo, epicId, { status: 'dropped' });

    // Run the sweep with force=true
    const released = await releaseDroppedEpicWorktrees(repo, { force: true });

    // Assert: worktree is gone
    expect(existsSync(wtPath)).toBe(false);

    // Assert: branch was renamed to collab/dropped/<id8>
    const droppedCheck = await runGit(repo, ['rev-parse', '--verify', droppedBranch]);
    expect(droppedCheck.code).toBe(0);

    // Assert: original epic branch is gone
    const epicCheck = await runGit(repo, ['rev-parse', '--verify', branch]);
    expect(epicCheck.code).not.toBe(0);

    // Assert: epic id is in released array
    expect(released).toContain(epicId);
  });

  it('test B: dirty dropped epic → worktree kept, friction recorded', async () => {
    _resetDroppedEpicSweepState();
    const wm = getWorktreeManager(repo);

    // Create an epic todo
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'dirty epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId = epic.id;

    // Ensure the epic accumulation worktree exists
    await wm.ensureEpic(epicId, undefined, 'master');

    // Commit a file, then write uncommitted changes
    const wtPath = wm.epicWorktreePath(epicId);
    writeFileSync(join(wtPath, 'tracked.txt'), 'tracked\n');
    await runGit(wtPath, ['add', '-A']);
    await runGit(wtPath, ['commit', '-q', '-m', 'initial']);

    // Make it dirty: edit an already-tracked file
    writeFileSync(join(wtPath, 'tracked.txt'), 'modified\n');

    // Drop the epic todo
    await updateTodo(repo, epicId, { status: 'dropped' });

    // Run the sweep with force=true
    const released = await releaseDroppedEpicWorktrees(repo, { force: true });

    // Assert: worktree still exists
    expect(existsSync(wtPath)).toBe(true);

    // Assert: epic id is NOT in released array
    expect(released).not.toContain(epicId);

    // Assert: friction was recorded
    const frictions = listFriction(repo, { todoId: epicId });
    expect(frictions.length).toBeGreaterThan(0);

    const frictionNote = frictions.find((f) => f.retryReason === 'dropped-epic-worktree-dirty');
    expect(frictionNote).toBeTruthy();
    expect(frictionNote!.detail).toContain('dirty');
  });

  it('test C: dropped epic with commits → branch renamed to collab/dropped/, not counted as unlanded', async () => {
    _resetDroppedEpicSweepState();
    const wm = getWorktreeManager(repo);

    // Create an epic todo
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'epic to be dropped',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId = epic.id;
    const branch = wm.epicBranchName(epicId);
    const droppedBranch = branch.replace('collab/epic/', 'collab/dropped/');

    // Ensure the epic accumulation worktree exists
    await wm.ensureEpic(epicId, undefined, 'master');

    // Commit a file on the epic worktree so the branch is ahead of master
    const wtPath = wm.epicWorktreePath(epicId);
    writeFileSync(join(wtPath, 'epic-work.txt'), 'work done\n');
    await runGit(wtPath, ['add', '-A']);
    await runGit(wtPath, ['commit', '-q', '-m', 'epic work']);

    // Drop the epic todo
    await updateTodo(repo, epicId, { status: 'dropped' });

    // Run the sweep with force=true
    const released = await releaseDroppedEpicWorktrees(repo, { force: true });

    // Assert (a): listUnlandedEpics() does NOT include the epic's id8
    const unlanded = await wm.listUnlandedEpics();
    const id8 = branch.replace('collab/epic/', '');
    expect(unlanded.map((e) => e.epicId8)).not.toContain(id8);

    // Assert (b): collab/dropped/<id8> EXISTS (commits preserved)
    const droppedCheck = await runGit(repo, ['rev-parse', '--verify', droppedBranch]);
    expect(droppedCheck.code).toBe(0);

    // Assert (c): collab/epic/<id8> no longer exists
    const epicCheck = await runGit(repo, ['rev-parse', '--verify', branch]);
    expect(epicCheck.code).not.toBe(0);

    // Assert: epic id is in released array
    expect(released).toContain(epicId);
  });

  it('test D: worktree already gone but branch survives → branch archived independently (BUG 2ab6668b)', async () => {
    _resetDroppedEpicSweepState();
    const wm = getWorktreeManager(repo);

    // Create an epic todo
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'epic whose worktree was already reclaimed',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId = epic.id;
    const branch = wm.epicBranchName(epicId);
    const droppedBranch = branch.replace('collab/epic/', 'collab/dropped/');

    // Ensure the epic accumulation worktree exists, add a commit so the branch
    // is ahead of master (would show in listUnlandedEpics if not archived).
    await wm.ensureEpic(epicId, undefined, 'master');
    const wtPath = wm.epicWorktreePath(epicId);
    writeFileSync(join(wtPath, 'epic-work.txt'), 'work\n');
    await runGit(wtPath, ['add', '-A']);
    await runGit(wtPath, ['commit', '-q', '-m', 'epic work']);

    // Simulate the worktree having ALREADY been reclaimed earlier: remove the
    // checkout dir but KEEP the branch. statusAt(wtPath) now returns null.
    await wm.removeEpicWorktree(epicId, { keepBranch: true });
    expect(existsSync(wtPath)).toBe(false);
    expect(await wm.statusAt(wtPath)).toBe(null);
    // Branch is still present, ahead of master → would strand in listUnlandedEpics.
    const preCheck = await runGit(repo, ['rev-parse', '--verify', branch]);
    expect(preCheck.code).toBe(0);

    // Drop the epic todo
    await updateTodo(repo, epicId, { status: 'dropped' });

    // Run the sweep with force=true
    const released = await releaseDroppedEpicWorktrees(repo, { force: true });

    // Assert (a): the branch was archived even though the worktree was gone.
    const droppedCheck = await runGit(repo, ['rev-parse', '--verify', droppedBranch]);
    expect(droppedCheck.code).toBe(0);

    // Assert (b): the original collab/epic/<id8> branch no longer exists.
    const epicCheck = await runGit(repo, ['rev-parse', '--verify', branch]);
    expect(epicCheck.code).not.toBe(0);

    // Assert (c): the epic no longer appears in listUnlandedEpics().
    const unlanded = await wm.listUnlandedEpics();
    const id8 = branch.replace('collab/epic/', '');
    expect(unlanded.map((e) => e.epicId8)).not.toContain(id8);

    // Assert (d): the epic id is reported in the released array.
    expect(released).toContain(epicId);
  });
});
