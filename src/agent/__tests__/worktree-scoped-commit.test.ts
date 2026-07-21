import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager, INBOX_EPIC_ID, ScopeIncidentError } from '../worktree-manager.ts';

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

describe('WorktreeManager — scoped commit (G12)', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-scope-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'main']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-scope-persist-'));
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

  it('commitAndMergeToEpic with scoped commit produces single commit in change-set', async () => {
    // Create base commit
    await fs.mkdir(path.join(repo, 'src'), { recursive: true });
    await fs.mkdir(path.join(repo, 'other.ts'.split('/').slice(0, -1).join('/')), { recursive: true });
    await fs.writeFile(path.join(repo, 'src', 'sim.py'), 'def foo(): pass');
    await fs.writeFile(path.join(repo, 'other.ts'), 'export function bar() {}');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // Ensure epic and get a worker worktree
    const epic = await mgr.ensureEpic(INBOX_EPIC_ID);
    expect(epic).not.toBeNull();

    const session = 'test-session-1';
    const wt = await mgr.ensure(session, { baseBranch: 'main', fresh: true });
    expect(wt).not.toBeNull();

    // Snapshot untracked files (none in this repo)
    const untrackedBefore = (await runGit(wt.path, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
      .split('\0')
      .filter((p) => p.length > 0);

    // Modify sim.py and create a new test file
    await fs.writeFile(path.join(wt.path, 'src', 'sim.py'), 'def foo(): return 42');
    await fs.mkdir(path.join(wt.path, 'tests'), { recursive: true });
    await fs.writeFile(path.join(wt.path, 'tests', 'test_sim.py'), 'assert foo() == 42');

    // Commit with declared scope
    const result = await mgr.commitAndMergeToEpic(session, INBOX_EPIC_ID, {
      message: 'feat: update sim',
      todoId: 'test-todo-1',
      scope: {
        declaredFiles: ['src/sim.py'],
        untrackedAtStart: untrackedBefore,
      },
    });

    expect(result.committed).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.integrated).toBe(true);

    // Verify the epic branch has the worker's commit with the trailer
    const allCommitsRes = await runGit(repo, ['log', '--format=%B', EPIC_BRANCH]);
    expect(allCommitsRes.stdout).toContain('Collab-Todo: test-todo-1');

    // Verify the files are in the epic branch at HEAD
    const filesRes = await runGit(repo, ['ls-tree', '-r', '--name-only', `${EPIC_BRANCH}`]);
    const epicFiles = filesRes.stdout.split('\n').filter(Boolean);
    expect(epicFiles).toContain('src/sim.py');
    expect(epicFiles).toContain('tests/test_sim.py'); // created file ships
  });

  it('ScopeIncidentError when all dirty outside declared scope', async () => {
    // Create base
    await fs.mkdir(path.join(repo, 'src'), { recursive: true });
    await fs.writeFile(path.join(repo, 'src', 'sim.py'), 'def foo(): pass');
    await fs.writeFile(path.join(repo, 'other.ts'), 'export function bar() {}');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    const session = 'test-session-2';
    const wt = await mgr.ensure(session, { baseBranch: 'main', fresh: true });

    const untrackedBefore = (await runGit(wt.path, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
      .split('\0')
      .filter((p) => p.length > 0);

    // Modify ONLY other.ts, not sim.py (which is in the declared scope)
    await fs.writeFile(path.join(wt.path, 'other.ts'), 'export function bar() { return 123; }');

    let threwError = false;
    try {
      await mgr.commitAndMergeToEpic(session, INBOX_EPIC_ID, {
        message: 'feat: update sim',
        todoId: 'test-todo-2',
        scope: {
          declaredFiles: ['src/sim.py'],
          untrackedAtStart: untrackedBefore,
        },
      });
    } catch (e) {
      threwError = true;
      expect(e).toBeInstanceOf(ScopeIncidentError);
      expect((e as ScopeIncidentError).outOfScope).toContain('other.ts');
    }

    expect(threwError).toBe(true);
  });

  // crit 6: revertEpicMerge undoes ONE optimistic merge, leaving prior epic commits intact.
  it('revertEpicMerge reverts only the target merge commit (prior epic commit survives)', async () => {
    // Base commit with a file both leaves will touch.
    await fs.mkdir(path.join(repo, 'src'), { recursive: true });
    await fs.writeFile(path.join(repo, 'src', 'a.ts'), 'export const a = 0;\n');
    await fs.writeFile(path.join(repo, 'src', 'b.ts'), 'export const b = 0;\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // Leaf 1 → merge to epic (this one must SURVIVE the revert).
    const s1 = 'revert-sess-1';
    const wt1 = await mgr.ensure(s1, { baseBranch: 'main', fresh: true });
    await fs.writeFile(path.join(wt1.path, 'src', 'a.ts'), 'export const a = 1;\n');
    const m1 = await mgr.commitAndMergeToEpic(s1, INBOX_EPIC_ID, {
      message: 'feat: leaf 1', todoId: 'leaf-1', scope: { declaredFiles: ['src/a.ts'], untrackedAtStart: [] },
    });
    expect(m1.merged).toBe(true);

    // Leaf 2 → optimistic merge to epic (this is the one we revert).
    const s2 = 'revert-sess-2';
    const wt2 = await mgr.ensure(s2, { baseBranch: 'main', fresh: true });
    await fs.writeFile(path.join(wt2.path, 'src', 'b.ts'), 'export const b = 2;\n');
    const m2 = await mgr.commitAndMergeToEpic(s2, INBOX_EPIC_ID, {
      message: 'feat: leaf 2', todoId: 'leaf-2', scope: { declaredFiles: ['src/b.ts'], untrackedAtStart: [] },
    });
    expect(m2.merged).toBe(true);
    expect(m2.mergeSha).toBeTruthy();

    // Sanity: both changes are on the epic branch before the revert.
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:src/a.ts`])).stdout).toContain('a = 1');
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:src/b.ts`])).stdout).toContain('b = 2');

    // Revert leaf 2's merge only.
    const rev = await mgr.revertEpicMerge(INBOX_EPIC_ID, m2.mergeSha!);
    expect(rev.reverted).toBe(true);
    expect(rev.revertSha).toBeTruthy();
    // CONTENT-verified: the diff against the merge's pre-merge mainline parent is empty.
    expect(rev.verified).toBe(true);

    // b.ts is back to base; a.ts (leaf 1) is untouched.
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:src/b.ts`])).stdout).toContain('b = 0');
    expect((await runGit(repo, ['show', `${EPIC_BRANCH}:src/a.ts`])).stdout).toContain('a = 1');
    // The revert is an auditable commit on the epic branch.
    expect((await runGit(repo, ['log', '--format=%s', EPIC_BRANCH])).stdout).toMatch(/Revert/);
  });

  // FIX (base-freshness pre-check): worktreeBaseFresh probes whether a ref's tip is still
  // an ancestor of a lane worktree's HEAD.
  it('worktreeBaseFresh: true when the tip is an ancestor of HEAD, false once the tip advances past the fork point', async () => {
    await fs.writeFile(path.join(repo, 'root.txt'), 'root\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'root']);

    const s1 = 'fresh-sess-1';
    const wt = await mgr.ensure(s1, { baseBranch: 'main', fresh: true });

    // At fork time, 'main' is an ancestor of the lane worktree's HEAD (they're identical).
    expect(await mgr.worktreeBaseFresh(wt.path, 'main')).toBe(true);

    // Advance 'main' with a NEW commit the lane worktree never forked from.
    await fs.writeFile(path.join(repo, 'root.txt'), 'root v2\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'main moved on']);

    // The lane worktree's HEAD no longer contains 'main's new tip — STALE.
    expect(await mgr.worktreeBaseFresh(wt.path, 'main')).toBe(false);
  });
});
