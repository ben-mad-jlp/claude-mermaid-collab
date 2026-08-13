/**
 * Epic land attempt typecheck proof fields: migration + round-trip.
 *
 * The epic_land_attempt schema gains three new columns to capture typecheck
 * execution proof at land time:
 * - typecheckCommand: the command that was run (e.g., 'npx tsc --noEmit')
 * - typecheckExitCode: the command's exit code
 * - typecheckFirstError: the first error line from stderr (if any)
 *
 * The migration must add these columns to existing DBs that have the old 8-column DDL.
 * Land attempt recording must accept these optional fields and persist them durably.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';

// Must be set BEFORE importing any store-touching module (stores open supervisor.db).
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-land-attempt-typecheck-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { recordLandAttempt, getLastEpicLandAttempt, listEpicLandAttempts, addColumnIfMissing } from '../epic-land-record-store';

afterAll(() => {
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('epic-land-attempt typecheck proof fields — migration + round-trip', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'land-attempt-typecheck-'));
    dbPath = join(tempDir, 'epic-land-attempt.db');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('migrates a legacy epic_land_attempt table and round-trips the typecheck proof', () => {
    // Create a legacy DB with the OLD 9-column schema (no typecheck columns).
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE TABLE IF NOT EXISTS epic_land_attempt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        epicId TEXT NOT NULL,
        attemptAt INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('merged','refused','errored')),
        reason TEXT,
        landPath TEXT,
        session TEXT,
        mergeSha TEXT
      );
    `);
    oldDb.close();

    // Re-open and manually run the migration via addColumnIfMissing.
    const db = new Database(dbPath);
    addColumnIfMissing(db, 'epic_land_attempt', 'typecheckCommand', 'TEXT');
    addColumnIfMissing(db, 'epic_land_attempt', 'typecheckExitCode', 'INTEGER');
    addColumnIfMissing(db, 'epic_land_attempt', 'typecheckFirstError', 'TEXT');

    // Verify all three new columns exist via PRAGMA.
    const cols = db.query('PRAGMA table_info(epic_land_attempt)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('typecheckCommand');
    expect(colNames).toContain('typecheckExitCode');
    expect(colNames).toContain('typecheckFirstError');

    db.close();

    // Now use the store functions to write and read back the values.
    const testProject = tempDir;
    const testEpicId = 'test-epic-1';
    const testCommand = 'npx tsc --noEmit -p tsconfig.json';
    const testExitCode = 2;
    const testError = 'src/x.ts(3,1): error TS2345: Argument of type X is not assignable to parameter of type Y.';

    recordLandAttempt(testProject, {
      epicId: testEpicId,
      outcome: 'refused',
      typecheckCommand: testCommand,
      typecheckExitCode: testExitCode,
      typecheckFirstError: testError,
    });

    const lastAttempt = getLastEpicLandAttempt(testProject, testEpicId);
    expect(lastAttempt).not.toBeNull();
    expect(lastAttempt!.epicId).toBe(testEpicId);
    expect(lastAttempt!.outcome).toBe('refused');
    expect(lastAttempt!.typecheckCommand).toBe(testCommand);
    expect(lastAttempt!.typecheckExitCode).toBe(testExitCode);
    expect(lastAttempt!.typecheckFirstError).toBe(testError);
  });

  it('omitting the typecheck fields yields nulls and does not throw', () => {
    // Fresh temp repo with a new DB.
    const testProject = tempDir;
    const testEpicId = 'test-epic-2';

    recordLandAttempt(testProject, {
      epicId: testEpicId,
      outcome: 'merged',
      // Explicitly omit the typecheck fields.
    });

    const lastAttempt = getLastEpicLandAttempt(testProject, testEpicId);
    expect(lastAttempt).not.toBeNull();
    expect(lastAttempt!.epicId).toBe(testEpicId);
    expect(lastAttempt!.outcome).toBe('merged');
    expect(lastAttempt!.typecheckCommand).toBeNull();
    expect(lastAttempt!.typecheckExitCode).toBeNull();
    expect(lastAttempt!.typecheckFirstError).toBeNull();

    // Verify via listEpicLandAttempts as well.
    const allAttempts = listEpicLandAttempts(testProject, testEpicId);
    expect(allAttempts).toHaveLength(1);
    expect(allAttempts[0].typecheckCommand).toBeNull();
    expect(allAttempts[0].typecheckExitCode).toBeNull();
    expect(allAttempts[0].typecheckFirstError).toBeNull();
  });
});
