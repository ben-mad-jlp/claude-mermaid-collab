import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import { backfillFrictionSignatures } from '../backfill-friction-signatures';

describe('backfill-friction-signatures', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'backfill-friction-signatures-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupDb() {
    const dbPath = join(tmpDir, 'friction.db');
    const db = new Database(dbPath);

    // Create the friction_notes table with signature column
    db.exec(`
      CREATE TABLE IF NOT EXISTS friction_notes (
        id TEXT PRIMARY KEY,
        todoId TEXT,
        session TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        layer TEXT NOT NULL,
        retryReason TEXT NOT NULL,
        detail TEXT,
        createdAt TEXT NOT NULL,
        retractedAt TEXT,
        retractedReason TEXT,
        supersededBy TEXT,
        signature TEXT
      )
    `);

    db.close();
    return dbPath;
  }

  it('first run populates only the null or empty signature rows', () => {
    const dbPath = setupDb();
    const computeSignature = (r: any) => `sig:${r.layer}:${r.retryReason}:${r.detail ?? ''}:${r.todoId ?? ''}`;

    // Set up database with mixed signature states
    const db = new Database(dbPath);
    const insertStmt = db.prepare(`
      INSERT INTO friction_notes (id, layer, retryReason, detail, todoId, session, attempt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      // Row with NULL signature
      insertStmt.run('id-1', 'orchestration', 'gate-format', 'details 1', 'todo-1', 'sess-1', 1, '2026-08-13T00:00:00Z');

      // Row with empty signature
      insertStmt.run('id-2', 'domain', 'missing-model', 'details 2', 'todo-2', 'sess-2', 1, '2026-08-13T00:00:00Z');

      // Row with existing signature (should be skipped)
      insertStmt.run('id-3', 'orchestration', 'wrong-test-cmd', 'details 3', 'todo-3', 'sess-3', 1, '2026-08-13T00:00:00Z');

      // Another row with NULL signature
      insertStmt.run('id-4', 'operational', 'config-issue', null, null, 'sess-4', 1, '2026-08-13T00:00:00Z');

      // Row with existing preset signature
      insertStmt.run('id-5', 'domain', 'api-change', 'details 5', 'todo-5', 'sess-5', 1, '2026-08-13T00:00:00Z');
    })();

    // Set preset signatures
    db.prepare('UPDATE friction_notes SET signature = ? WHERE id = ?').run('PRESET', 'id-3');
    db.prepare('UPDATE friction_notes SET signature = ? WHERE id = ?').run('PRESET', 'id-5');

    db.close();

    // Run the backfill
    const report = backfillFrictionSignatures(dbPath, computeSignature);

    expect(report.scanned).toBe(3); // id-1, id-2, id-4 need work
    expect(report.updated).toBe(3);
    expect(report.skipped).toBe(2); // id-3, id-5 already have signatures

    // Verify the results
    const dbVerify = new Database(dbPath);
    const rows = dbVerify
      .prepare('SELECT id, signature FROM friction_notes ORDER BY id')
      .all() as Array<{ id: string; signature: string }>;

    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ id: 'id-1', signature: 'sig:orchestration:gate-format:details 1:todo-1' });
    expect(rows[1]).toEqual({ id: 'id-2', signature: 'sig:domain:missing-model:details 2:todo-2' });
    expect(rows[2]).toEqual({ id: 'id-3', signature: 'PRESET' }); // Untouched
    expect(rows[3]).toEqual({ id: 'id-4', signature: 'sig:operational:config-issue::' });
    expect(rows[4]).toEqual({ id: 'id-5', signature: 'PRESET' }); // Untouched

    dbVerify.close();
  });

  it('second run over the same db reports updated: 0', () => {
    const dbPath = setupDb();
    const computeSignature = (r: any) => `sig:${r.layer}:${r.retryReason}:${r.detail ?? ''}:${r.todoId ?? ''}`;

    // Set up database
    const db = new Database(dbPath);
    const insertStmt = db.prepare(`
      INSERT INTO friction_notes (id, layer, retryReason, detail, todoId, session, attempt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      insertStmt.run('id-1', 'orchestration', 'gate-format', 'details 1', 'todo-1', 'sess-1', 1, '2026-08-13T00:00:00Z');
      insertStmt.run('id-2', 'domain', 'missing-model', null, 'todo-2', 'sess-2', 1, '2026-08-13T00:00:00Z');
      insertStmt.run('id-3', 'operational', 'config-issue', 'details 3', null, 'sess-3', 1, '2026-08-13T00:00:00Z');
    })();

    db.close();

    // First run
    const report1 = backfillFrictionSignatures(dbPath, computeSignature);
    expect(report1.scanned).toBe(3);
    expect(report1.updated).toBe(3);

    // Second run — should find nothing to do
    const report2 = backfillFrictionSignatures(dbPath, computeSignature);
    expect(report2.scanned).toBe(0);
    expect(report2.updated).toBe(0);
    expect(report2.skipped).toBe(3);

    // Verify the signatures are stable across both runs
    const dbVerify = new Database(dbPath);
    const rows = dbVerify
      .prepare('SELECT id, signature FROM friction_notes ORDER BY id')
      .all() as Array<{ id: string; signature: string }>;

    expect(rows[0]).toEqual({ id: 'id-1', signature: 'sig:orchestration:gate-format:details 1:todo-1' });
    expect(rows[1]).toEqual({ id: 'id-2', signature: 'sig:domain:missing-model::todo-2' });
    expect(rows[2]).toEqual({ id: 'id-3', signature: 'sig:operational:config-issue:details 3:' });

    dbVerify.close();
  });

  it('dryRun writes nothing', () => {
    const dbPath = setupDb();
    const computeSignature = (r: any) => `sig:${r.layer}:${r.retryReason}:${r.detail ?? ''}:${r.todoId ?? ''}`;

    // Set up database
    const db = new Database(dbPath);
    const insertStmt = db.prepare(`
      INSERT INTO friction_notes (id, layer, retryReason, detail, todoId, session, attempt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      insertStmt.run('id-1', 'orchestration', 'gate-format', 'details 1', 'todo-1', 'sess-1', 1, '2026-08-13T00:00:00Z');
      insertStmt.run('id-2', 'domain', 'missing-model', null, 'todo-2', 'sess-2', 1, '2026-08-13T00:00:00Z');
    })();

    db.close();

    // Run with dryRun: true
    const report = backfillFrictionSignatures(dbPath, computeSignature, { dryRun: true });

    expect(report.scanned).toBe(2);
    expect(report.updated).toBe(0); // Dry-run doesn't update
    expect(report.skipped).toBe(0);

    // Verify nothing changed in the DB
    const dbVerify = new Database(dbPath);
    const rows = dbVerify
      .prepare('SELECT id, signature FROM friction_notes ORDER BY id')
      .all() as Array<{ id: string; signature: string | null }>;

    expect(rows).toHaveLength(2);
    expect(rows[0].signature).toBe(null); // Still NULL
    expect(rows[1].signature).toBe(null); // Still NULL

    dbVerify.close();
  });

  it('a friction_notes table without a signature column errors and writes nothing', () => {
    const dbPath = join(tmpDir, 'friction-nosig.db');
    const db = new Database(dbPath);

    // Create friction_notes WITHOUT signature column
    db.exec(`
      CREATE TABLE IF NOT EXISTS friction_notes (
        id TEXT PRIMARY KEY,
        todoId TEXT,
        session TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        layer TEXT NOT NULL,
        retryReason TEXT NOT NULL,
        detail TEXT,
        createdAt TEXT NOT NULL,
        retractedAt TEXT,
        retractedReason TEXT,
        supersededBy TEXT
      )
    `);

    // Insert a test row
    db.prepare(`
      INSERT INTO friction_notes (id, layer, retryReason, detail, todoId, session, attempt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('id-1', 'orchestration', 'gate-format', 'details 1', 'todo-1', 'sess-1', 1, '2026-08-13T00:00:00Z');

    db.close();

    const computeSignature = (r: any) => `sig:${r.layer}:${r.retryReason}`;

    // Should throw before modifying anything
    expect(() => {
      backfillFrictionSignatures(dbPath, computeSignature);
    }).toThrow(/friction_notes.*signature/);

    // Verify the table is unchanged
    const dbVerify = new Database(dbPath);
    const rows = dbVerify.prepare('SELECT id FROM friction_notes').all() as Array<{ id: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('id-1');

    // Verify no signature column exists
    const columns = dbVerify.prepare('PRAGMA table_info(friction_notes)').all() as Array<{ name: string }>;
    const hasSignatureColumn = columns.some((col) => col.name === 'signature');
    expect(hasSignatureColumn).toBe(false);

    dbVerify.close();
  });
});
