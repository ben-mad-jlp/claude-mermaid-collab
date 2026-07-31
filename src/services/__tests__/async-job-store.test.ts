/**
 * Async-job store with boot-id crash recovery.
 *
 * CURRENT_BOOT_ID is generated once at module import; a second process (restart)
 * gets a fresh id and can identify jobs from the prior boot via bootId mismatch.
 * recoverStaleJobs sweeps stale pending/running rows, marks them failed, and raises
 * a conditionKey-deduped escalation — idempotent on resweep (the dedup prevents
 * duplicate escalation creation).
 */
import { describe, it, expect, afterEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set BEFORE importing any store-touching module (stores open supervisor.db).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-async-job-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import {
  CURRENT_BOOT_ID,
  createJob,
  markJobRunning,
  markJobFailed,
  getJob,
  listJobs,
  _resetAsyncJobDbCache,
  recoverStaleJobs,
} from '../async-job-store';
import { listEscalationsByKindInWindow } from '../supervisor-store';

afterEach(() => {
  _resetAsyncJobDbCache();
});

afterAll(() => {
  _resetAsyncJobDbCache();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('async-job-store', () => {
  it('recovers a stale job from a foreign boot and raises an escalation', async () => {
    // Directly insert a stale job row with a foreign bootId by importing Database.
    const Database = (await import('bun:sqlite')).default;
    const staleBootId = 'stale-boot-id-12345';
    const staleJobId = 'stale-job-abc123';
    const now = Date.now();

    const testProject = '/tmp/test-project-async-job-1';

    // Open the store to ensure DB and table exist.
    const { mkdirSync } = await import('node:fs');
    const dbPath = join(testProject, '.collab', 'async-job.db');
    mkdirSync(join(testProject, '.collab'), { recursive: true });
    const storeDb = new Database(dbPath);
    storeDb.exec('PRAGMA journal_mode = WAL');
    storeDb.exec(`
      CREATE TABLE IF NOT EXISTS async_job (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        targetId TEXT,
        error TEXT,
        bootId TEXT NOT NULL,
        pid INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        resultJson TEXT
      )
    `);

    storeDb.prepare(`
      INSERT INTO async_job (id, project, kind, status, targetId, error, bootId, pid, createdAt, updatedAt, resultJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staleJobId, testProject, 'forge-mission', 'running', 'epic-target-123', null, staleBootId, 9999, now, now, null);
    storeDb.close();

    // Call recoverStaleJobs.
    const result = await recoverStaleJobs(testProject);

    // Assert: stale job is marked failed and recovered.
    expect(result.recovered.length).toBe(1);
    expect(result.recovered[0]!.id).toBe(staleJobId);
    expect(result.recovered[0]!.status).toBe('failed');
    expect(result.recovered[0]!.error).toBe('interrupted by server restart');

    // Assert: listJobs shows no pending/running jobs (only the failed one).
    const activeJobs = listJobs(testProject, { status: 'running' });
    expect(activeJobs.length).toBe(0);
    const pendingJobs = listJobs(testProject, { status: 'pending' });
    expect(pendingJobs.length).toBe(0);

    // Assert: escalation was created with conditionKey dedup.
    const escalations = listEscalationsByKindInWindow(
      testProject,
      'async-job-interrupted',
      now - 5000,
      now + 5000,
    );
    expect(escalations.length).toBeGreaterThanOrEqual(1);
    const found = escalations.find((e) => e.conditionKey === `async-job:${staleJobId}`);
    expect(found).toBeDefined();
    expect(found!.questionText).toMatch(/forge-mission/);
    expect(found!.questionText).toMatch(/epic-target-123/);
    expect(found!.audience).toBe('human');

    // Cleanup.
    const { rmSync } = await import('node:fs');
    rmSync(testProject, { recursive: true, force: true });
  });

  it('a second sweep is idempotent and raises no duplicate escalation', async () => {
    // Insert a stale job.
    const Database = (await import('bun:sqlite')).default;
    const staleBootId = 'stale-boot-id-again';
    const staleJobId = 'stale-job-idempotent-123';
    const now = Date.now();

    const testProject = '/tmp/test-project-async-job-2';

    const { mkdirSync } = await import('node:fs');
    const dbPath = join(testProject, '.collab', 'async-job.db');
    mkdirSync(join(testProject, '.collab'), { recursive: true });
    const storeDb = new Database(dbPath);
    storeDb.exec('PRAGMA journal_mode = WAL');
    storeDb.exec(`
      CREATE TABLE IF NOT EXISTS async_job (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        targetId TEXT,
        error TEXT,
        bootId TEXT NOT NULL,
        pid INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        resultJson TEXT
      )
    `);

    storeDb.prepare(`
      INSERT INTO async_job (id, project, kind, status, targetId, error, bootId, pid, createdAt, updatedAt, resultJson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staleJobId, testProject, 'land-epic', 'pending', null, null, staleBootId, 8888, now, now, null);
    storeDb.close();

    // First sweep.
    const result1 = await recoverStaleJobs(testProject);
    expect(result1.recovered.length).toBe(1);

    // Count escalations after first sweep.
    const escalations1 = listEscalationsByKindInWindow(
      testProject,
      'async-job-interrupted',
      now - 5000,
      now + 5000,
    );
    const initialCount = escalations1.filter((e) => e.conditionKey === `async-job:${staleJobId}`).length;
    expect(initialCount).toBe(1);

    // Second sweep (idempotent) — the job is already marked failed with the prior bootId,
    // so it won't match the WHERE clause (bootId != CURRENT_BOOT_ID is still true, but
    // status != 'pending'/'running'). No additional escalation should be created.
    // Actually, wait — the status is NOW 'failed', so it won't be in the SELECT anymore.
    const result2 = await recoverStaleJobs(testProject);
    expect(result2.recovered.length).toBe(0);

    // Escalation count should remain the same.
    const escalations2 = listEscalationsByKindInWindow(
      testProject,
      'async-job-interrupted',
      now - 5000,
      now + 5000,
    );
    const secondCount = escalations2.filter((e) => e.conditionKey === `async-job:${staleJobId}`).length;
    expect(secondCount).toBe(initialCount);

    // Cleanup.
    const { rmSync } = await import('node:fs');
    rmSync(testProject, { recursive: true, force: true });
  });

  it('a row carrying CURRENT_BOOT_ID is left untouched by the sweep', async () => {
    // Create a live job (with CURRENT_BOOT_ID).
    const testProject = '/tmp/test-project-async-job-3';
    const liveJob = createJob(testProject, { kind: 'forge-mission', targetId: 'live-target' });
    markJobRunning(testProject, liveJob.id);

    const now = Date.now();

    // Sweep should not touch this job.
    const result = await recoverStaleJobs(testProject);
    expect(result.recovered.length).toBe(0);

    // Verify the live job is still running.
    const fetched = getJob(testProject, liveJob.id);
    expect(fetched).toBeDefined();
    expect(fetched!.status).toBe('running');
    expect(fetched!.bootId).toBe(CURRENT_BOOT_ID);

    // Cleanup.
    const { rmSync } = await import('node:fs');
    rmSync(testProject, { recursive: true, force: true });
  });
});
