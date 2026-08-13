/**
 * @serial-test-lane: builds real temp git repo + real `git worktree add` checkouts
 *
 * Test for the GcRemovalRecord emission in gcLeafWorktrees. Builds a real temp git repo
 * with a landed epic worktree to verify that removal records are correctly emitted and
 * logged.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-gc-removal-record-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { getWorktreeManager } from '../coordinator-live';
import { createTodo, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { gcLeafWorktrees } from '../leaf-worktree-reaper';
import { recordEpicLand } from '../epic-land-record-store';

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

describe('gcLeafWorktrees — GcRemovalRecord emission', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gc-removal-record-repo-'));
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    _closeProject(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('emits one epic-terminal-landed GcRemovalRecord and logs the same JSON', async () => {
    const wm = getWorktreeManager(repo);
    mkdirSync(wm.baseDir(), { recursive: true });

    // Create a done epic with a land record
    const epicTodo = await createTodo(repo, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'done',
    });
    const epicId8 = epicTodo.id.slice(0, 8);
    const epicDir = join(wm.baseDir(), `__epic-${epicId8}__`);
    await runGit(repo, ['worktree', 'add', '-b', `epic-${epicId8}`, epicDir]);

    // Get the HEAD sha and record the land
    const headRes = await runGit(epicDir, ['rev-parse', 'HEAD']);
    const epicTipSha = headRes.stdout.trim();
    recordEpicLand(repo, { epicId: epicTodo.id, epicTipSha, landedMergeSha: 'deadbeef', landedAt: Date.now() });
    // Trunk-land-index confirmation (constraint a383bc2c): the record alone is never
    // trusted — trunk must carry the land commit with the Collab-Epic trailer.
    await runGit(repo, ['commit', '-q', '--allow-empty',
      '-m', `collab: land epic ${epicId8} → master`,
      '-m', `Collab-Epic: ${epicTodo.id}`]);

    // Capture console.log output
    const originalLog = console.log;
    const logs: string[] = [];
    try {
      console.log = (msg: string) => {
        logs.push(msg);
      };

      const report = await gcLeafWorktrees(repo);

      // Assert that exactly one record was emitted
      expect(report.records.length).toBe(1);

      const record = report.records[0];
      expect(record.path).toBe(epicDir);
      expect(record.reasonClass).toBe('epic-terminal-landed');
      expect(record.epicId8).toBe(epicId8);
      expect(record.leafTodoId).toBeNull();
      expect(record.trashDir).toBeTruthy();

      // Assert that the console.log line contains the JSON-serialized record
      const expectedLineSubstring = `[worktree-gc] removal ${JSON.stringify(record)}`;
      const matchingLog = logs.find((log) => log.includes(expectedLineSubstring));
      expect(matchingLog).toBeDefined();
    } finally {
      console.log = originalLog;
    }
  });
});
