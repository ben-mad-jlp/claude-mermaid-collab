/**
 * Regression tests for epic-branch rename/delete surviving a missing worktree (root cause: out-of-band rm -rf).
 * Tests verify that git worktree prune is called before git branch -m/branch -D to clear stale admin entries.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-epic-cleanup-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, updateTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcEpicBranches, BranchGcRunner } from '../landed-epic-sweep';
import { type GitProbe, epicBranchName, epicId8 } from '../epic-branch-status';

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

beforeEach(() => { _closeSupervisorDb(); });
afterEach(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('epic-branch cleanup with missing worktrees', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'epic-cleanup-repo-'));
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

  it('rename survives a gone worktree', async () => {
    const wm = getWorktreeManager(repo);

    // Create and ensure an epic
    const epic = await createTodo(repo, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId = epic.id;
    const branch = epicBranchName(epicId);
    const droppedBranch = `collab/dropped/${epicId8(epicId)}`;

    await wm.ensureEpic(epicId, undefined, 'master');

    // Commit on the epic's worktree
    const wtPath = wm.epicWorktreePath(epicId);
    writeFileSync(join(wtPath, 'test.txt'), 'test\n');
    await runGit(wtPath, ['add', '-A']);
    await runGit(wtPath, ['commit', '-q', '-m', 'test commit']);

    // Remove the worktree dir out-of-band (simulate rm -rf), leaving git admin entry stale
    rmSync(wtPath, { recursive: true, force: true });

    // Verify the stale entry is visible to git before the fix
    const preList = await runGit(repo, ['worktree', 'list', '--porcelain']);
    expect(preList.stdout).toContain(wtPath);

    // The rename should succeed (prune clears the stale entry before branch -m)
    const result = await wm.renameEpicBranchToDropped(epicId);
    expect(result).toBe(true);

    // Verify the dropped branch exists and the source branch is gone
    const droppedCheck = await runGit(repo, ['rev-parse', '--verify', droppedBranch]);
    expect(droppedCheck.code).toBe(0);

    const sourceCheck = await runGit(repo, ['rev-parse', '--verify', branch]);
    expect(sourceCheck.code).not.toBe(0);
  });

  it('orphan-arm delete survives a gone worktree and appends recovery log', async () => {
    // Simulate an orphan branch (no epic todo) with a gone worktree
    const orphanBranch = 'collab/epic/deadbeef';
    const orphanSha = 'cafe123456789abc';

    const order: string[] = [];
    const pruneCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => orphanSha,
      deleteBranch: (b) => {
        order.push('delete:' + b);
        return true;
      },
      listEpicBranches: () => [orphanBranch],
      aheadCount: (b) => {
        // Simulate finding ahead count for an orphan with a gone worktree
        return b === orphanBranch ? 0 : -1;
      },
      pruneWorktreeFor: (b) => {
        pruneCalls.push(b);
        order.push('prune:' + b);
      },
    };

    const probe: GitProbe = () => ({ exists: false, ahead: null, behind: null, mergeable: null });

    const result = gcEpicBranches(repo, { probe, runner });

    // Verify the orphan branch was deleted
    expect(result.deleted).toContain(orphanBranch);
    expect(result.flagged).not.toContain(orphanBranch);

    // Verify prune was called before delete
    expect(order).toEqual([`prune:${orphanBranch}`, `delete:${orphanBranch}`]);
    expect(pruneCalls).toContain(orphanBranch);

    // Verify recovery log was written
    const logPath = join(repo, '.collab', 'pruned-branches-recovery.md');
    expect(existsSync(logPath)).toBe(true);
    const logContent = (await (globalThis as any).Bun.file(logPath).text()).toString();
    expect(logContent).toContain(orphanBranch);
    expect(logContent).toContain(orphanSha);
  });

  it('ahead>0 orphan branch with gone worktree is flagged, never deleted', async () => {
    // Simulate an orphan branch with ahead>0 (unlanded commits) and a gone worktree
    const orphanBranch = 'collab/epic/feed0000';

    const order: string[] = [];
    const deleteCalls: string[] = [];
    const runner: BranchGcRunner = {
      revParse: () => 'feed0000' + 'abc',
      deleteBranch: (b) => {
        deleteCalls.push(b);
        order.push('delete:' + b);
        return true;
      },
      listEpicBranches: () => [orphanBranch],
      aheadCount: (b) => {
        // Return ahead>0 for the orphan branch (never delete, only flag)
        return b === orphanBranch ? 5 : -1;
      },
      pruneWorktreeFor: (b) => {
        order.push('prune:' + b);
      },
    };

    const probe: GitProbe = () => ({ exists: false, ahead: null, behind: null, mergeable: null });

    const result = gcEpicBranches(repo, { probe, runner });

    // Verify the branch was flagged but NOT deleted
    expect(result.flagged).toContain(orphanBranch);
    expect(result.deleted).not.toContain(orphanBranch);

    // Verify no delete or prune operations were performed
    expect(deleteCalls).toHaveLength(0);
    expect(order).toHaveLength(0);

    // Verify no recovery log was written
    const logPath = join(repo, '.collab', 'pruned-branches-recovery.md');
    expect(existsSync(logPath)).toBe(false);
  });
});
