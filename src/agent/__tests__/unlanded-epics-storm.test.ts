import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager, UNLANDED_EPICS_TTL_MS, _resetUnlandedEpicsCache } from '../worktree-manager.ts';

/**
 * Storm-shape regression spec for listUnlandedEpics (sidecar-pin feedback loop,
 * friction c07c7ab3 / bucket 9b0563bf): during a WS reconnect storm the Bridge hit
 * the unlanded-epics endpoint many times a second, and every cache miss ran a full
 * O(branches) git scan — feeding the server busyness that caused the drops. Proves:
 *   1. CONCURRENT callers on a cold cache share ONE scan (in-flight coalescing).
 *   2. A STALE cache answers immediately (stale-while-revalidate) while one shared
 *      background scan refreshes it.
 *   3. Branches already merged into trunk (every --no-ff-landed epic leaves one)
 *      cost zero per-branch rev-list spawns.
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
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-storm-repo-'));
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

function makeCountingManager(repo: string, nowRef: { t: number }) {
  let scans = 0; // branch --list spawns = full-scan count
  let revLists = 0; // per-branch ahead probes
  const spawn = (cmd: string[], so: any) => {
    if (cmd.includes('branch') && cmd.includes('--list')) scans += 1;
    if (cmd.includes('rev-list') && cmd.includes('--cherry-pick')) revLists += 1;
    return (globalThis as any).Bun.spawn(cmd, so);
  };
  const mgr = new WorktreeManager({
    projectRoot: repo,
    baseDir: repo,
    persistDir: repo,
    spawn,
    now: () => nowRef.t,
  });
  return { mgr, scans: () => scans, revLists: () => revLists };
}

describe('WorktreeManager — listUnlandedEpics under storm load', () => {
  let repo: string;

  beforeEach(async () => {
    _resetUnlandedEpicsCache();
    repo = await makeMixedRepo();
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    _resetUnlandedEpicsCache();
  });

  it('ten CONCURRENT cold-cache callers share one scan and agree on the result', async () => {
    const nowRef = { t: 0 };
    const { mgr, scans } = makeCountingManager(repo, nowRef);

    const results = await Promise.all(Array.from({ length: 10 }, () => mgr.listUnlandedEpics()));

    expect(scans()).toBe(1);
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toEqual([{ branch: 'collab/epic/un1anded', epicId8: 'un1anded', ahead: 1 }]);
  });

  it('a stale cache answers immediately from the stale value while one background scan refreshes it', async () => {
    const nowRef = { t: 0 };
    const { mgr, scans } = makeCountingManager(repo, nowRef);

    const first = await mgr.listUnlandedEpics();
    expect(scans()).toBe(1);

    nowRef.t += UNLANDED_EPICS_TTL_MS + 1;
    // Burst of stale-cache callers: all answer NOW from the stale value, one shared refresh runs.
    const burst = await Promise.all(Array.from({ length: 5 }, () => mgr.listUnlandedEpics()));
    for (const r of burst) expect(r).toEqual(first);
    // Let the shared background refresh settle, then confirm exactly one more scan ran.
    await new Promise((res) => setTimeout(res, 500));
    expect(scans()).toBe(2);

    // The refresh repopulated the cache: the next call is a fresh hit, no new scan.
    const after = await mgr.listUnlandedEpics();
    expect(after).toEqual(first);
    expect(scans()).toBe(2);
  });

  it('a landed (merged) epic branch costs zero per-branch rev-list probes', async () => {
    const nowRef = { t: 0 };
    const { mgr, revLists } = makeCountingManager(repo, nowRef);

    const out = await mgr.listUnlandedEpics();

    // Two collab/epic/* branches exist, but only the unlanded one is probed.
    expect(out.map((e) => e.epicId8)).toEqual(['un1anded']);
    expect(revLists()).toBe(1);
  });
});
