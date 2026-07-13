/**
 * Tests for post-land tree integrity:
 *   1. landEpicToMaster leaves a stale tree (the documented bug).
 *   2. restorePostLandTree snapshots the corrupted index, resets --hard to the land commit,
 *      and asserts the tree is restored.
 *   3. requestSelfDeploy refuses when the tree is stale.
 *
 * These tests work at the landEpicToMaster + restorePostLandTree seam (not through the full
 * landEpic path) because landEpic's success path calls tscClean (npx tsc), which fails in a
 * tsconfig-less temp repo. The seam under test is the same code landEpic calls.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-tree-integrity-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { treeStatus, restorePostLandTree } from '../tree-integrity';
import { WorktreeManager } from '../../agent/worktree-manager';
import { requestSelfDeploy } from '../deploy-service';

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

describe('post-land tree integrity — restorePostLandTree + deploy refusal', () => {
  let repo: string;
  let mgr: WorktreeManager;
  const epicId = 'tree-integrity-epic';

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'tree-integrity-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
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

  it('test 1 — landEpicToMaster leaves a stale tree; restorePostLandTree snapshots and fixes it', async () => {
    // Create the epic branch with a file that will be added.
    const epicBranch = mgr.epicBranchName(epicId);
    const epicInfo = await mgr.ensureEpic(epicId);
    if (!epicInfo) throw new Error('ensureEpic returned null');

    const epicAddedFile = join(epicInfo.path, 'epic-added.txt');
    writeFileSync(epicAddedFile, 'file added by epic\n');
    await runGit(epicInfo.path, ['add', '-A']);
    await runGit(epicInfo.path, ['commit', '-q', '-m', 'epic commit adds file']);

    // repo (projectRoot) is on master at the base commit before the land.
    const preLandSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout;

    // Land the epic → master. This will leave the main checkout with a stale tree.
    const res = await mgr.landEpicToMaster(epicId);
    expect(res.landed).toBe(true);
    const landSha = res.masterSha!;

    // landEpicToMaster now self-heals the checkout at the source (P0 0949289b Part 2:
    // reset --hard masterSha, treeSynced:'reset-hard'), so the tree is NOT stale here.
    // Reproduce the ORIGINAL post-land corruption at the seam so restorePostLandTree is
    // exercised: HEAD stays at the land commit, but index + working tree roll back to the
    // pre-land tree (epic-added.txt absent). This does NOT weaken the source self-heal.
    await runGit(repo, ['reset', '--hard', preLandSha]); // index+worktree -> pre-land tree
    await runGit(repo, ['reset', '--soft', landSha]);    // HEAD -> land commit, tree stays stale

    // PRE-CONDITION assert: tree is stale (write-tree !== HEAD^{tree})
    const staleStatus = treeStatus(repo);
    expect(staleStatus.resolved).toBe(true);
    expect(staleStatus.match).toBe(false);
    expect(staleStatus.headTree).not.toBe(staleStatus.workTree);

    // Also assert that the file is absent from disk (the stale-tree signature).
    expect(existsSync(join(repo, 'epic-added.txt'))).toBe(false);

    // Now restore the tree.
    const rep = restorePostLandTree(repo, landSha);

    // Assert snapshot ref was created under refs/snapshots/
    expect(rep.snapshotRef).toBeTruthy();
    expect(rep.snapshotRef!).toMatch(/^refs\/snapshots\/pre-restore-\d+$/);

    // Assert snapshot ref exists in git
    const verifySnapshot = await runGit(repo, ['rev-parse', '--verify', rep.snapshotRef!]);
    expect(verifySnapshot.code).toBe(0);

    // Assert tree is now restored (write-tree === HEAD^{tree})
    expect(rep.after.resolved).toBe(true);
    expect(rep.after.match).toBe(true);

    // Assert the file the epic added is now on disk
    expect(existsSync(join(repo, 'epic-added.txt'))).toBe(true);

    // Assert we never reset past the land commit
    const currentHead = await runGit(repo, ['rev-parse', 'HEAD']);
    expect(currentHead.stdout).toBe(landSha);
  });

  it.skipIf(process.platform !== 'darwin')('test 2 — requestSelfDeploy refuses when tree does not match HEAD', async () => {
    // Set up a self-project checkout with the deploy script.
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'claude-mermaid-collab' }));
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'deploy-desktop.sh'), '#!/bin/bash\n# deploy script\n');

    // Make tree dirty: write a file and add it to the index, but not commit.
    writeFileSync(join(repo, 'uncommitted.txt'), 'not committed\n');
    const addRes = await runGit(repo, ['add', 'uncommitted.txt']);
    expect(addRes.code).toBe(0);

    // Assert pre-condition: tree is now stale.
    const st = treeStatus(repo);
    expect(st.resolved).toBe(true);
    expect(st.match).toBe(false);

    // requestSelfDeploy should refuse with 'tree-does-not-match-head'.
    const result = requestSelfDeploy(repo);
    expect(result.ok).toBe(false);
    expect(result.started).toBe(false);
    expect(result.reason).toBe('tree-does-not-match-head');
  });
});
