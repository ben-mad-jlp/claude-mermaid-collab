import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { promises as fs } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Isolate the global supervisor.db BEFORE importing anything that opens it —
// sweepStrandedAccepted raises escalations via supervisor-store.createEscalation.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(path.join(os.tmpdir(), 'mc-bp0-sweep-supervisor-'));

import {
  sweepStrandedAccepted,
  getWorktreeManager,
  _resetBp0SweepState,
  BP0_STRANDED_SUMMARY_KIND,
  BP0_SUMMARY_SESSION,
} from '../coordinator-live';
import { createTodo, completeTodo } from '../todo-store';
import { listOpenEscalations } from '../supervisor-store';

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

describe('BP0 — sweepStrandedAccepted flags accepted todos whose work never reached the epic branch', () => {
  let repo: string;

  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp0-sweep-repo-'));
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

  it('flags ONLY the stranded child (no trailer on the epic branch), not the integrated one', async () => {
    // Seed an [EPIC] with two accepted children: A's work is on the epic branch,
    // B's is stranded (accepted with no commit reachable).
    const epic = await createTodo(repo, { ownerSession: 's', title: '[EPIC] bp0 test', status: 'in_progress' });
    const childA = await createTodo(repo, { ownerSession: 's', title: 'integrated child', parentId: epic.id, status: 'in_progress' });
    const childB = await createTodo(repo, { ownerSession: 's', title: 'stranded child', parentId: epic.id, status: 'in_progress' });
    await completeTodo(repo, childA.id, 'accepted');
    await completeTodo(repo, childB.id, 'accepted');

    // Build the epic branch carrying ONLY childA's Collab-Todo trailer. Do it in a
    // THROWAWAY worktree so the main working tree (where todos.db lives under
    // .collab) is never checked out from under the open DB connection.
    const epicBranch = getWorktreeManager(repo).epicBranchName(epic.id);
    const bwt = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp0-epicwt-'));
    await runGit(repo, ['worktree', 'add', '-q', '-b', epicBranch, bwt, 'master']);
    await fs.writeFile(path.join(bwt, 'a.txt'), 'A\n');
    await runGit(bwt, ['add', '-A']);
    await runGit(bwt, ['commit', '-q', '-m', `integrated child\n\nCollab-Todo: ${childA.id}`]);
    await runGit(repo, ['worktree', 'remove', '--force', bwt]);

    const flagged = await sweepStrandedAccepted(repo, { force: true });
    expect(flagged).toContain(childB.id);
    expect(flagged).not.toContain(childA.id);
    // The epic container itself is never flagged (it carries no commit of its own).
    expect(flagged).not.toContain(epic.id);
  });
});

describe('BP0 — redesigned sweep: throttle + single summary escalation (no flood)', () => {
  let repo: string;
  let strandedId: string;

  beforeAll(async () => {
    _resetBp0SweepState();
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bp0-throttle-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // One epic with a single stranded accepted child (no epic branch carries it).
    const epic = await createTodo(repo, { ownerSession: 's', title: '[EPIC] throttle test', status: 'in_progress' });
    const child = await createTodo(repo, { ownerSession: 's', title: 'stranded child', parentId: epic.id, status: 'in_progress' });
    await completeTodo(repo, child.id, 'accepted');
    strandedId = child.id;
  });

  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true }).catch(() => {});
  });

  function summariesFor(project: string) {
    return listOpenEscalations().filter(
      (e) => e.kind === BP0_STRANDED_SUMMARY_KIND && e.project === project,
    );
  }

  it('raises ONE summary escalation (not one-per-todo) with no todoId, ids in the detail', async () => {
    _resetBp0SweepState();
    const flagged = await sweepStrandedAccepted(repo);
    expect(flagged).toContain(strandedId);

    const summaries = summariesFor(repo);
    expect(summaries.length).toBe(1);
    const s = summaries[0]!;
    // No todoId → the reconcile step-4 settled-todo auto-close (which keys on
    // todoId) can never resolve-then-recreate it. Sentinel session keeps dedup stable.
    expect(s.todoId).toBeNull();
    expect(s.session).toBe(BP0_SUMMARY_SESSION);
    // Flagged ids are attached in the option detail.
    expect(JSON.stringify(s.options ?? [])).toContain(strandedId);
  });

  it('THROTTLES: a second immediate sweep short-circuits and creates no new escalation', async () => {
    const before = summariesFor(repo).length;
    const flagged = await sweepStrandedAccepted(repo); // within the interval → no-op
    expect(flagged).toEqual([]);
    expect(summariesFor(repo).length).toBe(before);
  });

  it('does NOT flood across many ticks: 50 ticks still yield exactly ONE summary', async () => {
    for (let i = 0; i < 50; i++) await sweepStrandedAccepted(repo);
    expect(summariesFor(repo).length).toBe(1);
  });

  it('force re-runs but dedup still holds it to ONE open summary per project', async () => {
    await sweepStrandedAccepted(repo, { force: true });
    expect(summariesFor(repo).length).toBe(1);
  });
});
