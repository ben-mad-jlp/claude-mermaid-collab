import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager, INBOX_EPIC_ID } from '../worktree-manager.ts';

/**
 * DOGFOOD #5 — worker write-isolation via the epic-branch recombination model
 * (FBPE P1: the synthetic single Inbox epic, accumulation branch collab/epic/inbox).
 * These run against REAL git in a temp repo (no INTEGRATION gating: they are
 * hermetic and fast). They prove the two properties the design requires:
 *   1. accepted worker output lands on the shared Inbox-epic branch; and
 *   2. dependent-todo data-flow is preserved — a worker branched off the epic
 *      AFTER a dep merged sees the dep's committed output (the regression a naive
 *      per-lane-worktree fix would introduce).
 */

/** The Inbox-epic accumulation branch — what ensureEpic(INBOX_EPIC_ID) resolves to. */
const EPIC_BRANCH = `collab/epic/${INBOX_EPIC_ID}`;

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

describe('WorktreeManager — integration-branch recombination (DOGFOOD #5)', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-integ-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-integ-persist-'));
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

  it('ensureEpic(INBOX_EPIC_ID) creates the Inbox-epic branch + worktree', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    expect(integ).not.toBeNull();
    expect(integ!.branch).toBe(EPIC_BRANCH);
    // Branch exists in the repo.
    const verify = await runGit(repo, ['rev-parse', '--verify', `refs/heads/${EPIC_BRANCH}`]);
    expect(verify.code).toBe(0);
    // Idempotent — second call returns the same path without error.
    const again = await mgr.ensureEpic(INBOX_EPIC_ID);
    expect(again!.path).toBe(integ!.path);
  });

  it('commits a worker worktree and merges it into integration', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    const wt = await mgr.ensure('worker-a', { baseBranch: integ!.branch });
    expect(wt.path).not.toBe(repo); // a real worktree, not the shared tree

    await fs.writeFile(path.join(wt.path, 'a.txt'), 'from-a\n');
    const res = await mgr.commitAndMergeToEpic('worker-a', INBOX_EPIC_ID, { message: 'todo a' });
    expect(res.committed).toBe(true);
    expect(res.merged).toBe(true);
    expect(res.conflict).toBe(false);

    // The integration branch now contains a.txt.
    const show = await runGit(repo, ['show', `${EPIC_BRANCH}:a.txt`]);
    expect(show.code).toBe(0);
    expect(show.stdout).toBe('from-a\n');
  });

  it('ensure(session, { fresh:true }) tears down the cached worktree+branch and creates a NEW one (DEFECT 1)', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    // First ensure under a session — cached worktree + branch from "a prior todo".
    const first = await mgr.ensure('lane-x', { baseBranch: integ!.branch });
    const firstBranch = (first as any).branch as string;
    expect(firstBranch).toBeDefined();
    const firstPath = (first as any).path as string;
    expect((await runGit(repo, ['rev-parse', '--verify', `refs/heads/${firstBranch}`])).code).toBe(0);

    // Without fresh, the SAME cached worktree (same branch) is resumed.
    const resumed = await mgr.ensure('lane-x', { baseBranch: integ!.branch });
    expect((resumed as any).branch).toBe(firstBranch);

    // With fresh:true, the cached worktree+branch are removed and a NEW branch is
    // created — never reused stale.
    const fresh = await mgr.ensure('lane-x', { baseBranch: integ!.branch, fresh: true });
    const freshBranch = (fresh as any).branch as string;
    expect(freshBranch).not.toBe(firstBranch);
    // The old branch was deleted.
    expect((await runGit(repo, ['rev-parse', '--verify', `refs/heads/${firstBranch}`])).code).not.toBe(0);
    // The new branch exists.
    expect((await runGit(repo, ['rev-parse', '--verify', `refs/heads/${freshBranch}`])).code).toBe(0);
    // The old worktree dir is gone (or at least no longer the active path), and the
    // new worktree branches off the epic tip.
    expect((fresh as any).path).toBeDefined();
    void firstPath;
  });

  it('preserves dependent-todo data-flow: a later worker sees a prior merged dep', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);

    // Worker A produces a.txt and merges it.
    const wtA = await mgr.ensure('lane-1', { baseBranch: integ!.branch });
    await fs.writeFile(path.join(wtA.path, 'a.txt'), 'A-output\n');
    const ra = await mgr.commitAndMergeToEpic('lane-1', INBOX_EPIC_ID, { message: 'A' });
    expect(ra.merged).toBe(true);
    await mgr.remove('lane-1');

    // Worker B (a DIFFERENT lane, dependsOn A) branches off the LATEST integration
    // → it must see A's committed output even though A ran in a different worktree.
    const wtB = await mgr.ensure('lane-2', { baseBranch: integ!.branch });
    const seen = await fs.readFile(path.join(wtB.path, 'a.txt'), 'utf8');
    expect(seen).toBe('A-output\n');

    // B builds on it and merges back.
    await fs.writeFile(path.join(wtB.path, 'b.txt'), 'B-output\n');
    const rb = await mgr.commitAndMergeToEpic('lane-2', INBOX_EPIC_ID, { message: 'B' });
    expect(rb.merged).toBe(true);

    // Integration holds BOTH.
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:a.txt`])).stdout).toBe('A-output\n');
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:b.txt`])).stdout).toBe('B-output\n');
  });

  it('symlinks main-repo node_modules into a fresh worktree for each package.json dir', async () => {
    // Main repo has deps at root and in ui/ (the auto-detect case the fix targets).
    // node_modules is gitignored (as in reality) → worktrees start WITHOUT it.
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'react'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'react', 'index.js'), 'module.exports=2\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'add packages']);

    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    const wt = await mgr.ensure('deps-lane', { baseBranch: integ!.branch });

    // Root node_modules is a symlink resolving to the main repo's deps.
    const rootNM = path.join(wt.path, 'node_modules');
    expect((await fs.lstat(rootNM)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(rootNM, 'left-pad', 'index.js'), 'utf8')).toBe('module.exports=1\n');

    // Nested ui/node_modules is symlinked too (auto-detected via ui/package.json).
    const uiNM = path.join(wt.path, 'ui', 'node_modules');
    expect((await fs.lstat(uiNM)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(uiNM, 'react', 'index.js'), 'utf8')).toBe('module.exports=2\n');
  });

  it('node_modules symlink is git-excluded in the worktree even when repo .gitignore does NOT cover it', async () => {
    // Reproduce the master-corrupting incident's precondition: the repo .gitignore
    // uses the trailing-slash form `node_modules/` (matches DIRS only), so git does
    // NOT treat the node_modules SYMLINK as ignored. The worktree-local git exclude
    // must still hide it so a worker can never `git add` the self-referential
    // symlink that once merged to master (ELOOP).
    await fs.writeFile(path.join(repo, '.gitignore'), 'node_modules/\n');
    await fs.writeFile(path.join(repo, 'package.json'), '{"name":"root"}\n');
    await fs.mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
    await fs.writeFile(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports=1\n');
    await fs.mkdir(path.join(repo, 'ui'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'package.json'), '{"name":"ui"}\n');
    await fs.mkdir(path.join(repo, 'ui', 'node_modules', 'react'), { recursive: true });
    await fs.writeFile(path.join(repo, 'ui', 'node_modules', 'react', 'index.js'), 'module.exports=2\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'add packages without node_modules ignore']);

    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    const wt = await mgr.ensure('excl-lane', { baseBranch: integ!.branch });

    // The symlinks exist...
    expect((await fs.lstat(path.join(wt.path, 'node_modules'))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(wt.path, 'ui', 'node_modules'))).isSymbolicLink()).toBe(true);

    // ...but git status in the worktree ignores them (covered by .git/info/exclude,
    // independent of the repo .gitignore semantics).
    const status = await runGit(wt.path, ['status', '--porcelain']);
    expect(status.stdout).not.toContain('node_modules');

    // And even an explicit `git add -A` cannot stage a node_modules symlink.
    await runGit(wt.path, ['add', '-A']);
    const staged = await runGit(wt.path, ['diff', '--cached', '--name-only']);
    expect(staged.stdout).not.toContain('node_modules');
  });

  it('reports a conflict and leaves integration untouched (never corrupts it)', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);

    // Lane 1 sets shared.txt and merges.
    const wt1 = await mgr.ensure('c-1', { baseBranch: integ!.branch });
    await fs.writeFile(path.join(wt1.path, 'shared.txt'), 'one\n');
    await mgr.commitAndMergeToEpic('c-1', INBOX_EPIC_ID, { message: 'one' });

    // Lane 2 branched off the ORIGINAL integration (before lane 1's merge) edits the
    // same file divergently → conflict on merge-back.
    const wt2 = await mgr.ensure('c-2', { baseBranch: 'main' });
    await fs.writeFile(path.join(wt2.path, 'shared.txt'), 'two\n');
    const res = await mgr.commitAndMergeToEpic('c-2', INBOX_EPIC_ID, { message: 'two' });
    expect(res.conflict).toBe(true);
    expect(res.merged).toBe(false);

    // Integration still has lane 1's content — untouched by the failed merge.
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:shared.txt`])).stdout).toBe('one\n');
    // And the integration worktree is not left mid-merge.
    const status = await runGit(integ!.path, ['status', '--porcelain']);
    expect(status.stdout.trim()).toBe('');
    // BP0: a conflict integrated nothing for this lane.
    expect(res.integrated).toBe(false);
  });

  // --- BP0 stranding invariant: integrated reflects work-actually-on-epic-branch ---

  it('reports integrated=true and stamps the Collab-Todo trailer when work lands', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    const wt = await mgr.ensure('bp0-ok', { baseBranch: integ!.branch });
    await fs.writeFile(path.join(wt.path, 'work.txt'), 'real\n');
    const res = await mgr.commitAndMergeToEpic('bp0-ok', INBOX_EPIC_ID, {
      message: 'real work',
      todoId: 'todo-aaaa-1111',
    });
    expect(res.committed).toBe(true);
    expect(res.merged).toBe(true);
    expect(res.integrated).toBe(true);
    // The probe agrees the todo is on the epic branch.
    expect(await mgr.todoOnEpicBranch(INBOX_EPIC_ID, 'todo-aaaa-1111')).toBe(true);
    // The worker commit (not just the merge) carries the trailer, so it stays
    // verifiable even after a sibling's later merge.
    const log = await runGit(repo, ['log', EPIC_BRANCH, '--format=%B']);
    expect(log.stdout).toContain('Collab-Todo: todo-aaaa-1111');
  });

  it('PHANTOM: a clean worktree with no commit reports integrated=false (no work reached the branch)', async () => {
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    await mgr.ensure('bp0-phantom', { baseBranch: integ!.branch });
    // No file written → nothing to commit → the merge is a no-op "Already up to date".
    const res = await mgr.commitAndMergeToEpic('bp0-phantom', INBOX_EPIC_ID, {
      message: 'phantom',
      todoId: 'todo-bbbb-2222',
    });
    expect(res.committed).toBe(false);
    expect(res.merged).toBe(true); // git exits 0...
    expect(res.integrated).toBe(false); // ...but NOTHING was integrated — the phantom-accept the gate must reject.
    expect(await mgr.todoOnEpicBranch(INBOX_EPIC_ID, 'todo-bbbb-2222')).toBe(false);
  });

  it('multi-todo lane: each todo verifies integrated even when one merge is "already up to date"', async () => {
    // A single keep-warm lane accumulates TWO todos' commits, then merges. The
    // first merge pulls BOTH commits onto the epic branch; the second todo's merge
    // is "already up to date" — a HEAD-advance check would FALSE-strand it, but the
    // per-commit Collab-Todo trailer makes it verifiable.
    const integ = await mgr.ensureEpic(INBOX_EPIC_ID);
    const wt = await mgr.ensure('bp0-multi', { baseBranch: integ!.branch });

    await fs.writeFile(path.join(wt.path, 'one.txt'), '1\n');
    const r1 = await mgr.commitAndMergeToEpic('bp0-multi', INBOX_EPIC_ID, { message: 'first', todoId: 'todo-cccc-3333' });
    expect(r1.integrated).toBe(true);

    // Same lane, second todo — its worker commit carries its own trailer.
    await fs.writeFile(path.join(wt.path, 'two.txt'), '2\n');
    const r2 = await mgr.commitAndMergeToEpic('bp0-multi', INBOX_EPIC_ID, { message: 'second', todoId: 'todo-dddd-4444' });
    expect(r2.integrated).toBe(true);
    expect(await mgr.todoOnEpicBranch(INBOX_EPIC_ID, 'todo-cccc-3333')).toBe(true);
    expect(await mgr.todoOnEpicBranch(INBOX_EPIC_ID, 'todo-dddd-4444')).toBe(true);
  });
});
