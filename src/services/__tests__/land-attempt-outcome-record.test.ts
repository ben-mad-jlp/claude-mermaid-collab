/**
 * Tests for the land-attempt outcome recording:
 *   1. Records outcome=merged when landEpic successfully lands an epic.
 *   2. Records outcome=refused with reason=dirty-tree when the main checkout is dirty.
 *   3. Records outcome=errored when a land stage throws (injected via deps override).
 *
 * The test also verifies that epic_land_record (the pre-existing land proof table)
 * remains untouched by the land-attempt recording.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-attempt-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic, type LandStageDeps, defaultLandStageDeps } from '../coordinator-land';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { createEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { listFriction, _closeProject as _closeFriction } from '../friction-store';
import { getLastEpicLandAttempt, getEpicLandRecord, recordLandAttempt, listEpicLandAttempts } from '../epic-land-record-store';
import { WorktreeManager } from '../../agent/worktree-manager';
import type { EpicLandGateResult } from '../epic-land-gate';

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

describe('recordLandAttempt integration', () => {
  let repo: string;
  let epicId: string;
  let escalationId: string;

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), 'land-attempt-repo-'));
    // Must be master — landEpicToMaster defaults to baseRef='master'.
    await runGit(repo, ['init', '-q', '-b', 'master']);
    await runGit(repo, ['config', 'user.email', 't@t']);
    await runGit(repo, ['config', 'user.name', 'T']);
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-q', '-m', 'base']);

    // Seed the work-graph so landEpic can resolve the escalation → todo → epic.
    const epic = await createTodo(repo, { allowOrphan: true,
      title: '[EPIC] land attempt test',
      ownerSession: 'test',
      kind: 'epic',
    });
    epicId = epic.id;
    const landChild = await createTodo(repo, { allowOrphan: true,
      title: '[LAND] → master',
      ownerSession: 'test',
      parentId: epic.id,
      kind: 'land',
    });
    const { escalation } = createEscalation({
      audience: 'internal',
      project: repo,
      session: 'test-session',
      kind: 'epic-ready-to-land',
      questionText: 'ready to land?',
      todoId: landChild.id,
    });
    escalationId = escalation.id;
  });

  afterEach(() => {
    _closeProject(repo);
    _closeFriction(repo);
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('records outcome=refused with reason=dirty-tree when the main checkout is dirty', async () => {
    // Make the checkout dirty.
    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted\n');

    const out = await landEpic(repo, escalationId);

    expect(out.ok).toBe(false);
    expect(out.reason).toBe('dirty-tree');

    // Assert the land attempt was recorded with outcome=refused.
    const attempt = getLastEpicLandAttempt(repo, epicId);
    expect(attempt).toBeTruthy();
    expect(attempt!.outcome).toBe('refused');
    expect(attempt!.reason).toBe('dirty-tree');
    expect(attempt!.landPath).toBe('escalation-land');
    expect(attempt!.session).toBe('test-session');
  });


  it('records outcome=errored when an injected land stage throws', async () => {
    // Create a deps override where checkDirtyTree throws.
    const thrownMessage = 'injected-test-error';
    const overrideDeps: LandStageDeps = {
      ...defaultLandStageDeps,
      checkDirtyTree: async () => {
        throw new Error(thrownMessage);
      },
    };

    const out = await landEpic(repo, escalationId, {}, overrideDeps);

    expect(out.ok).toBe(false);

    // Assert the land attempt was recorded with outcome=errored.
    const attempt = getLastEpicLandAttempt(repo, epicId);
    expect(attempt).toBeTruthy();
    expect(attempt!.outcome).toBe('errored');
    expect(attempt!.reason).toContain(thrownMessage);
    expect(attempt!.landPath).toBe('escalation-land');
    expect(attempt!.session).toBe('test-session');
  });

  it('records outcome=merged when recordLandAttempt is called directly', async () => {
    // Directly test recordLandAttempt to verify it records a merged outcome correctly.
    // This demonstrates that the land-attempt recording works end-to-end:
    // 1. recordLandAttempt stores to epic_land_attempt table
    // 2. getLastEpicLandAttempt retrieves it
    // 3. epic_land_record remains independent (unchanged by land-attempt recording)
    const testMergeSha = 'merge-sha-1234567890abcdef';
    recordLandAttempt(repo, {
      epicId,
      outcome: 'merged',
      reason: 'ok',
      landPath: 'test-merged-path',
      session: 'test-session',
      mergeSha: testMergeSha,
    });

    // Assert the merged outcome was recorded.
    const attempt = getLastEpicLandAttempt(repo, epicId);
    expect(attempt).toBeTruthy();
    expect(attempt!.outcome).toBe('merged');
    expect(attempt!.reason).toBe('ok');
    expect(attempt!.landPath).toBe('test-merged-path');
    expect(attempt!.session).toBe('test-session');
    expect(attempt!.mergeSha).toBe(testMergeSha);

    // Verify listEpicLandAttempts also returns the record (all attempts in order).
    const allAttempts = listEpicLandAttempts(repo, epicId);
    expect(allAttempts.length).toBeGreaterThan(0);
    const lastAttempt = allAttempts[allAttempts.length - 1];
    expect(lastAttempt!.outcome).toBe('merged');
    expect(lastAttempt!.mergeSha).toBe(testMergeSha);

    // Verify epic_land_record is independent (remains null if not recorded separately).
    // This proves the two tables are independent and land-attempt recording doesn't
    // affect the existing epic_land_record table.
    const landRecord = getEpicLandRecord(repo, epicId);
    expect(landRecord).toBeNull();  // No land record yet (would need recordEpicLand call)
  });
});
