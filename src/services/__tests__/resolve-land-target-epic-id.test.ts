/**
 * Pins resolveLandTarget's epic-id else-branch for a CARDLESS epic.
 *
 * With no open epic-ready-to-land card for the epic, the card scan leaves
 * existingCardId/existingSession null, so the resolved target carries
 * escalationId: null, session: 'epic-id-land' and todoId === epicId.
 *
 * The contrast case pins the bug shape behind the bare-string call at
 * src/mcp/epic-tools.ts:103: a bare string is coerced to { escalationId },
 * so a bare epic id takes the escalation branch and dies 'escalation-not-found'.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported — the
// supervisor db path is resolved at import time. Without this, listOpenEscalations
// would see live cards and flip escalationId from null to a real id.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-resolve-land-target-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { resolveLandTarget } from '../coordinator-land';

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

describe('resolveLandTarget epic-id branch (cardless epic)', () => {
  let repo: string;
  let epicId: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'resolve-land-target-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // Exactly one todo, and deliberately NO escalation.
    const epic = await createTodo(repo, {
      allowOrphan: true,
      kind: 'epic',
      title: '[EPIC] cardless land target',
      ownerSession: 'test',
    });
    epicId = epic.id;
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('resolves a cardless epic by epicId with escalationId null', () => {
    const result = resolveLandTarget(repo, { epicId });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok result');

    expect(result.data.escalationId).toBeNull();
    expect(result.data.epicId).toBe(epicId);
    expect(result.data.todoId).toBe(epicId);
    expect(result.data.session).toBe('epic-id-land');
  });

  it('the bare-string form of the same epic id fails with escalation-not-found', () => {
    const result = resolveLandTarget(repo, epicId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failed result');
    expect(result.reason).toBe('escalation-not-found');
  });
});
