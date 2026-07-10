import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../../agent/worktree-manager.ts';
import { forwardIntegrateEpicTool } from '../forward-integrate-epic.ts';

/**
 * Test the forward_integrate_epic MCP tool surface: merges trunk into epic branch,
 * handles conflicts cleanly (aborts, leaves branch untouched), and resolves short IDs.
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

const EPIC_FULL_ID = 'epic-bbbbbbbb-1234-1234-1234-123456789012';

describe('forwardIntegrateEpicTool', () => {
  let repo: string;
  let persistDir: string;
  let wm: WorktreeManager;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fi-tool-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fi-tool-persist-'));
    wm = new WorktreeManager({
      projectRoot: repo,
      baseDir: path.join(persistDir, 'worktrees'),
      persistDir,
    });
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
    await fs.rm(persistDir, { recursive: true, force: true }).catch(() => {});
  });

  async function commitOnMaster(file: string, content: string) {
    await fs.writeFile(path.join(repo, file), content);
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', `master: add ${file}`]);
  }

  async function commitOnEpic(epicPath: string, file: string, content: string) {
    await fs.writeFile(path.join(epicPath, file), content);
    await runGit(epicPath, ['add', '-A']);
    await runGit(epicPath, ['commit', '-q', '-m', `epic: add ${file}`]);
  }

  it('merges advanced trunk into the epic branch: 0 behind, epic commits still reachable', async () => {
    // Set up epic worktree.
    const epic = await wm.ensureEpic(EPIC_FULL_ID, undefined, 'master');
    expect(epic).not.toBeNull();

    // Commit on the epic branch.
    await commitOnEpic(epic!.path, 'epic.txt', 'epic-content\n');
    const epicCommitSha = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();

    // Trunk advances with a new foundation.
    await commitOnMaster('trunk.txt', 'trunk-content\n');
    const trunkSha = (await runGit(repo, ['rev-parse', 'HEAD'])).stdout.trim();

    // Run the tool.
    const result = await forwardIntegrateEpicTool('dummy-project', EPIC_FULL_ID, {
      baseRef: 'master',
      deps: {
        wm,
        projectRoot: repo,
        resolveEpicId: (_project, id) => (id === EPIC_FULL_ID || id === EPIC_FULL_ID.slice(0, 8)) ? EPIC_FULL_ID : null,
      },
    });

    // Assertions.
    expect(result.ok).toBe(true);
    expect(result.advanced).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.behind).toBe(0);
    expect(result.ahead).toBeGreaterThan(0);
    expect(result.afterSha).not.toBe(result.beforeSha);
    expect(result.beforeSha).toBe(epicCommitSha);

    // Epic's own commit is still reachable (merge, not rebase/reset).
    const isAncestor = await runGit(
      epic!.path,
      ['merge-base', '--is-ancestor', epicCommitSha, wm.epicBranchName(EPIC_FULL_ID)],
    );
    expect(isAncestor.code).toBe(0);

    // Trunk commit is now reachable from the epic branch.
    const trunkIsAncestor = await runGit(
      epic!.path,
      ['merge-base', '--is-ancestor', trunkSha, wm.epicBranchName(EPIC_FULL_ID)],
    );
    expect(trunkIsAncestor.code).toBe(0);
  });

  it('returns a non-ok conflict result naming the paths, branch untouched', async () => {
    // Set up epic worktree.
    const epic = await wm.ensureEpic(EPIC_FULL_ID, undefined, 'master');
    expect(epic).not.toBeNull();

    // Both master and epic modify the same file divergently.
    await commitOnEpic(epic!.path, 'clash.txt', 'epic-side\n');
    const epicTipBefore = (await runGit(epic!.path, ['rev-parse', 'HEAD'])).stdout.trim();

    await commitOnMaster('clash.txt', 'master-side\n');

    // Run the tool.
    const result = await forwardIntegrateEpicTool('dummy-project', EPIC_FULL_ID, {
      baseRef: 'master',
      deps: {
        wm,
        projectRoot: repo,
        resolveEpicId: (_project, id) => (id === EPIC_FULL_ID || id === EPIC_FULL_ID.slice(0, 8)) ? EPIC_FULL_ID : null,
      },
    });

    // Assertions: conflict, paths named, branch untouched.
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.conflictedPaths).toContain('clash.txt');
    expect(result.afterSha).toBe(epicTipBefore);
    expect(result.beforeSha).toBe(epicTipBefore);

    // Epic worktree is clean (merge was aborted).
    const status = await runGit(epic!.path, ['status', '--porcelain']);
    expect(status.stdout.trim()).toBe('');
  });

  it('resolves a leading-8 epic id prefix', async () => {
    // Set up epic with the full UUID.
    const epic = await wm.ensureEpic(EPIC_FULL_ID, undefined, 'master');
    expect(epic).not.toBeNull();

    // Use only the leading-8 characters in the tool call.
    const shortId = EPIC_FULL_ID.slice(0, 8);

    // Mock a resolveEpicId that tracks the call.
    let resolverCalled = false;
    let resolverReceivedId = '';
    const mockResolveEpicId = (project: string, id: string): string | null => {
      resolverCalled = true;
      resolverReceivedId = id;
      return id === shortId ? EPIC_FULL_ID : null;
    };

    // Trunk advances.
    await commitOnMaster('foundation.txt', 'dep\n');

    // Run the tool with short ID.
    const result = await forwardIntegrateEpicTool('dummy-project', shortId, {
      baseRef: 'master',
      deps: { wm, projectRoot: repo, resolveEpicId: mockResolveEpicId },
    });

    // Assertions: resolver was called with the short ID, result uses full ID.
    expect(resolverCalled).toBe(true);
    expect(resolverReceivedId).toBe(shortId);
    expect(result.ok).toBe(true);
    expect(result.epicId).toBe(EPIC_FULL_ID);
    expect(result.epicBranch).toContain(shortId);
  });
});
