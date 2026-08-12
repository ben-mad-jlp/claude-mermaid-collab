import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager, UNLANDED_EPICS_TTL_MS, _resetUnlandedEpicsCache } from '../worktree-manager.ts';

/**
 * design-epic-landing memo — listUnlandedEpics does one `branch --list` plus one
 * `rev-list --cherry-pick` child process PER branch on every call. This proves a
 * per-(projectRoot, baseRef) TTL memo collapses a burst of callers into one branch
 * walk, keeps projects isolated, and re-walks once the TTL expires.
 */

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code: code ?? 0, stdout, stderr };
}

/** Init a temp repo with a base commit on master, then an epic branch carrying one
 *  commit ahead of it. */
async function makeEpicRepo(epicId8: string): Promise<string> {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-memo-repo-'));
  await runGit(repo, ['init', '-q', '-b', 'master']);
  await runGit(repo, ['config', 'user.email', 't@t']);
  await runGit(repo, ['config', 'user.name', 'T']);
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', 'base']);

  const branch = `collab/epic/${epicId8}`;
  await runGit(repo, ['checkout', '-q', '-b', branch]);
  await fs.writeFile(path.join(repo, `${epicId8}.txt`), 'leaf work\n');
  await runGit(repo, ['add', '-A']);
  await runGit(repo, ['commit', '-q', '-m', `epic ${epicId8} work`]);
  await runGit(repo, ['checkout', '-q', 'master']);

  return repo;
}

function makeCountingManager(repo: string, nowRef: { t: number }): { mgr: WorktreeManager; revListCalls: () => number } {
  let count = 0;
  const spawn = (cmd: string[], so: any) => {
    if (cmd.includes('rev-list') && cmd.includes('--cherry-pick')) count += 1;
    return (globalThis as any).Bun.spawn(cmd, so);
  };
  const mgr = new WorktreeManager({
    projectRoot: repo,
    baseDir: repo,
    persistDir: repo,
    spawn,
    now: () => nowRef.t,
  });
  return { mgr, revListCalls: () => count };
}

describe('WorktreeManager — listUnlandedEpics TTL memo', () => {
  let repoA: string;
  let repoB: string;

  beforeEach(async () => {
    _resetUnlandedEpicsCache();
    repoA = await makeEpicRepo('aaaaaaaa');
    repoB = await makeEpicRepo('bbbbbbbb');
  });

  afterEach(async () => {
    await fs.rm(repoA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(repoB, { recursive: true, force: true }).catch(() => {});
    _resetUnlandedEpicsCache();
  });

  it('a burst of calls on one project inside the TTL window performs one branch walk and returns identical results', async () => {
    const nowRef = { t: 0 };
    const { mgr, revListCalls } = makeCountingManager(repoA, nowRef);

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await mgr.listUnlandedEpics());
    }

    expect(revListCalls()).toBe(1);
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
    expect(results[0]).toEqual([{ branch: 'collab/epic/aaaaaaaa', epicId8: 'aaaaaaaa', ahead: 1 }]);
  });

  it("a second project's first call returns its own epics and never reads another project's cache entry", async () => {
    const nowRefA = { t: 0 };
    const nowRefB = { t: 0 };
    const { mgr: mgrA } = makeCountingManager(repoA, nowRefA);
    const { mgr: mgrB, revListCalls: revListCallsB } = makeCountingManager(repoB, nowRefB);

    await mgrA.listUnlandedEpics();
    const resultB = await mgrB.listUnlandedEpics();

    expect(revListCallsB()).toBe(1);
    expect(resultB.some((e) => e.epicId8 === 'bbbbbbbb')).toBe(true);
    expect(resultB.some((e) => e.epicId8 === 'aaaaaaaa')).toBe(false);
  });

  it('advancing the clock past the TTL triggers a fresh branch walk (in the background — stale-while-revalidate)', async () => {
    const nowRef = { t: 0 };
    const { mgr, revListCalls } = makeCountingManager(repoA, nowRef);

    await mgr.listUnlandedEpics();
    expect(revListCalls()).toBe(1);

    await mgr.listUnlandedEpics();
    expect(revListCalls()).toBe(1);

    nowRef.t += UNLANDED_EPICS_TTL_MS + 1;
    // SWR: the stale entry answers this call immediately; the fresh walk runs as a
    // shared background refresh, so we wait for it to settle before counting.
    await mgr.listUnlandedEpics();
    await new Promise((res) => setTimeout(res, 500));
    expect(revListCalls()).toBe(2);
  });
});
