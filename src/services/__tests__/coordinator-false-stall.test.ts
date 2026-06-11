import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the global supervisor.db BEFORE importing coordinator-live (its helpers
// reach supervisor-store). Enable worker isolation so the FALSE-STALL guard runs.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-false-stall-supervisor-'));
process.env.MERMAID_WORKER_ISOLATION = '1';

import { workCommittedOnEpic, getWorktreeManager } from '../coordinator-live';
import { createTodo } from '../todo-store';

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

// REGRESSION (a6fcbd79): a type:ui / type:reviewer leaf that has FINISHED — its
// change-set committed onto the epic branch — but is still `in_progress` and idle
// at its prompt (completion handshake in flight) was mis-classified as a STALL and
// parked status='blocked' (acceptanceStatus=null), only un-stuck by a manual
// re-promote. The fix: detectStalls calls workCommittedOnEpic(project, todo) and
// SKIPS a worker whose work is already on the epic branch — so it is NOT parked
// blocked and the completion/roll-up path finalizes it done+accepted. type:backend
// was unaffected only because its handshake reliably landed before STALL_MS.
describe('false-stall guard — a finished (committed) ui/reviewer leaf is NOT a stall', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-false-stall-repo-'));
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

  it('returns TRUE for a committed ui leaf (stall path is suppressed)', async () => {
    const epic = await createTodo(repo, { ownerSession: 's', title: '[EPIC] false-stall ui', status: 'in_progress' });
    const ui = await createTodo(repo, { ownerSession: 's', title: 'ui leaf', parentId: epic.id, type: 'ui', status: 'in_progress', sessionName: 'worker-ui' });

    // Build the epic branch carrying the ui leaf's Collab-Todo trailer (= the
    // daemon committed/merged its work — the "built+committed" state) in a
    // throwaway worktree so the main tree (where todos.db lives) is untouched.
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    const bwt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-false-stall-epicwt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', epicBranch, bwt, 'master']);
    await fs.writeFile(path.join(bwt, 'ui.tsx'), 'export const X = 1\n');
    await runGit(bwt, ['add', '-A']);
    await runGit(bwt, ['commit', '-q', '-m', `ui leaf\n\nCollab-Todo: ${ui.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', bwt]);

    // The guard reports "finished" → detectStalls skips it, so it is never parked
    // blocked and the completion path can finalize it done+accepted.
    expect(await workCommittedOnEpic(repo, ui)).toBe(true);
  });

  it('returns FALSE for a leaf with no commit on the epic branch (genuine idle → normal stall handling)', async () => {
    const epic = await createTodo(repo, { ownerSession: 's', title: '[EPIC] false-stall none', status: 'in_progress' });
    const reviewer = await createTodo(repo, { ownerSession: 's', title: 'reviewer leaf', parentId: epic.id, type: 'reviewer', status: 'in_progress', sessionName: 'worker-rev' });

    // No epic branch / no commit carries this todo's trailer → not finished →
    // the stall reaper retains its normal wedge-recovery behaviour (fail-safe).
    expect(await workCommittedOnEpic(repo, reviewer)).toBe(false);
  });
});
