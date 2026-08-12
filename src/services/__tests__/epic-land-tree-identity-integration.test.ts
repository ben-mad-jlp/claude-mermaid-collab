/**
 * Real-git integration test: a forward-integrated epic branch (ahead of master, but with an
 * identical tree) must stamp landedAt via the real makeGitProbe/detectTrunkRef/
 * isEpicTreeIdenticalToTrunk path — no injected probe, no injected treeDelta.
 *
 * This mirrors the shape produced by the daemon's own forward-integrate flow
 * (forward-integrate-epic.ts): land the epic branch into master, then merge master back into
 * the epic branch, leaving the epic branch several commits ahead of master with an identical
 * tree.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate supervisor.db BEFORE imports (mirrors epic-landed-stamp-gate.test.ts:22-23).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-tree-identity-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { stampEpicLandedAtGated } from '../epic-landed-stamp-gate';
import { createTodo, completeTodo, getTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb, listEscalations } from '../supervisor-store';
import { epicBranchName } from '../epic-branch-status';

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

afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('epic-land-tree-identity-integration', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'tree-identity-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, '.gitignore'), '.collab/\n');
    await runGit(repo, ['add', '.gitignore']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
    mkdirSync(join(repo, '.collab'), { recursive: true });
  });

  afterEach(() => {
    _closeProject(repo);
    rmSync(repo, { recursive: true, force: true });
  });

  it('forward-integrated epic branch (ahead>0, tree-identical to trunk) stamps landed with zero land-failed escalations', async () => {
    const project = repo;

    // 1. Epic todo.
    const epic = await createTodo(project, {
      allowOrphan: true,
      kind: 'epic',
      title: '[EPIC] tree-identity',
      ownerSession: 'test',
    });

    // 2. Leaf todo, completed — satisfies the ALL-LEAVES-DONE gate.
    const leaf = await createTodo(project, {
      kind: 'leaf',
      parentId: epic.id,
      title: 'leaf',
      ownerSession: 'test',
      assigneeKind: 'agent',
    });
    await completeTodo(project, leaf.id, 'accepted');

    // 3. Epic's own content commit on its branch.
    const branch = epicBranchName(epic.id);
    await runGit(repo, ['checkout', '-b', branch]);
    writeFileSync(join(repo, 'epic.txt'), 'epic-content\n');
    await runGit(repo, ['add', 'epic.txt']);
    await runGit(repo, ['commit', '-q', '-m', 'epic: add epic.txt']);

    // 4. Land: merge epic branch into master.
    await runGit(repo, ['checkout', 'master']);
    await runGit(repo, ['merge', '--no-ff', branch, '-m', 'land']);

    // 5. Forward-integrate: merge master back into the epic branch.
    await runGit(repo, ['checkout', branch]);
    await runGit(repo, ['merge', '--no-ff', 'master', '-m', 'fi']);

    // 6. Fixture guard: branch must be ahead of master, with an identical tree.
    const aheadCount = await runGit(repo, ['rev-list', '--count', `master..${branch}`]);
    expect(Number(aheadCount.stdout.trim())).toBeGreaterThan(0);

    const branchTree = await runGit(repo, ['rev-parse', `${branch}^{tree}`]);
    const masterTree = await runGit(repo, ['rev-parse', 'master^{tree}']);
    expect(branchTree.stdout.trim()).toBe(masterTree.stdout.trim());

    // 7. Leave the repo on trunk, matching post-land reality.
    await runGit(repo, ['checkout', 'master']);

    // 8. Call the real gate — no probe, no treeDelta, no known: real git decides.
    const result = await stampEpicLandedAtGated(project, epic.id, '2026-08-08T00:00:00Z', { session: 'test' });

    // 9. Assertions.
    expect(result.stamped).toBe(true);
    expect(getTodo(project, epic.id)!.landedAt).not.toBeNull();
    const landFailedCards = listEscalations().filter((e) => e.kind === 'land-failed' && e.todoId === epic.id);
    expect(landFailedCards.length).toBe(0);
  });
});
