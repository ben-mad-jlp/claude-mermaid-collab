// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  CONDUCTOR_VERIFY_BATCH_MAX,
  CONDUCTOR_SERVE_BATCH_MAX,
  CRITERION_VERIFY_ATTEMPT_CAP,
  CRITERION_SERVE_ATTEMPT_CAP,
} from '../harness-caps';
import {
  openPassRow, appendPassProgress, listConductorPasses, _closeConductorJournalDb,
} from '../conductor-pass-journal';
import { createTodo, _closeProject } from '../todo-store';
import {
  addCriterion, listCriteria, bumpCriterionVerifyAttempt, bumpCriterionServeAttempt,
  resetCriterionAttemptCounters, _resetMissionDbCache,
} from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';

describe('attempt-caps-foundation: harness-caps', () => {
  test('exports all four batch/attempt caps as numbers', () => {
    expect(typeof CONDUCTOR_VERIFY_BATCH_MAX).toBe('number');
    expect(typeof CONDUCTOR_SERVE_BATCH_MAX).toBe('number');
    expect(typeof CRITERION_VERIFY_ATTEMPT_CAP).toBe('number');
    expect(typeof CRITERION_SERVE_ATTEMPT_CAP).toBe('number');
  });
});

describe('attempt-caps-foundation: conductor_pass carried column', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conductor-pass-carried-'));
    process.env.MERMAID_SUPERVISOR_DIR = dir;
    _closeConductorJournalDb();
    // Pre-create the table WITHOUT the `carried` column, so opening the module's DB
    // exercises the ALTER TABLE migration path, not fresh-DB DDL.
    const raw = new Database(join(dir, 'worker-ledger.db'));
    raw.exec(`
      CREATE TABLE IF NOT EXISTS conductor_pass (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        missionId TEXT,
        startedAt INTEGER NOT NULL,
        endedAt INTEGER,
        serveFp TEXT,
        passFp TEXT,
        selfFp TEXT,
        arm TEXT,
        criteriaActed TEXT,
        filed TEXT,
        declined TEXT,
        outcome TEXT,
        ran INTEGER,
        failCounted INTEGER
      );
    `);
    raw.close();
  });

  afterEach(() => {
    _closeConductorJournalDb();
    delete process.env.MERMAID_SUPERVISOR_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test('round-trips carried through an ALTER-migrated conductor_pass DB', () => {
    const id = openPassRow('proj-a', null, Date.now());
    expect(id).not.toBeNull();
    const carried = { verify: ['crit_1'], serve: ['crit_2', 'crit_3'], count: 3 };
    const ok = appendPassProgress(id!, { carried });
    expect(ok).toBe(true);
    const rows = listConductorPasses('proj-a');
    expect(rows).toHaveLength(1);
    expect(rows[0].carried).toEqual(carried);
  });
});

describe('attempt-caps-foundation: criterion attempt counters', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'mission-store-attempt-caps-'));
    process.env.MERMAID_SUPERVISOR_DIR = project;
  });
  afterEach(() => {
    _closeProject(project);
    _resetMissionDbCache(project);
    _closeLedgerDb();
    delete process.env.MERMAID_SUPERVISOR_DIR;
    rmSync(project, { recursive: true, force: true });
  });

  test('bumps verify and serve attempt counts independently and resets only the named one', async () => {
    const missionId = (await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] Test', kind: 'mission' })).id;
    const criterion = addCriterion(project, missionId, 'some criterion');

    bumpCriterionVerifyAttempt(project, criterion.id);
    bumpCriterionVerifyAttempt(project, criterion.id);
    bumpCriterionServeAttempt(project, criterion.id);

    let rows = listCriteria(project, missionId);
    let row = rows.find((c) => c.id === criterion.id)!;
    expect(row.verifyAttemptCount).toBe(2);
    expect(row.serveAttemptCount).toBe(1);

    resetCriterionAttemptCounters(project, criterion.id, 'verify');

    rows = listCriteria(project, missionId);
    row = rows.find((c) => c.id === criterion.id)!;
    expect(row.verifyAttemptCount).toBe(0);
    expect(row.serveAttemptCount).toBe(1);
  });
});
