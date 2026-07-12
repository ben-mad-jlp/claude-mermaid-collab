import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Database from 'bun:sqlite';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { openDb, getTodo, createTodo, listTodos, TODO_BUCKET_DEDUPE_V4, _closeProject, DuplicateBucketError } from '../todo-store';
import { findViolations } from '../invariant-check';

describe('bugfix bucket deduplication (DR-bugfix-bucket-dedupe)', () => {
  let tmpDir: string;
  let projectPath: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'bucket-dedupe-'));
    projectPath = tmpDir;
    dbPath = join(projectPath, '.collab', 'todos.db');

    await fs.mkdir(join(projectPath, '.collab'), { recursive: true });
  });

  afterAll(() => {
    _closeProject(projectPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('disposition: re-home children then retire the 3 non-canonical Bugfix buckets', async () => {
    // Create a DB with the old schema at user_version=3 (before V4 migration),
    // seeded with the 4 Bugfix bucket rows + children parented to each of the 3 non-canonical rows.
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        ownerSession TEXT NOT NULL,
        assigneeSession TEXT,
        assigneeKind TEXT NOT NULL DEFAULT 'agent',
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority INTEGER,
        dueDate TEXT,
        parentId TEXT,
        dependsOn TEXT NOT NULL DEFAULT '[]',
        ord REAL NOT NULL,
        link TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        completedAt TEXT,
        asanaGid TEXT,
        sessionName TEXT,
        executedBySession TEXT,
        blueprintId TEXT,
        type TEXT,
        kind TEXT,
        targetProject TEXT,
        acceptanceStatus TEXT,
        claimedBy TEXT,
        claimToken TEXT,
        claimedAt TEXT,
        claimLeaseMs INTEGER,
        retryCount INTEGER NOT NULL DEFAULT 0,
        completedBy TEXT,
        objectRef TEXT,
        servesCriterionId TEXT,
        decisionRef TEXT,
        claimProbe TEXT,
        inheritedBlueprintFrom TEXT,
        inheritedFiles TEXT,
        approvedAt TEXT,
        approvedBy TEXT,
        heldAt TEXT,
        heldReason TEXT,
        claim TEXT,
        isBucket INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Insert the 4 Bugfix bucket rows + 1 Inbox (all marked isBucket=1 by V3)
    const inbox = 'bb4a9a5d-0000-0000-0000-000000000001';
    const canonical = 'a41c8051-0000-0000-0000-000000000002';
    const retired1 = '98a779a1-0000-0000-0000-000000000003';
    const retired2 = '9759e36f-0000-0000-0000-000000000004';
    const retired3 = '3a6023e9-0000-0000-0000-000000000005';

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind, isBucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(inbox, 'test-owner', 'Inbox', 'planned', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind, isBucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(canonical, 'test-owner', 'Bugfix inbox', 'planned', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind, isBucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(retired1, 'test-owner', 'Bugfix inbox', 'planned', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind, isBucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(retired2, 'test-owner', 'Bugfix inbox', 'planned', 4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind, isBucket) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(retired3, 'test-owner', 'Bugfix inbox', 'planned', 5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);

    // Insert a child under each of the 3 non-canonical rows (to test re-homing)
    const child1 = 'ffffffff-1111-0000-0000-000000000001';
    const child2 = 'ffffffff-2222-0000-0000-000000000002';
    const child3 = 'ffffffff-3333-0000-0000-000000000003';

    db.prepare(
      'INSERT INTO todos (id, ownerSession, parentId, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(child1, 'test-owner', retired1, 'Child of retired1', 'planned', 6, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'leaf');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, parentId, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(child2, 'test-owner', retired2, 'Child of retired2', 'planned', 7, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'leaf');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, parentId, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(child3, 'test-owner', retired3, 'Child of retired3', 'planned', 8, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'leaf');

    // Set user_version < 4 to force the V4 migration to run
    db.exec('PRAGMA user_version = 3');
    db.close();

    // Open the DB via openDb to trigger the V4 migration
    const openedDb = openDb(projectPath);

    // Assert: count(*) WHERE isBucket=1 AND title LIKE '%Bugfix%' === 1
    const bugfixBucketCount = (openedDb.query(
      `SELECT COUNT(*) AS n FROM todos WHERE isBucket=1 AND title LIKE '%Bugfix%'`
    ).get() as { n: number }).n;
    expect(bugfixBucketCount).toBe(1);

    // Assert: re-homed children now have parentId === canonical id
    const child1Todo = getTodo(projectPath, child1);
    expect(child1Todo?.parentId).toBe(canonical);
    expect(child1Todo?.status).toBe('planned'); // unchanged

    const child2Todo = getTodo(projectPath, child2);
    expect(child2Todo?.parentId).toBe(canonical);
    expect(child2Todo?.status).toBe('planned');

    const child3Todo = getTodo(projectPath, child3);
    expect(child3Todo?.parentId).toBe(canonical);
    expect(child3Todo?.status).toBe('planned');

    // Assert: the 3 retired rows are isBucket=0, status='dropped'
    const retired1Todo = getTodo(projectPath, retired1);
    expect(retired1Todo?.isBucket).toBe(false);
    expect(retired1Todo?.status).toBe('dropped');

    const retired2Todo = getTodo(projectPath, retired2);
    expect(retired2Todo?.isBucket).toBe(false);
    expect(retired2Todo?.status).toBe('dropped');

    const retired3Todo = getTodo(projectPath, retired3);
    expect(retired3Todo?.isBucket).toBe(false);
    expect(retired3Todo?.status).toBe('dropped');

    // Assert: canonical row stays isBucket=1, non-dropped
    const canonicalTodo = getTodo(projectPath, canonical);
    expect(canonicalTodo?.isBucket).toBe(true);
    expect(canonicalTodo?.status).toBe('planned');

    // Assert: Inbox bucket is untouched
    const inboxTodo = getTodo(projectPath, inbox);
    expect(inboxTodo?.isBucket).toBe(true);
    expect(inboxTodo?.status).toBe('planned');
  });

  test('no frozen dependents: re-homed children report no broken-depends-on or orphan', async () => {
    // Use the DB from the previous test (migration already ran)
    const allTodos = listTodos(projectPath, { includeCompleted: true });
    const violations = findViolations(allTodos);

    // Filter for broken-depends-on and orphan violations
    const badViolations = violations.filter(
      (v) => v.kind === 'broken-depends-on' || v.kind === 'orphan'
    );

    // There should be no such violations after re-homing
    expect(badViolations.length).toBe(0);
  });

  test('enforcement: second Bugfix inbox create rejects with DuplicateBucketError', async () => {
    // Try to create a second "Bugfix inbox" — the canonical one already exists
    let errorThrown: any = null;
    try {
      await createTodo(projectPath, {
        ownerSession: 'test-session',
        title: 'Bugfix inbox',
        kind: 'epic',
        allowOrphan: true,
      });
      // Should not reach here
      throw new Error('Expected DuplicateBucketError to be thrown');
    } catch (err) {
      errorThrown = err;
      if (errorThrown?.message?.includes?.('Expected DuplicateBucketError')) {
        throw errorThrown; // Re-throw the "should not reach here" error
      }
    }

    // Verify the error message indicates a duplicate bucket
    expect(errorThrown?.message).toBeDefined();
    expect(errorThrown.message).toContain('Exactly one bucket epic of each kind is allowed');
    // The error message should reference the canonical row (a41c8051)
    expect(errorThrown.message).toContain('a41c8051');
  });

  test('idempotent: second open changes nothing', async () => {
    _closeProject(projectPath);

    const openedDb1 = openDb(projectPath);
    const bugfixBucketCount1 = (openedDb1.query(
      `SELECT COUNT(*) AS n FROM todos WHERE isBucket=1 AND title LIKE '%Bugfix%'`
    ).get() as { n: number }).n;

    _closeProject(projectPath);

    const openedDb2 = openDb(projectPath);
    const bugfixBucketCount2 = (openedDb2.query(
      `SELECT COUNT(*) AS n FROM todos WHERE isBucket=1 AND title LIKE '%Bugfix%'`
    ).get() as { n: number }).n;

    // Counts should be identical — idempotent
    expect(bugfixBucketCount2).toBe(bugfixBucketCount1);
    // After migration, should have exactly 1 Bugfix bucket (canonical)
    expect(bugfixBucketCount1).toBe(1);

    // Verify user_version is set to V4
    const ver = (openedDb2.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(ver).toBe(TODO_BUCKET_DEDUPE_V4);
  });
});
