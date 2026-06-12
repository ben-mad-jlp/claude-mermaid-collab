import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

/**
 * OI-1 — accept-time ANCESTOR-OF-INTEGRATION gate. `accepted` must imply
 * `reachable from the integration branch`, so accepted work can never silently
 * fail to ship. These exercise the two pure probes the gate is built on against
 * REAL git in a temp repo (hermetic + fast):
 *   - resolveIntegrationRef → the project's default branch (or null for non-git).
 *   - commitOnIntegration   → true (ancestor of integration) | false (stranded on
 *     an unlanded epic branch) | null (indeterminate → caller's fail-safe).
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

const EPIC = 'epic-bbbbbbbb';

describe('WorktreeManager — OI-1 accept-time ancestor gate', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-anc-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-anc-persist-'));
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

  /** Create the epic branch + worktree and commit `file` carrying the
   *  `Collab-Todo: <todoId>` trailer the gate searches for. */
  async function epicCommitFor(todoId: string, file: string) {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    expect(epic).not.toBeNull();
    await fs.writeFile(path.join(epic!.path, file), `${file}\n`);
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', `feat: ${file}\n\nCollab-Todo: ${todoId}`]);
    return epic!;
  }

  it('resolveIntegrationRef returns the repo default branch (master)', async () => {
    expect(await mgr.resolveIntegrationRef()).toBe('master');
  });

  it('honours an explicit integration-ref hint when the branch exists', async () => {
    await runGit(repo, ['branch', 'release']);
    expect(await mgr.resolveIntegrationRef('release')).toBe('release');
    // A non-existent hint falls through to the default branch.
    expect(await mgr.resolveIntegrationRef('nope')).toBe('master');
  });

  it('ACCEPTS: a commit landed onto integration is an ancestor → true', async () => {
    await epicCommitFor('todo-reachable', 'feature.txt');
    const res = await mgr.landEpicToMaster(EPIC);
    expect(res.landed).toBe(true);
    expect(await mgr.commitOnIntegration(EPIC, 'todo-reachable', 'master')).toBe(true);
  });

  it('DOES NOT ACCEPT: a commit stranded on an unlanded epic branch → false', async () => {
    await epicCommitFor('todo-stranded', 'stranded.txt');
    // Deliberately do NOT land the epic.
    expect(await mgr.commitOnIntegration(EPIC, 'todo-stranded', 'master')).toBe(false);
  });

  it('FAIL-SAFE: no commit carries the trailer → null (caller falls back to accept)', async () => {
    await epicCommitFor('todo-present', 'present.txt');
    expect(await mgr.commitOnIntegration(EPIC, 'todo-does-not-exist', 'master')).toBeNull();
  });

  it('FAIL-SAFE: a non-git directory → resolveIntegrationRef null + commitOnIntegration null', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-anc-plain-'));
    const plainMgr = new WorktreeManager({
      projectRoot: plain,
      baseDir: path.join(plain, 'worktrees'),
      persistDir: plain,
    });
    try {
      expect(await plainMgr.resolveIntegrationRef()).toBeNull();
      expect(await plainMgr.commitOnIntegration(EPIC, 'any', 'master')).toBeNull();
    } finally {
      await fs.rm(plain, { recursive: true, force: true }).catch(() => {});
    }
  });
});
