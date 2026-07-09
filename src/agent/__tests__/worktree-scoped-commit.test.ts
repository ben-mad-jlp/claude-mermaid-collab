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
});
