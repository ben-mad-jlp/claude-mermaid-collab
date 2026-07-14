import { describe, test, expect, afterEach } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  openDb,
  getTodo,
  createTodo,
  _closeProject,
  TODO_BUCKET_TYPE_V5,
  TODO_TRIAGE_TAG_V6,
} from '../todo-store';
import { addSessionTodo } from '../../mcp/tools/session-todos';
import { ensureBucket, isBucketEpic, bucketTypeOfTitle } from '../bucket-registry';

/** Raw pre-migration schema (no bucketType column — addColumnIfMissing adds it). */
const LEGACY_DDL = `
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
  )`;

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'bucket-registry-'));
  mkdirSync(join(dir, '.collab'), { recursive: true });
  return dir;
}

const projects: string[] = [];
afterEach(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    rmSync(p, { recursive: true, force: true });
  }
});

describe('bucket-registry: isBucketEpic predicate', () => {
  test('legacy title-only row (bucketType null, title "Bugfix inbox") IS a bucket', () => {
    expect(isBucketEpic({ kind: 'epic', title: 'Bugfix inbox', bucketType: null })).toBe(true);
    expect(isBucketEpic({ kind: 'epic', title: '[EPIC] Inbox' })).toBe(true);
    expect(isBucketEpic({ kind: 'epic', title: 'Collab gaps' })).toBe(true);
  });

  test('structural bucketType alone makes it a bucket', () => {
    expect(isBucketEpic({ kind: 'epic', title: 'anything', bucketType: 'bugfix' })).toBe(true);
  });

  test('exact canonical title is a bucket even when isBucket:false', () => {
    expect(isBucketEpic({ kind: 'epic', title: 'Inbox', isBucket: false })).toBe(true);
  });

  test('explicit isBucket:false vetoes a non-canonical bucket-looking title', () => {
    expect(isBucketEpic({ kind: 'epic', title: 'Inbox triage', isBucket: false })).toBe(false);
    expect(isBucketEpic({ kind: 'epic', title: 'Refactor the parser' })).toBe(false);
  });

  test('role comes from kind — a leaf titled like a bucket is NOT a bucket', () => {
    expect(isBucketEpic({ kind: 'leaf', title: 'Bugfix inbox' })).toBe(false);
  });

  test('bucketTypeOfTitle maps legacy titles', () => {
    expect(bucketTypeOfTitle('Inbox')).toBe('inbox');
    expect(bucketTypeOfTitle('[EPIC] Bugfix inbox')).toBe('bugfix');
    expect(bucketTypeOfTitle('Collab gaps')).toBe('bugfix');
    expect(bucketTypeOfTitle('Real work')).toBe(null);
  });
});

describe('bucket-registry: ensureBucket singleton', () => {
  test('two CONCURRENT ensureBucket(bugfix) -> exactly ONE row', async () => {
    const project = freshProject();
    projects.push(project);
    const [a, b] = await Promise.all([
      ensureBucket(project, 'bugfix'),
      ensureBucket(project, 'bugfix'),
    ]);
    expect(a).toBe(b);
    const db = openDb(project);
    const n = (db.query(
      `SELECT COUNT(*) AS n FROM todos WHERE bucketType = 'bugfix' AND status != 'dropped'`,
    ).get() as { n: number }).n;
    expect(n).toBe(1);
    expect(isBucketEpic(getTodo(project, a)!)).toBe(true);
  });

  test('a second ensureBucket returns the SAME id (idempotent find)', async () => {
    const project = freshProject();
    projects.push(project);
    const first = await ensureBucket(project, 'inbox');
    const second = await ensureBucket(project, 'inbox');
    expect(second).toBe(first);
  });
});

describe('bucket-registry: caller-set bucketType is rejected', () => {
  test('createTodo throws on a caller-supplied bucketType', async () => {
    const project = freshProject();
    projects.push(project);
    await expect(
      createTodo(project, { ownerSession: 's', kind: 'epic', title: 'X', bucketType: 'inbox' } as any),
    ).rejects.toThrow(/bucketType/i);
  });

  test('add_session_todo (addSessionTodo) throws on a caller-supplied bucketType', async () => {
    const project = freshProject();
    projects.push(project);
    await expect(
      addSessionTodo(project, 's', 'X', undefined, { kind: 'epic', bucketType: 'inbox' } as any),
    ).rejects.toThrow(/bucketType/i);
  });
});

