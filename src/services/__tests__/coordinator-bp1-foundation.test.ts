import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the global supervisor.db BEFORE importing anything that opens it
// (the BP1 filter records a supervisor-audit row when it blocks a dependent).
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-bp1-supervisor-'));

import { bp1FilterStrandedFoundations, getWorktreeManager } from '../coordinator-live';
import { createTodo, completeTodo, getTodo } from '../todo-store';

/**
 * BP1 — a ready dependent must NOT be claimed while its foundation is
 * accepted-but-stranded (the dep is done+accepted but its commit isn't reachable
 * from integration). bp1FilterStrandedFoundations is the pure claim-time filter
 * that drops such dependents; once the foundation lands, they flow again.
 */

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = (globalThis as any).Bun.spawn(['git', '-C', cwd, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
  });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code: code ?? 0, stdout };
}

describe('BP1 — block a dependent whose foundation is accepted-but-stranded', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp1-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
  });

  it('drops a dependent whose done foundation is stranded, then admits it once the foundation lands', async () => {
    const epic = await createTodo(repo, { ownerSession: 's', title: '[EPIC] bp1 test', status: 'in_progress' });
    const foundation = await createTodo(repo, { ownerSession: 's', title: 'foundation leaf', parentId: epic.id, status: 'in_progress' });
    const dependent = await createTodo(repo, {
      ownerSession: 's', title: 'dependent leaf', parentId: epic.id, status: 'ready',
      dependsOn: [foundation.id],
    });
    // Foundation marked done+accepted but its commit is NOT yet on integration.
    await completeTodo(repo, foundation.id, 'accepted');

    // Build the epic branch carrying the foundation's trailer (commit exists, but
    // it's stranded on the epic branch — never merged to master). Throwaway worktree
    // so the main tree (todos.db under .collab) is never checked out.
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp1-epicwt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', epicBranch, wt, 'master']);
    await fs.writeFile(path.join(wt, 'foundation.txt'), 'F\n');
    await runGit(wt, ['add', '-A']);
    await runGit(wt, ['commit', '-q', '-m', `foundation leaf\n\nCollab-Todo: ${foundation.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', wt]);

    const dep = getTodo(repo, dependent.id)!;

    // STRANDED foundation → the dependent is filtered OUT (not claimable this tick).
    const blocked = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(blocked.map((t) => t.id)).not.toContain(dependent.id);

    // Land the epic onto master → the foundation's commit becomes an ancestor.
    const land = await getWorktreeManager(repo).landEpicToMaster(epic.id);
    expect(land.landed).toBe(true);

    // Now the foundation is reachable → the dependent is admitted.
    const admitted = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(admitted.map((t) => t.id)).toContain(dependent.id);
  });

  it('FAIL-SAFE: a dependent whose done dep carries no commit is admitted (indeterminate)', async () => {
    const epic = await createTodo(repo, { ownerSession: 's', title: '[EPIC] bp1 failsafe', status: 'in_progress' });
    const dep0 = await createTodo(repo, { ownerSession: 's', title: 'trailerless dep', parentId: epic.id, status: 'in_progress' });
    const dependent = await createTodo(repo, {
      ownerSession: 's', title: 'dependent', parentId: epic.id, status: 'ready', dependsOn: [dep0.id],
    });
    await completeTodo(repo, dep0.id, 'accepted'); // done, but NO commit carries its trailer

    const dep = getTodo(repo, dependent.id)!;
    const out = await bp1FilterStrandedFoundations(repo, [dep]);
    expect(out.map((t) => t.id)).toContain(dependent.id); // null probe → satisfied
  });
});
