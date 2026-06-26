import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../worktree-manager.ts';

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

const EPIC = 'epic-cccccccc';

describe('WorktreeManager — epicBuildBaseStaleness', () => {
  let repo: string;
  let persistDir: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-stale-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-stale-persist-'));
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

  /** Commit `file`=`content` directly on master in the main checkout. */
  async function commitOnMaster(file: string, content: string) {
    await fs.writeFile(path.join(repo, file), content);
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', `master: add ${file}`]);
  }

  it('reports not stale when epic == trunk', async () => {
    await mgr.ensureEpic(EPIC, undefined, 'master');
    const r = await mgr.epicBuildBaseStaleness(EPIC, 'master');
    expect(r.stale).toBe(false);
    expect(r.reason).toBe('fresh');
    expect(r.commitsAhead).toBe(0);
  });

  it('reports not stale when trunk is ahead by 1 commit on a disjoint file', async () => {
    await mgr.ensureEpic(EPIC, undefined, 'master');
    await commitOnMaster('trunk-only.txt', 'x\n');
    const r = await mgr.epicBuildBaseStaleness(EPIC, 'master');
    expect(r.commitsAhead).toBe(1);
    expect(r.overlap).toEqual([]);
    expect(r.stale).toBe(false);
    expect(r.reason).toBe('fresh');
  });

  it('reports stale with file-overlap when both sides touch the same file', async () => {
    const epic = await mgr.ensureEpic(EPIC, undefined, 'master');
    // Epic side touches shared.txt
    await fs.writeFile(path.join(epic!.path, 'shared.txt'), 'epic\n');
    await runGit(epic!.path, ['add', '-A']);
    await runGit(epic!.path, ['commit', '-q', '-m', 'epic: shared']);
    // Trunk side touches the SAME file after the fork
    await commitOnMaster('shared.txt', 'trunk\n');
    const r = await mgr.epicBuildBaseStaleness(EPIC, 'master');
    expect(r.commitsAhead).toBe(1);
    expect(r.overlap).toContain('shared.txt');
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('file-overlap');
  });

  it('reports stale with ahead-exceeds-max when trunk is ahead beyond the provided threshold', async () => {
    await mgr.ensureEpic(EPIC, undefined, 'master');
    await commitOnMaster('a.txt', '1\n');
    await commitOnMaster('b.txt', '2\n');
    await commitOnMaster('c.txt', '3\n');
    const r = await mgr.epicBuildBaseStaleness(EPIC, 'master', { maxAhead: 2 });
    expect(r.commitsAhead).toBe(3);
    expect(r.maxAhead).toBe(2);
    expect(r.overlap).toEqual([]);
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('ahead-exceeds-max');
  });

  it('reports fresh when the epic branch is missing', async () => {
    const r = await mgr.epicBuildBaseStaleness('epic-deadbeef', 'master');
    expect(r.stale).toBe(false);
    expect(r.reason).toBe('fresh');
  });
});