describe('bucket-registry: V5 dedup migration', () => {
  test('two "Bugfix inbox" rows collapse to one survivor with children re-homed — no UNIQUE throw', () => {
    const project = freshProject();
    projects.push(project);
    const dbPath = join(project, '.collab', 'todos.db');

    const raw = new Database(dbPath);
    raw.exec(LEGACY_DDL);

    const keep = 'aaaaaaaa-0000-0000-0000-000000000001';
    const dupe = 'bbbbbbbb-0000-0000-0000-000000000002';
    const child = 'cccccccc-0000-0000-0000-000000000003';
    const ins = raw.prepare(
      `INSERT INTO todos (id, ownerSession, parentId, title, status, ord, createdAt, updatedAt, kind, isBucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(keep, 'o', null, 'Bugfix inbox', 'planned', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);
    ins.run(dupe, 'o', null, 'Bugfix inbox', 'planned', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);
    ins.run(child, 'o', dupe, 'A filed bug', 'planned', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'leaf', 0);

    raw.exec('PRAGMA user_version = 4'); // skip V4 so only V5 runs on these non-canonical ids
    raw.close();

    const db = openDb(project); // runs migrations; must NOT throw SQLITE_CONSTRAINT_UNIQUE

    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBeGreaterThanOrEqual(TODO_BUCKET_TYPE_V5);

    const survivors = db.query(
      `SELECT id FROM todos WHERE bucketType = 'bugfix' AND status != 'dropped'`,
    ).all() as Array<{ id: string }>;
    expect(survivors.length).toBe(1);
    const survivorId = survivors[0]!.id;

    const childRow = getTodo(project, child)!;
    expect(childRow.parentId).toBe(survivorId);

    const anyBugfix = db.query(
      `SELECT COUNT(*) AS n FROM todos WHERE bucketType = 'bugfix'`,
    ).get() as { n: number };
    expect(anyBugfix.n).toBe(1);
  });
});

describe('bucket-registry: V6 fold migration (triageTag + bugfix dedup)', () => {
  test('Collab gaps child stamped with triageTag, re-homed to bugfix survivor, duplicate dropped', () => {
    const project = freshProject();
    projects.push(project);
    const dbPath = join(project, '.collab', 'todos.db');

    const raw = new Database(dbPath);
    raw.exec(LEGACY_DDL);

    const bugfixKeep = 'aaaaaaaa-0000-0000-0000-000000000001';
    const collabGaps = 'bbbbbbbb-0000-0000-0000-000000000002';
    const gapChild = 'cccccccc-0000-0000-0000-000000000003';
    const bugfixDupe = 'dddddddd-0000-0000-0000-000000000004';
    const ins = raw.prepare(
      `INSERT INTO todos (id, ownerSession, parentId, title, status, ord, createdAt, updatedAt, kind, isBucket)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(bugfixKeep, 'o', null, 'Bugfix inbox', 'planned', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);
    ins.run(collabGaps, 'o', null, 'Collab gaps', 'planned', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);
    ins.run(gapChild, 'o', collabGaps, '[gap] Recurring friction: x (orchestration, ×4)', 'planned', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'leaf', 0);
    ins.run(bugfixDupe, 'o', null, 'Bugfix inbox', 'planned', 4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'epic', 1);

    raw.exec('PRAGMA user_version = 4'); // so both V5 and V6 run
    raw.close();

    const db = openDb(project); // runs V5 and V6 migrations; must NOT throw UNIQUE

    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBeGreaterThanOrEqual(TODO_TRIAGE_TAG_V6);

    // Exactly one non-dropped bugfix bucket survives
    const bugfixSurvivors = db.query(
      `SELECT id FROM todos WHERE bucketType = 'bugfix' AND status != 'dropped'`,
    ).all() as Array<{ id: string }>;
    expect(bugfixSurvivors.length).toBe(1);
    const survivorId = bugfixSurvivors[0]!.id;

    // The Collab gaps child is re-homed to the bugfix survivor
    const childRow = getTodo(project, gapChild)!;
    expect(childRow.parentId).toBe(survivorId);

    // The child's triageTag is stamped from the title suffix
    expect(childRow.triageTag).toBe('orchestration');

    // The duplicate bugfix is dropped (status=dropped, bucketType=null)
    const dupRow = getTodo(project, bugfixDupe)!;
    expect(dupRow.status).toBe('dropped');
    expect(dupRow.bucketType).toBe(null);

    // The Collab gaps epic is also dropped (it's a duplicate bucket)
    const collabRow = getTodo(project, collabGaps)!;
    expect(collabRow.status).toBe('dropped');
    expect(collabRow.bucketType).toBe(null);
  });
});
