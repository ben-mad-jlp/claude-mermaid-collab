import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  classifyLedgerRow,
  isFixtureLedgerRow,
  purgeLedgerFixtureRows,
  isSyntheticProjectRoot,
  UUID_TODO_ID,
  FIXTURE_TODO_IDS,
  AMBIGUOUS_TODO_IDS,
} from '../purge-ledger-fixture-rows';

describe('purge-ledger-fixture-rows', () => {
  let tmpDir: string;
  let db: Database;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'purge-ledger-fixture-rows-'));
    process.env.MERMAID_SUPERVISOR_DIR = tmpDir;

    const dbPath = join(tmpDir, 'worker-ledger.db');
    db = new Database(dbPath);

    // Create the minimal worker_ledger table
    db.exec(`
      CREATE TABLE worker_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        todoId TEXT NOT NULL,
        session TEXT NOT NULL,
        phase TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        source TEXT NOT NULL,
        inputTokens INTEGER NOT NULL DEFAULT 0,
        outputTokens INTEGER NOT NULL DEFAULT 0,
        costUsd REAL NOT NULL DEFAULT 0,
        knownPrice INTEGER NOT NULL DEFAULT 1,
        steps INTEGER NOT NULL DEFAULT 0,
        parseError TEXT,
        ts INTEGER NOT NULL
      )
    `);
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.MERMAID_SUPERVISOR_DIR;
  });

  it('classifies each measured fixture class and spares real rows', () => {
    const now = 1786642300000; // 2026-08-13 17:31:40 UTC (after the false-triggered timestamp)

    // Real UUID row under real project
    const realUuidRow = { todoId: 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6', project: '/Users/benmaderazo/Code/claude-mermaid-collab', ts: now - 10000 };
    expect(classifyLedgerRow(realUuidRow, now)).toBe(null);
    expect(isFixtureLedgerRow(realUuidRow, now)).toBe(false);

    // fixture-todo-id row
    const fixtureIdRow = { todoId: 'worker-1', project: '/proj/alpha', ts: now - 10000 };
    expect(classifyLedgerRow(fixtureIdRow, now)).toBe('fixture-todo-id');
    expect(isFixtureLedgerRow(fixtureIdRow, now)).toBe(true);

    // synthetic-project-root: ambiguous ID under synthetic project
    const syntheticAmbiguousRow = { todoId: 'node', project: '/proj/alpha', ts: now - 10000 };
    expect(classifyLedgerRow(syntheticAmbiguousRow, now)).toBe('synthetic-project-root');
    expect(isFixtureLedgerRow(syntheticAmbiguousRow, now)).toBe(true);

    // synthetic-project-root: any row under synthetic project
    const syntheticAnyRow = { todoId: 'some-unknown-id', project: 'test-project-window', ts: now - 10000 };
    expect(classifyLedgerRow(syntheticAnyRow, now)).toBe('synthetic-project-root');
    expect(isFixtureLedgerRow(syntheticAnyRow, now)).toBe(true);

    // future-dated row (use a non-UUID todoId so it doesn't trigger the UUID guard)
    const futureDatedRow = { todoId: 'some-non-uuid-id', project: '/some/project', ts: now + 10000 };
    expect(classifyLedgerRow(futureDatedRow, now)).toBe('future-dated');
    expect(isFixtureLedgerRow(futureDatedRow, now)).toBe(true);

    // Real ambiguous ID (node) under real project
    const realAmbiguousRow = { todoId: 'node', project: '/Users/benmaderazo/Code/claude-mermaid-collab', ts: now - 10000 };
    expect(classifyLedgerRow(realAmbiguousRow, now)).toBe(null);
    expect(isFixtureLedgerRow(realAmbiguousRow, now)).toBe(false);

    // Synthetic project root pattern /tmp/node-invoker-*
    const tmpNodeInvokerRow = { todoId: 'node', project: '/tmp/node-invoker-abc123', ts: now - 10000 };
    expect(classifyLedgerRow(tmpNodeInvokerRow, now)).toBe('synthetic-project-root');
    expect(isFixtureLedgerRow(tmpNodeInvokerRow, now)).toBe(true);
  });

  it('spares a real UUID row whose UTC date reads 2026-08-13 but whose ts is in the past', () => {
    // The false-triggered timestamp from bugfix 8d148f66: 2026-08-13 17:30:57 UTC
    const falseTriggerTs = 1786642257791;
    // Our test "now" is in the future
    const testNow = 1786642300000;

    expect(testNow).toBeGreaterThan(falseTriggerTs);

    // A real UUID row with the false-triggered timestamp
    const realUuidPastRow = {
      todoId: 'f1e2d3c4-b5a6-47a8-b9c0-d1e2f3a4b5c6',
      project: '/Users/benmaderazo/Code/claude-mermaid-collab',
      ts: falseTriggerTs,
    };

    // Should be spared because it's a UUID todoId under a real (non-synthetic) project
    // The UUID guard triggers BEFORE the ts > now check
    expect(classifyLedgerRow(realUuidPastRow, testNow)).toBe(null);
    expect(isFixtureLedgerRow(realUuidPastRow, testNow)).toBe(false);
  });

  it('dry run deletes nothing while reporting the same counts', () => {
    const now = 1786642400000; // A fixed point in time

    // Insert test rows
    const insertStmt = db.prepare(`
      INSERT INTO worker_ledger (project, todoId, session, phase, provider, model, source, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      // Real rows
      insertStmt.run('/Users/benmaderazo/Code/claude-mermaid-collab', 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6', 'test', 'test', 'test', 'test', 'test', now - 10000);
      insertStmt.run('/Users/benmaderazo/Code/claude-mermaid-collab', 'node', 'test', 'test', 'test', 'test', 'test', now - 10000);

      // Fixture rows
      insertStmt.run('/proj/alpha', 'worker-1', 'test', 'test', 'test', 'test', 'test', now - 10000);
      insertStmt.run('test-project-window', 'some-id', 'test', 'test', 'test', 'test', 'test', now - 10000);
      insertStmt.run('/some/project', 'another-non-uuid-id', 'test', 'test', 'test', 'test', 'test', now + 10000); // future-dated
    })();

    const beforeCount = db.prepare('SELECT COUNT(*) as cnt FROM worker_ledger').get() as { cnt: number };
    expect(beforeCount.cnt).toBe(5);

    // Run dry-run
    const dryRunReport = purgeLedgerFixtureRows(db, { apply: false, now });

    expect(dryRunReport.scanned).toBe(5);
    expect(dryRunReport.deleted).toBe(0); // Dry-run doesn't delete
    expect(dryRunReport.remaining).toBe(5);
    expect(dryRunReport.remainingFixtures).toBe(3); // 3 fixture rows

    // Verify nothing changed in the DB
    const afterCount = db.prepare('SELECT COUNT(*) as cnt FROM worker_ledger').get() as { cnt: number };
    expect(afterCount.cnt).toBe(5);
  });

  it('--apply leaves exactly the real rows and the deleted count matches', () => {
    // Clear the table
    db.exec('DELETE FROM worker_ledger');

    const now = 1786642500000; // Another fixed point

    // Insert test rows
    const insertStmt = db.prepare(`
      INSERT INTO worker_ledger (project, todoId, session, phase, provider, model, source, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      // Real rows (2)
      insertStmt.run('/Users/benmaderazo/Code/claude-mermaid-collab', 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6', 'test', 'test', 'test', 'test', 'test', now - 10000);
      insertStmt.run('/Users/benmaderazo/Code/claude-mermaid-collab', 'node', 'test', 'test', 'test', 'test', 'test', now - 10000);

      // Fixture rows (3)
      insertStmt.run('/proj/alpha', 'worker-1', 'test', 'test', 'test', 'test', 'test', now - 10000); // fixture-todo-id
      insertStmt.run('test-project-window', 'some-id', 'test', 'test', 'test', 'test', 'test', now - 10000); // synthetic-project-root
      insertStmt.run('/some/project', 'yet-another-id', 'test', 'test', 'test', 'test', 'test', now + 10000); // future-dated
    })();

    const beforeCount = db.prepare('SELECT COUNT(*) as cnt FROM worker_ledger').get() as { cnt: number };
    expect(beforeCount.cnt).toBe(5);

    // Run apply
    const applyReport = purgeLedgerFixtureRows(db, { apply: true, now });

    expect(applyReport.scanned).toBe(5);
    expect(applyReport.deleted).toBe(3); // 3 fixture rows deleted
    expect(applyReport.remaining).toBe(2); // 2 real rows remain
    expect(applyReport.remainingFixtures).toBe(0); // No fixtures left

    // Verify the DB has only real rows
    const afterCount = db.prepare('SELECT COUNT(*) as cnt FROM worker_ledger').get() as { cnt: number };
    expect(afterCount.cnt).toBe(2);

    // Verify the remaining rows are the real ones
    const remaining = db
      .prepare('SELECT todoId, project FROM worker_ledger ORDER BY todoId')
      .all() as Array<{ todoId: string; project: string }>;
    expect(remaining).toHaveLength(2);
    expect(remaining[0].todoId).toBe('a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6');
    expect(remaining[1].todoId).toBe('node');
  });
});
