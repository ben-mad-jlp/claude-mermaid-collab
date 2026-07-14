import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Database from 'bun:sqlite';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { openDb, getTodo, createTodo, TODO_BUCKET_COLUMN_V3, TODO_BUCKET_DEDUPE_V4, TODO_BUCKET_TYPE_V5, _closeProject } from '../todo-store';

describe('isBucket column and backfill', () => {
  let tmpDir: string;
  let projectPath: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'bucket-column-'));
    projectPath = tmpDir;
    dbPath = join(projectPath, '.collab', 'todos.db');

    await fs.mkdir(join(projectPath, '.collab'), { recursive: true });
  });

  afterAll(() => {
    _closeProject(projectPath);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('backfill sets isBucket=1 for the 5 known bucket ids', async () => {
    // Create a DB with the old schema (before isBucket column), seeded with the 5 bucket rows + 2 regression guards
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
        inheritedFiles TEXT
      )
    `);

    // Insert the 5 known bucket rows with full UUIDs using the correct 8-hex prefixes
    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('bb4a9a5d-0000-0000-0000-000000000001', 'test-owner', '[EPIC] Inbox', 'planned', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('a41c8051-0000-0000-0000-000000000002', 'test-owner', '[EPIC] Bugfix inbox — human-routed', 'planned', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('98a779a1-0000-0000-0000-000000000003', 'test-owner', '[EPIC] Bugfix inbox', 'planned', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('9759e36f-0000-0000-0000-000000000004', 'test-owner', '[EPIC] Bugfix inbox', 'planned', 4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('3a6023e9-0000-0000-0000-000000000005', 'test-owner', '[EPIC] Bugfix inbox', 'planned', 5, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    // Insert 2 regression-guard rows that must stay isBucket=0
    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('d3e2a341-0000-0000-0000-000000000006', 'test-owner', '[EPIC] Human inbox', 'planned', 6, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    db.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('cafe1234-0000-0000-0000-000000000007', 'test-owner', '[EPIC] Inbox rendering bugs', 'planned', 7, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic');

    // Set user_version < 3 to force the backfill to run
    db.exec('PRAGMA user_version = 2');
    db.close();

    // Open the DB via openDb to trigger the migration
    const openedDb = openDb(projectPath);

    // Verify the column was added
    const cols = openedDb.query('PRAGMA table_info(todos)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'isBucket')).toBe(true);

    // The V3 backfill marks all 5, then the V4 dedup (DR-bugfix-bucket-dedupe) re-homes +
    // retires the 3 non-canonical Bugfix buckets (98a779a1, 9759e36f, 3a6023e9), leaving
    // Inbox (bb4a9a5d) + canonical Bugfix (a41c8051) → count=2.
    const bucketCount = (openedDb.query('SELECT COUNT(*) AS n FROM todos WHERE isBucket=1').get() as { n: number }).n;
    expect(bucketCount).toBe(2);

    // Inbox + canonical Bugfix survive as live buckets
    expect(getTodo(projectPath, 'bb4a9a5d-0000-0000-0000-000000000001')?.isBucket).toBe(true);
    expect(getTodo(projectPath, 'a41c8051-0000-0000-0000-000000000002')?.isBucket).toBe(true);
    // The 3 non-canonical Bugfix buckets are retired by the V4 dedup: isBucket=0 + dropped
    expect(getTodo(projectPath, '98a779a1-0000-0000-0000-000000000003')?.isBucket).toBe(false);
    expect(getTodo(projectPath, '9759e36f-0000-0000-0000-000000000004')?.isBucket).toBe(false);
    expect(getTodo(projectPath, '3a6023e9-0000-0000-0000-000000000005')?.isBucket).toBe(false);

    // Verify regression-guard rows stay isBucket=0
    expect(getTodo(projectPath, 'd3e2a341-0000-0000-0000-000000000006')?.isBucket).toBe(false);
    expect(getTodo(projectPath, 'cafe1234-0000-0000-0000-000000000007')?.isBucket).toBe(false);
  });

  test('create-path defaults to isBucket=0 for leaf', async () => {
    // Create a fresh todo via the store's create path
    const newTodo = await createTodo(projectPath, {
      ownerSession: 'test-session',
      title: 'A regular todo',
      kind: 'leaf',
      allowOrphan: true,
    });

    expect(newTodo.isBucket).toBe(false);
  });

  test('create-time stamp: epic with bucket-titled name gets isBucket=1', async () => {
    // Fresh project: the shared DB already holds the Inbox + Bugfix buckets, and one-bucket
    // enforcement (DR-bugfix-bucket-dedupe) rejects a duplicate — isolate to test the stamp.
    const fresh = mkdtempSync(join(os.tmpdir(), 'bucket-col-stamp-'));
    try {
      const todo1 = await createTodo(fresh, {
        ownerSession: 'test-session',
        title: 'Bugfix inbox',
        kind: 'epic',
        allowOrphan: true,
      });
      expect(todo1.isBucket).toBe(true);

      const todo2 = await createTodo(fresh, {
        ownerSession: 'test-session',
        title: 'Inbox',
        kind: 'epic',
        allowOrphan: true,
      });
      expect(todo2.isBucket).toBe(true);
    } finally {
      _closeProject(fresh);
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  test('create-time stamp: epic with non-bucket title gets isBucket=0', async () => {
    const todo1 = await createTodo(projectPath, {
      ownerSession: 'test-session',
      title: 'Inbox rendering bugs',
      kind: 'epic',
      allowOrphan: true,
    });
    expect(todo1.isBucket).toBe(false);

    const todo2 = await createTodo(projectPath, {
      ownerSession: 'test-session',
      title: 'The work',
      kind: 'epic',
      allowOrphan: true,
    });
    expect(todo2.isBucket).toBe(false);
  });

  test('create-time stamp: explicit isBucket=true on create input overrides title', async () => {
    const todo1 = await createTodo(projectPath, {
      ownerSession: 'test-session',
      title: 'Arbitrary epic title',
      kind: 'epic',
      isBucket: true,
      allowOrphan: true,
    });
    expect(todo1.isBucket).toBe(true);
  });

  test('user_version is set to the latest bucket migration (V4 dedup) after backfill', () => {
    // openDb runs ALL pending migrations, so after the V3 column backfill the V4 dedup also
    // runs and bumps user_version to V4 — assert the latest, not the intermediate V3.
    const db = new Database(dbPath);
    const ver = (db.query('PRAGMA user_version').get() as { user_version: number }).user_version;
    expect(ver).toBeGreaterThanOrEqual(TODO_BUCKET_TYPE_V5);
    expect(ver).toBeGreaterThanOrEqual(TODO_BUCKET_COLUMN_V3);
    db.close();
  });

  test('backfill is idempotent — second open changes nothing', async () => {
    // Get initial bucket count after all previous tests
    _closeProject(projectPath);

    const openedDb1 = openDb(projectPath);
    const bucketCount1 = (openedDb1.query('SELECT COUNT(*) AS n FROM todos WHERE isBucket=1').get() as { n: number }).n;

    // Close and reopen the DB — the backfill should not run again
    _closeProject(projectPath);

    const openedDb2 = openDb(projectPath);
    const bucketCount2 = (openedDb2.query('SELECT COUNT(*) AS n FROM todos WHERE isBucket=1').get() as { n: number }).n;

    // The count should be identical — idempotent
    expect(bucketCount2).toBe(bucketCount1);

    // Verify the 5 known bucket ids are still isBucket=1
    expect(getTodo(projectPath, 'bb4a9a5d-0000-0000-0000-000000000001')?.isBucket).toBe(true);
    expect(getTodo(projectPath, 'a41c8051-0000-0000-0000-000000000002')?.isBucket).toBe(true);
  });

  test('inverse-consistency: land-authority and mission-parenting bucket predicates agree', async () => {
    const { isBucketEpic: isBucketFromLandAuth } = await import('../land-authority');
    const { isBucketEpic: isBucketFromMissionParent } = await import('../mission-parenting');

    // Create a table of test epics with varying isBucket values and titles
    const testCases = [
      { title: 'Bugfix inbox', isBucket: true, desc: 'bucket-titled, isBucket=1' },
      { title: 'Inbox rendering bugs', isBucket: false, desc: 'bucket-titled-but-phrase, isBucket=0' },
      { title: 'The work', isBucket: false, desc: 'normal epic, isBucket=0' },
      { title: 'Inbox', isBucket: true, desc: 'simple inbox, isBucket=1' },
    ];

    for (const { title, isBucket, desc } of testCases) {
      // Fresh project per case: the shared DB's live buckets would trip one-bucket enforcement
      // on the bucket-titled cases. Here we only assert the two predicates AGREE on the row.
      const fresh = mkdtempSync(join(os.tmpdir(), 'bucket-col-inv-'));
      try {
        const todo = await createTodo(fresh, {
          ownerSession: 'test-session',
          title,
          kind: 'epic',
          isBucket,
          allowOrphan: true,
        });

        const retrieved = getTodo(fresh, todo.id);
        expect(retrieved).toBeDefined();
        if (!retrieved) continue;

        // Both predicates must return the same verdict
        const fromLandAuth = isBucketFromLandAuth(retrieved);
        const fromMissionParent = isBucketFromMissionParent(retrieved);

        expect(fromLandAuth).toBe(fromMissionParent);
        expect(fromLandAuth).toBe(isBucket);
      } finally {
        _closeProject(fresh);
        rmSync(fresh, { recursive: true, force: true });
      }
    }
  });
});
