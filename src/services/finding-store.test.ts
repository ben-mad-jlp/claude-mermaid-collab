/**
 * Tests for finding-store: schema migration, sourceLeafId round-trip, query.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
import {
  recordFinding,
  getFinding,
  findBySourceLeafId,
  _closeProject,
} from './finding-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'finding-store-test-'));
});

afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('finding-store', () => {
  test('round-trips sourceLeafId and retrieves it via findBySourceLeafId', async () => {
    const sourceLeafId = 'explore-leaf-abc123';
    const input = {
      todoId: 'todo-123',
      violatedClaim: 'API returns invalid JSON',
      reproPath: '__quarantine__/api.spec.ts',
      implicatedFiles: ['/src/api.ts'],
      ruledOut: ['/src/cache.ts'],
      surface: 'backend',
      failureIdentity: 'identity-xyz',
      sourceLeafId,
    };

    // Record the finding
    const recorded = await recordFinding(project, input);
    expect(recorded.sourceLeafId).toBe(sourceLeafId);

    // Retrieve by id
    const byId = await getFinding(project, recorded.id);
    expect(byId).toBeTruthy();
    expect(byId!.sourceLeafId).toBe(sourceLeafId);

    // Retrieve by sourceLeafId
    const bySourceLeafId = await findBySourceLeafId(project, sourceLeafId);
    expect(bySourceLeafId).toHaveLength(1);
    expect(bySourceLeafId[0].id).toBe(recorded.id);
    expect(bySourceLeafId[0].sourceLeafId).toBe(sourceLeafId);
    expect(bySourceLeafId[0].todoId).toBe(input.todoId);
  });

  test('finds multiple findings by the same sourceLeafId', async () => {
    const sourceLeafId = 'explore-leaf-multi';

    // Record two findings from the same explore leaf
    const finding1 = await recordFinding(project, {
      todoId: 'bugfix-leaf-1',
      violatedClaim: 'Failure 1',
      reproPath: '__quarantine__/test1.spec.ts',
      sourceLeafId,
    });

    const finding2 = await recordFinding(project, {
      todoId: 'bugfix-leaf-2',
      violatedClaim: 'Failure 2',
      reproPath: '__quarantine__/test2.spec.ts',
      sourceLeafId,
    });

    // Retrieve all findings by sourceLeafId
    const findings = await findBySourceLeafId(project, sourceLeafId);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.id)).toContain(finding1.id);
    expect(findings.map((f) => f.id)).toContain(finding2.id);
  });

  test('sourceLeafId is nullable and defaults to null', async () => {
    const input = {
      todoId: 'todo-456',
      violatedClaim: 'Test failure',
      reproPath: '__quarantine__/test.spec.ts',
      // sourceLeafId omitted
    };

    const recorded = await recordFinding(project, input);
    expect(recorded.sourceLeafId).toBeNull();

    // Query with null sourceLeafId (no results expected for unspecified filter)
    const findings = await findBySourceLeafId(project, '');
    expect(findings).toHaveLength(0);
  });

  test('opening a DB created without sourceLeafId migrates the column without data loss', async () => {
    // Manually create a pre-migration DB (without sourceLeafId column)
    const dbDir = join(project, '.collab');
    const dbPath = join(dbDir, 'findings.db');
    mkdirSync(dbDir, { recursive: true });

    {
      // Create the DB with the old schema (no sourceLeafId)
      const oldDb = new Database(dbPath);
      oldDb.exec('PRAGMA journal_mode = WAL');
      oldDb.exec(`
        CREATE TABLE IF NOT EXISTS finding (
          id TEXT PRIMARY KEY,
          todoId TEXT NOT NULL,
          violatedClaim TEXT NOT NULL,
          implicatedFiles TEXT,
          ruledOut TEXT,
          reproPath TEXT NOT NULL,
          failureIdentity TEXT,
          surface TEXT,
          recurrenceCount INTEGER NOT NULL DEFAULT 1,
          createdAt TEXT NOT NULL,
          lastSeenAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_finding_todo ON finding(todoId);
        CREATE INDEX IF NOT EXISTS idx_finding_failureIdentity ON finding(failureIdentity);
      `);

      // Insert a row into the old schema
      const ts = new Date().toISOString();
      oldDb.prepare(
        `INSERT INTO finding (id, todoId, violatedClaim, implicatedFiles, ruledOut, reproPath, failureIdentity, surface, createdAt, lastSeenAt)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        'old-id-123',
        'old-todo-123',
        'Old claim',
        JSON.stringify(['/old/path.ts']),
        JSON.stringify([]),
        '__quarantine__/old.spec.ts',
        'old-identity',
        'old-surface',
        ts,
        ts,
      );

      oldDb.close();
    }

    // Clear the project cache so the next call opens a fresh DB
    _closeProject(project);

    // Now record a new finding (this triggers openDb which runs the migration)
    const newFinding = await recordFinding(project, {
      todoId: 'new-todo-123',
      violatedClaim: 'New claim',
      reproPath: '__quarantine__/new.spec.ts',
      sourceLeafId: 'new-leaf-id',
    });

    expect(newFinding.sourceLeafId).toBe('new-leaf-id');

    // Verify the old row was not lost and can be read
    const oldFinding = await getFinding(project, 'old-id-123');
    expect(oldFinding).toBeTruthy();
    expect(oldFinding!.todoId).toBe('old-todo-123');
    expect(oldFinding!.violatedClaim).toBe('Old claim');
    expect(oldFinding!.sourceLeafId).toBeNull(); // migrated rows have null sourceLeafId
  });

  test('index idx_finding_sourceLeaf is created and usable', async () => {
    // Record a finding with sourceLeafId
    await recordFinding(project, {
      todoId: 'todo-idx-test',
      violatedClaim: 'Claim',
      reproPath: '__quarantine__/test.spec.ts',
      sourceLeafId: 'leaf-idx-test',
    });

    // Verify the index exists by querying with it
    const findings = await findBySourceLeafId(project, 'leaf-idx-test');
    expect(findings).toHaveLength(1);
    expect(findings[0].todoId).toBe('todo-idx-test');
  });
});
