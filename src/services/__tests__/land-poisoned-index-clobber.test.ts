/**
 * Regression tests for the land-poisoned-index fix (7802f779, documented in b82633b7).
 *
 * Background: when an epic branch deletes a tracked file and is landed to master,
 * a poisoned index (stale state after land) can cause a subsequent scoped commit to
 * resurrect the deleted file. The fix in _landEpicToMasterInner is to run
 * reset --hard masterSha when the checkout is at baseRef with no real dirty work,
 * ensuring both the index and working tree are reset (treeSynced: 'reset-hard').
 *
 * Scenario 1: Source fix — after land, a scoped commit must not resurrect deleted files.
 * Scenario 2: Forensic sweep — divergentTrackedFiles must name the divergence when
 *            corruption is forced at the seam.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-poison-index-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { treeStatus, divergentTrackedFiles } from '../tree-integrity';
import { WorktreeManager } from '../../agent/worktree-manager';

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
  return { code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

beforeAll(() => { /* setup */ });
afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('land-poisoned-index-clobber — regression test for deleted-file resurrection', () => {
  let repo: string;
  let mgr: WorktreeManager;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'poison-index-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);

    // Base commit with two tracked files.
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    writeFileSync(join(repo, 'to-delete.txt'), 'will be deleted by epic\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    mgr = new WorktreeManager({
      projectRoot: repo,
      baseDir: join(repo, '.collab', 'agent-sessions', 'worktrees'),
      persistDir: join(repo, '.collab', 'agent-sessions'),
    });
  });

  afterEach(() => {
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('Scenario 1 — source fix: scoped commit after land must not resurrect deleted file', async () => {
    const epicId = 'poison-index-scenario-1';

    // Create epic branch that deletes the tracked file.
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');

    const fileToDelete = join(epicInfo.path, 'to-delete.txt');
    await runGit(epicInfo.path, ['rm', 'to-delete.txt']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit deletes file']);

    // repo (projectRoot) stays checked out on master at the base commit.
    // Land the epic to master.
    const res = await mgr.landEpicToMaster(epicId);
    expect(res.landed).toBe(true);
    const landSha = res.masterSha!;

    // Assert: the self-heal left index==HEAD (tree is in sync after landing).
    const statusAfterLand = treeStatus(repo);
    expect(statusAfterLand.match).toBe(true);

    // Assert: the deleted file is absent from the landed tree via git plumbing.
    const catFileRes = await runGit(repo, ['cat-file', '-e', `${landSha}:to-delete.txt`]);
    expect(catFileRes.code).not.toBe(0); // file not present in write-tree/HEAD's tree

    // Write a new unrelated tracked file, stage it with a SCOPED add (not -A).
    const unrelatedFile = join(repo, 'unrelated.txt');
    writeFileSync(unrelatedFile, 'unrelated change\n');
    await runGit(repo, ['add', 'unrelated.txt']);
    await runGit(repo, ['commit', '-q', '-m', 'unrelated scoped change']);
    const newHead = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;

    // Assert: the deleted file still stays deleted at the new HEAD (not resurrected).
    const catFileAfterScoped = await runGit(repo, ['cat-file', '-e', `${newHead}:to-delete.txt`]);
    expect(catFileAfterScoped.code).not.toBe(0); // file still absent

    // Assert: the unrelated file made it into the tree.
    const catUnrelatedRes = await runGit(repo, ['cat-file', '-e', `${newHead}:unrelated.txt`]);
    expect(catUnrelatedRes.code).toBe(0); // file is present
  });

  it('Scenario 2 — forensic sweep: divergentTrackedFiles names divergence at the seam', async () => {
    const epicId = 'poison-index-scenario-2';

    // Create epic branch that deletes the tracked file.
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');

    const fileToDelete = join(epicInfo.path, 'to-delete.txt');
    await runGit(epicInfo.path, ['rm', 'to-delete.txt']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit deletes file']);

    // Capture pre-land HEAD before landing.
    const preLandSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;

    // Land the epic to master.
    const res = await mgr.landEpicToMaster(epicId);
    expect(res.landed).toBe(true);
    const landSha = res.masterSha!;

    // Force the corrupted seam exactly as post-land-tree-integrity.test.ts does:
    // reset --hard preLandSha (index+worktree -> pre-land tree with to-delete.txt back)
    // then reset --soft landSha (HEAD -> land commit, tree stays stale with to-delete.txt on disk).
    await runGit(repo, ['reset', '--hard', preLandSha]); // index+worktree -> pre-land tree
    await runGit(repo, ['reset', '--soft', landSha]);    // HEAD -> land commit, tree stays stale

    // Assert: the corrupted file is back on disk (seam signature).
    expect(existsSync(join(repo, 'to-delete.txt'))).toBe(true);

    // Call divergentTrackedFiles and assert it names the divergence.
    const divergence = divergentTrackedFiles(repo);
    expect(divergence.resolved).toBe(true);
    expect(divergence.files).toContain('to-delete.txt');
  });
});
