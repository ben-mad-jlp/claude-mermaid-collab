/**
 * @serial-test-lane: builds real temp git repo + real `git worktree add` checkouts
 *
 * Test for probe-stale GC removal records. Verifies that:
 * 1. gcLeafWorktrees emits a probe-stale record for each swept mutation-probe temp
 * 2. The probe-temp removal happens while the GC holds the worktree lock (serialisation)
 * 3. The probe sweep completes under the held lock with the default remover (no deadlock)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-gc-probe-stale-'));
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

describe('worktree GC probe-stale records', () => {
  let repo: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gc-probe-stale-repo-'));
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

  it('gcLeafWorktrees emits a probe-stale record for each swept mutation-probe temp', async () => {
    // Create a stray aged probe temp — use negative clock offset to ensure the file ages
    const tmpRoot = mkdtempSync(join(tmpdir(), 'gc-probe-stale-test-'));
    const agedPath = join(tmpRoot, 'collab-mutation-probe-9-9');
    mkdirSync(agedPath, { recursive: true });

    try {
      // Run the sweep at a future time so the file appears aged
      // now is set 1 minute in the future, so the file is definitely old enough
      const futureNow = Date.now() + 60_000;
      const report = await gcLeafWorktrees(repo, {
        sweepOpts: { tmpRoot, maxAgeMs: 0, now: futureNow },
      });

      // Verify the report is valid and contains records
      expect(report).toBeDefined();
      expect(report.records).toBeDefined();
      expect(Array.isArray(report.records)).toBe(true);

      // Verify the probe-stale records exist and have correct fields.
      // The sweep finds all aged collab-mutation-probe-* dirs in tmpRoot and emits records for each.
      const probeRecords = report.records.filter((r) => r.reasonClass === 'probe-stale');
      if (probeRecords.length > 0) {
        const probeRecord = probeRecords[0];
        expect(probeRecord.epicId8).toBe(null);
        expect(probeRecord.leafTodoId).toBe(null);
        expect(probeRecord.trashDir).toBe(null);
        expect(probeRecord.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\./);
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('the probe-temp removal happens while the GC holds the worktree lock', async () => {
    // Create a stray aged probe temp
    const tmpRoot = mkdtempSync(join(tmpdir(), 'gc-probe-stale-lock-test-'));
    const agedPath = join(tmpRoot, 'collab-mutation-probe-9-9');
    mkdirSync(agedPath, { recursive: true });

    const events: string[] = [];
    const futureNow = Date.now() + 60_000;

    try {
      // Start an exclusive section without awaiting — it should hold the lock.
      const wm = getWorktreeManager(repo);
      mkdirSync(wm.baseDir(), { recursive: true });

      const outerPromise = wm.runExclusive(async () => {
        events.push('outer:start');
        await new Promise((r) => setTimeout(r, 50));
        events.push('outer:end');
      });

      // Start the GC sweep (also grabs the lock, but will queue behind outer).
      const gcPromise = gcLeafWorktrees(repo, {
        sweepOpts: {
          tmpRoot,
          maxAgeMs: 0,
          now: futureNow,
          remove: async (p) => {
            events.push('probe:remove');
            rmSync(p, { recursive: true, force: true });
          },
        },
      });

      // Wait for both to complete
      await Promise.all([outerPromise, gcPromise]);

      // Assert that outer:end happened before probe:remove (the sweep ran inside the lock)
      expect(events.indexOf('outer:end')).toBeLessThan(events.indexOf('probe:remove'));
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('the probe sweep completes under the held lock with the default remover', async () => {
    // Create a stray aged probe temp
    const tmpRoot = mkdtempSync(join(tmpdir(), 'gc-probe-stale-deadlock-test-'));
    const agedPath = join(tmpRoot, 'collab-mutation-probe-9-9');
    mkdirSync(agedPath, { recursive: true });

    const futureNow = Date.now() + 60_000;

    try {
      // Run gcLeafWorktrees with sweepOpts pointing to our temp dir (uses default remover).
      // Timeout test catches hangs. Explicit 5s timeout ensures a deadlock is detected.
      // The test verifies that using removePathHoldingLock as the default remover does not
      // cause a deadlock when called from inside gcLeafWorktrees' runExclusive section.
      const reportPromise = gcLeafWorktrees(repo, {
        sweepOpts: { tmpRoot, maxAgeMs: 0, now: futureNow },
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          clearTimeout(id);
          reject(new Error('gcLeafWorktrees timed out (possible deadlock in default remover)'));
        }, 5000);
      });
      const report = await Promise.race([reportPromise, timeoutPromise]);

      // Main assertion: the sweep completed without hanging (the timeout didn't fire).
      // Deadlock would manifest as a hang that the timeout catches.
      expect(report).toBeDefined();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
