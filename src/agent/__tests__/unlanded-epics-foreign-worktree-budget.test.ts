import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager, COLLAB_EPIC_BRANCH_GLOB, _resetUnlandedEpicsCache } from '../worktree-manager.ts';

/**
 * Spawn-budget regression spec for listUnlandedEpics — foreign worktrees must not add
 * git spawns. The scan globs COLLAB_EPIC_BRANCH_GLOB ('collab/epic/*'), which is structurally
 * outside foreign linked worktrees (.claude/worktrees/*, sibling tool directories, etc.).
 * Proves:
 *   1. Baseline: one cold scan on a mixed repo (1 landed, 1 unlanded) costs exactly 4 git spawns.
 *   2. Five foreign worktrees added outside .collab/agent-sessions/worktrees do not increase the spawn count.
 *   3. The scan never issues a `git worktree` subcommand.
 *   4. A sixth collab-owned worktree grows the result and the budget by exactly one rev-list spawn.
 */

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code: code ?? 0, stdout };
}

/** Repo with one LANDED epic branch (merged --no-ff into master) and one UNLANDED
 *  epic branch (one commit ahead). */
async function makeMixedRepo(): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-budget-repo-'));
  await runGit(repo, ['init', '-q', '-b', 'master']);
  await runGit(repo, ['config', 'user.email', 't@t']);
  await runGit(repo, ['config', 'user.name', 'T']);
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'base']);

  // landed epic: branch, commit, --no-ff merge back — the branch stays behind as an ancestor
  await runGit(repo, ['checkout', '-q', '-b', 'collab/epic/1anded00']);
  await fs.writeFile(path.join(repo, 'landed.txt'), 'landed\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'landed work']);
  await runGit(repo, ['checkout', '-q', 'master']);
  await runGit(repo, ['merge', '--no-ff', '-q', '-m', 'land', 'collab/epic/1anded00']);

  // unlanded epic: one commit ahead of master
  await runGit(repo, ['checkout', '-q', '-b', 'collab/epic/un1anded']);
  await fs.writeFile(path.join(repo, 'unlanded.txt'), 'unlanded\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'unlanded work']);
  await runGit(repo, ['checkout', '-q', 'master']);
  return repo;
}

export const EXPECTED_SCAN_SPAWNS = 4;
export const EXPECTED_FOREIGN_WORKTREES = 5;

function makeCountingManager(repo: string, nowRef: { t: number }) {
  const argvs: string[][] = [];
  const spawn = (cmd: string[], so: any) => {
    argvs.push(cmd);
    return (globalThis as any).Bun.spawn(cmd, so);
  };
  const mgr = new WorktreeManager({
    projectRoot: repo,
    baseDir: repo,
    persistDir: repo,
    spawn,
    now: () => nowRef.t,
  });
  return { mgr, argvs };
}

describe('WorktreeManager — listUnlandedEpics spawn budget with foreign worktrees', () => {
  let repo: string;

  beforeEach(async () => {
    _resetUnlandedEpicsCache();
    repo = await makeMixedRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    _resetUnlandedEpicsCache();
  });

  it('baseline: a repo with no foreign worktrees spends exactly EXPECTED_SCAN_SPAWNS', async () => {
    const nowRef = { t: 0 };
    const { mgr, argvs } = makeCountingManager(repo, nowRef);

    const result = await mgr.listUnlandedEpics();

    expect(argvs.length).toBe(EXPECTED_SCAN_SPAWNS);
    expect(result).toEqual([{ branch: 'collab/epic/un1anded', epicId8: 'un1anded', ahead: 1 }]);
  });

  it('five foreign worktrees added outside .collab/agent-sessions/worktrees leave the spawn count IDENTICAL', async () => {
    const nowRef = { t: 0 };
    const { mgr, argvs: baselineArgvs } = makeCountingManager(repo, nowRef);

    const baselineResult = await mgr.listUnlandedEpics();
    const baselineSpawnCount = baselineArgvs.length;
    const baselineEpics = [...baselineResult];

    // Add five foreign worktrees outside .collab/agent-sessions/worktrees
    const foreignDir = await fs.mkdtemp(path.join(os.tmpdir(), 'foreign-wt-'));
    try {
      for (let i = 0; i < EXPECTED_FOREIGN_WORKTREES; i++) {
        await runGit(repo, ['worktree', 'add', '-b', `agent-${i}`, path.join(foreignDir, `agent-${i}`)]);
      }

      // Reset cache and create a fresh counting manager to isolate the spawn count
      _resetUnlandedEpicsCache();
      const { mgr: mgr2, argvs: secondArgvs } = makeCountingManager(repo, nowRef);

      const secondResult = await mgr2.listUnlandedEpics();

      expect(secondArgvs.length).toBe(baselineSpawnCount);
      expect(secondResult).toEqual(baselineEpics);
    } finally {
      await fs.rm(foreignDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('the scan issues no git worktree subcommand at all', async () => {
    const nowRef = { t: 0 };
    const { mgr, argvs } = makeCountingManager(repo, nowRef);

    await mgr.listUnlandedEpics();

    // The git subcommand is at index 3 in the argv: ['git', '-C', cwd, 'subcommand', ...]
    expect(argvs.every((a) => a[3] !== 'worktree')).toBe(true);
  });

  it('mutation probe: a sixth collab-owned worktree grows the result by one epic and the budget by exactly one rev-list', async () => {
    const nowRef = { t: 0 };
    const { mgr, argvs: baselineArgvs } = makeCountingManager(repo, nowRef);

    const baselineResult = await mgr.listUnlandedEpics();
    const baselineSpawnCount = baselineArgvs.length;
    const baselineRevLists = baselineArgvs.filter((a) => a[3] === 'rev-list').length;

    // Create a sixth collab-owned epic branch and worktree
    const sixthBranch = 'collab/epic/6feedbee';
    await runGit(repo, ['checkout', '-q', '-b', sixthBranch]);
    await fs.writeFile(path.join(repo, 'sixth.txt'), 'sixth\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'sixth work']);
    await runGit(repo, ['checkout', '-q', 'master']);

    const collabWorktreeDir = path.join(repo, '.collab/agent-sessions/worktrees/__epic-6feedbee__');
    await fs.mkdir(path.dirname(collabWorktreeDir), { recursive: true });
    await runGit(repo, ['worktree', 'add', '-b', sixthBranch, collabWorktreeDir]);

    // Reset cache and create a fresh counting manager
    _resetUnlandedEpicsCache();
    const { mgr: mgr2, argvs: secondArgvs } = makeCountingManager(repo, nowRef);

    const secondResult = await mgr2.listUnlandedEpics();
    const secondSpawnCount = secondArgvs.length;
    const secondRevLists = secondArgvs.filter((a) => a[3] === 'rev-list').length;

    // Should now have both un1anded and 6feedbee
    expect(secondResult.map((e) => e.epicId8).sort()).toEqual(['6feedbee', 'un1anded']);

    // Spawn count should increase by exactly one (the rev-list for the new branch)
    expect(secondSpawnCount).toBe(baselineSpawnCount + 1);

    // Rev-list count should increase by exactly one
    expect(secondRevLists).toBe(baselineRevLists + 1);
  });
});
