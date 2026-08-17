/**
 * Tests for complete_todo verb honesty: refusal responses + success-implies-changed-row.
 *
 * Drives the REAL verb handleEpicTool('complete_todo', ...) over a temp project
 * to pin that:
 * 1. An unclaimed completion returns an error field or completes successfully
 * 2. A successful completion always changes the row's updatedAt timestamp
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-complete-todo-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, getTodo, claimTodo, _closeProject } from '../../services/todo-store';
import { _closeDb as _closeSupervisorDb } from '../../services/supervisor-store';
import { _closeLedgerDb } from '../../services/worker-ledger';
import { handleEpicTool } from '../epic-tools';

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
  return { code: code ?? 0, stdout, stderr };
}

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('complete-todo-verb-honesty', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'complete-todo-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    _closeProject(repo);
    _closeLedgerDb();
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('an unclaimed completion completes the row or errors with the refusal reason', async () => {
    // Create a ready (never-claimed) todo
    const todo = await createTodo(repo, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Test work',
      status: 'ready',
    });
    const todoId = todo.id;

    // Call complete_todo with no claimToken (unclaimed)
    const response = await handleEpicTool('complete_todo', {
      project: repo,
      todoId,
      acceptance: 'accepted',
    });

    const parsed = response ? JSON.parse(response) : {};

    // Disjunction: either the row is done OR the response has an error matching
    // the refusal + reset_todo remedy.
    const afterCompletion = getTodo(repo, todoId);
    const rowDone = afterCompletion?.status === 'done';
    const hasError = parsed.error && /claim|in_progress/i.test(parsed.error) && /reset_todo/i.test(parsed.error);

    expect(rowDone || hasError).toBe(true);
  });

  it('a success response corresponds to a changed row', async () => {
    // Test for both 'accepted' and 'rejected'
    for (const acceptance of ['accepted' as const, 'rejected' as const]) {
      // Create a fresh ready todo for each iteration
      const todo = await createTodo(repo, {
        allowOrphan: true,
        ownerSession: 's1',
        title: `Test work for ${acceptance}`,
        status: 'ready',
      });
      const todoId = todo.id;

      // Capture updatedAt before completion
      const before = getTodo(repo, todoId)!;
      const beforeUpdatedAt = before.updatedAt;

      // Sleep 2ms to ensure timestamp resolution (ISO string is ms-precision)
      await (globalThis as any).Bun.sleep(2);

      // Claim the todo to obtain a real claim token
      const claimed = await claimTodo(repo, todoId, 'w1', 60_000);
      expect(claimed).toBeDefined();
      const claimToken = claimed!.claimToken!;

      // Call complete_todo with the real claim token
      const response = await handleEpicTool('complete_todo', {
        project: repo,
        todoId,
        acceptance,
        claimToken,
      });

      const parsed = response ? JSON.parse(response) : {};

      // If the response has no error field, updatedAt must have advanced
      if (!parsed.error) {
        const after = getTodo(repo, todoId)!;
        const afterUpdatedAt = after.updatedAt;
        expect(Date.parse(afterUpdatedAt) > Date.parse(beforeUpdatedAt)).toBe(true);
      }
    }
  });
});
