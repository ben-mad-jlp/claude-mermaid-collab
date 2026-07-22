import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

/**
 * FBPE P4 — the land click. landEpicToMaster performs ONE --no-ff epic→master merge
 * in a throwaway detached master checkout, then advances the master ref via a CAS
 * update-ref. A conflict aborts and leaves master UNTOUCHED. removeEpic tears down the
 * epic branch + worktree after a successful land. These run against REAL git in a temp
 * repo (hermetic + fast).
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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const EPIC = 'epic-aaaaaaaa';

describe('WorktreeManager — landEpicToMaster + removeEpic (FBPE P4)', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-land-repo-'));
    // Master is the land target — init the repo's default branch as master.
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-land-persist-'));
    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: path.join(persistDir, 'worktrees'),
      persistDir,
    });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  /** Create the epic branch + worktree and commit `file`=`content` on it. */
  async function epicWith(file: string, content: string) {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    expect(epic).not.toBeNull();
    await fs.writeFile(path.join(epic!.path, file), content);
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', `epic: add ${file}`]);
    return epic!;
  }

  it('lands a clean epic onto master with one --no-ff merge and advances master', async () => {
    await epicWith('feature.txt', 'epic-output\n');
    const beforeSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.conflict).toBe(false);
    expect(res.landed).toBe(true);
    expect(res.masterSha).toBeTruthy();

    // master advanced to the merge commit and now carries the epic's output.
    const afterSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();
    expect(afterSha).toBe(res.masterSha!);
    expect(afterSha).not.toBe(beforeSha);
    expect((await runGit(repo, ['show', 'master:feature.txt'])).stdout).toBe('epic-output\n');

    // --no-ff → master HEAD is a merge commit (two parents).
    const parents = (await runGit(repo, ['rev-list', '--parents', '-n', '1', 'master'])).stdout.trim().split(/\s+/);
    expect(parents.length).toBe(3);

    // The throwaway land worktree was torn down.
    expect(await exists(path.join(persistDir, 'worktrees', '__land-master__'))).toBe(false);
  });

  it('P0 0949289b Part 2: syncs the on-master checkout to the land commit (write-tree == HEAD^{tree}, content on disk)', async () => {
    await epicWith('feature.txt', 'epic-output\n');
    // The checkout is on master and the epic's file is NOT yet on disk (pre-land content).
    expect(await exists(path.join(repo, 'feature.txt'))).toBe(false);

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.landed).toBe(true);
    expect(res.treeSynced).toBe('reset-hard');

    // Before the Part-2 fix, `update-ref` advanced master while THIS checkout's index + working
    // tree stayed at the pre-land content → `git write-tree` (index) != `HEAD^{tree}`, and a
    // deploy would build the stale tree (the 5-hour silent-failure class). The source-side sync
    // must leave them equal and the landed file present ON DISK.
    const writeTree = (await runGit(repo, ['write-tree'])).stdout.trim();
    const headTree = (await runGit(repo, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    expect(writeTree).toBe(headTree);
    expect(await fs.readFile(path.join(repo, 'feature.txt'), 'utf8')).toBe('epic-output\n');
  });

  it('leaves master UNTOUCHED on a conflicting epic and reports conflict', async () => {
    await epicWith('clash.txt', 'epic-side\n');
    // Diverge master on the SAME file so the merge conflicts.
    await fs.writeFile(path.join(repo, 'clash.txt'), 'master-side\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master: clash']);
    const beforeSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.landed).toBe(false);
    expect(res.conflict).toBe(true);

    // master ref is exactly where it was — untouched.
    const afterSha = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();
    expect(afterSha).toBe(beforeSha);
    // No mid-merge state lingering in the main tree.
    expect(await exists(path.join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
  });

  it('auto-resolves a lockfile-ONLY conflict (takes the epic side) and lands', async () => {
    // base carries a lockfile both sides will diverge on.
    await fs.writeFile(path.join(repo, 'bun.lock'), 'base-lock\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base lock']);
    // epic edits the lockfile AND adds a clean source file.
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    await fs.writeFile(path.join(epic!.path, 'bun.lock'), 'epic-lock\n');
    await fs.writeFile(path.join(epic!.path, 'feat.txt'), 'feat\n');
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', 'epic: lock + feat']);
    // master diverges on the SAME lockfile → a raw merge would conflict.
    await fs.writeFile(path.join(repo, 'bun.lock'), 'master-lock\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master: lock']);

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.conflict).toBe(false);
    expect(res.landed).toBe(true);
    // lockfile resolved to the EPIC side; the clean source change landed too.
    expect((await runGit(repo, ['show', 'master:bun.lock'])).stdout).toBe('epic-lock\n');
    expect((await runGit(repo, ['show', 'master:feat.txt'])).stdout).toBe('feat\n');
    expect(await exists(path.join(persistDir, 'worktrees', '__land-master__'))).toBe(false);
  });

  it('does NOT auto-resolve when a NON-lockfile also conflicts — aborts, master untouched', async () => {
    await fs.writeFile(path.join(repo, 'bun.lock'), 'base-lock\n');
    await fs.writeFile(path.join(repo, 'src.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    await fs.writeFile(path.join(epic!.path, 'bun.lock'), 'epic-lock\n');
    await fs.writeFile(path.join(epic!.path, 'src.txt'), 'epic-src\n');
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', 'epic']);
    await fs.writeFile(path.join(repo, 'bun.lock'), 'master-lock\n');
    await fs.writeFile(path.join(repo, 'src.txt'), 'master-src\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master']);
    const before = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();

    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.landed).toBe(false);
    expect(res.conflict).toBe(true);
    expect((await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim()).toBe(before);
  });

  it('skips post-land tree sync when real dirty work is present: leaves checkout untouched', async () => {
    await epicWith('feature.txt', 'epic-output\n');

    // Capture pre-land state: file is not on disk yet.
    expect(await exists(path.join(repo, 'feature.txt'))).toBe(false);

    // Leave real tracked uncommitted work in repo: modify base.txt and stage it.
    await fs.writeFile(path.join(repo, 'base.txt'), 'base-modified\n');
    await runGit(repo, ['add', 'base.txt']);

    // Verify pre-condition: repo is dirty (has staged work).
    const statusBefore = await runGit(repo, ['status', '--porcelain']);
    expect(statusBefore.stdout).toContain('M  base.txt');

    // Capture the base.txt content before land (dirty-state marker).
    const baseContentBefore = await fs.readFile(path.join(repo, 'base.txt'), 'utf8');
    expect(baseContentBefore).toBe('base-modified\n');

    // Land the epic over the dirty work with progress monitoring.
    const progress: Array<{ channel: string; msg: string }> = [];
    const res = await mgr.landEpicToMaster(EPIC, {
      onProgress: (channel, msg) => progress.push({ channel, msg }),
    });
    expect(res.landed).toBe(true);
    expect(res.treeSynced).toBe('skipped-dirty');

    // Invariant: master advanced to the land commit.
    const masterSha = res.masterSha!;
    const currentMaster = (await runGit(repo, ['rev-parse', 'refs/heads/master'])).stdout.trim();
    expect(currentMaster).toBe(masterSha);

    // Invariant: the pre-land dirty content (base.txt modified) is UNCHANGED on disk.
    // The main checkout was left untouched (not synced) so it still has the stale tree.
    const baseContentAfter = await fs.readFile(path.join(repo, 'base.txt'), 'utf8');
    expect(baseContentAfter).toBe('base-modified\n');

    // Note: the epic's file is NOT on disk because the tree sync was skipped.
    // The checkout remains stale (write-tree !== HEAD^{tree}), preserving uncommitted work.
    // This is the safety guarantee: never reset when dirty work is present.

    // Invariant: onProgress received a message naming the dirty path and indicating skip.
    const stderrMessages = progress.filter((p) => p.channel === 'stderr');
    expect(stderrMessages.length).toBeGreaterThan(0);
    const skipMsg = stderrMessages.find((m) => m.msg.includes('base.txt'));
    expect(skipMsg).toBeTruthy();
    expect(skipMsg?.msg).toContain('skipped');

    // Throwaway land worktree was torn down.
    expect(await exists(path.join(persistDir, 'worktrees', '__land-master__'))).toBe(false);
  });

  it('removeEpic deletes the epic branch + worktree (idempotent)', async () => {
    const epic = await epicWith('x.txt', 'x\n');
    await mgr.landEpicToMaster(EPIC);

    await mgr.removeEpic(EPIC);
    expect((await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${epic.branch}`])).code).not.toBe(0);
    expect(await exists(epic.path)).toBe(false);

    // Idempotent — a second call is a no-op, never throws.
    await mgr.removeEpic(EPIC);
  });

  it('reports a missing epic branch without touching master', async () => {
    const res = await mgr.landEpicToMaster('epic-nonexistent');
    expect(res.landed).toBe(false);
    expect(res.conflict).toBe(false);
    expect(res.reason).toContain('epic-branch-missing');
  });

  it('epicBehindBase flags how many commits master is ahead of the epic base (no rebase)', async () => {
    const epic = await epicWith('feature.txt', 'epic-output\n');

    // Fresh epic branched off master tip → not behind.
    expect(await mgr.epicBehindBase(EPIC)).toBe(0);

    // Advance master twice AFTER the epic branched.
    await fs.writeFile(path.join(repo, 'm1.txt'), '1\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master move 1']);
    await fs.writeFile(path.join(repo, 'm2.txt'), '2\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'master move 2']);

    // Epic is now 2 commits behind master — FLAG only, the branch is untouched.
    expect(await mgr.epicBehindBase(EPIC)).toBe(2);
    const epicHeadBefore = (await runGit(epic.path, ['rev-parse', 'HEAD'])).stdout.trim();
    await mgr.epicBehindBase(EPIC); // idempotent read — never mutates
    expect((await runGit(epic.path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(epicHeadBefore);
  });

  it('epicBehindBase returns 0 for a missing epic branch', async () => {
    expect(await mgr.epicBehindBase('epic-nonexistent')).toBe(0);
  });

  it('epicAheadOfMaster counts UNLANDED commits and drops to 0 after landing', async () => {
    await epicWith('feature.txt', 'epic-output\n');
    // One accepted commit on the epic branch, not yet on master.
    expect(await mgr.epicAheadOfMaster(EPIC)).toBe(1);

    await mgr.landEpicToMaster(EPIC);
    // After landing, master contains the epic → nothing ahead.
    expect(await mgr.epicAheadOfMaster(EPIC)).toBe(0);
  });

  it('epicAheadOfMaster returns 0 for a missing epic branch', async () => {
    expect(await mgr.epicAheadOfMaster('epic-nonexistent')).toBe(0);
  });

  it('listUnlandedEpics surfaces epics ahead of master, excludes landed ones', async () => {
    await epicWith('feature.txt', 'epic-output\n');
    const before = await mgr.listUnlandedEpics();
    expect(before.length).toBe(1);
    expect(before[0].branch).toBe('collab/epic/epic-aaa');
    expect(before[0].ahead).toBe(1);

    await mgr.landEpicToMaster(EPIC);
    // Branch still exists until removeEpic, but it's no longer ahead → excluded.
    const after = await mgr.listUnlandedEpics();
    expect(after.find((e) => e.branch === 'collab/epic/epic-aaa')).toBeUndefined();
  });
});
