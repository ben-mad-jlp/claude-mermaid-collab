/**
 * Tests for parent-epic-under-mission.ts. Always against a throwaway temp db —
 * never `.collab/todos.db`.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { main, applyReparent, planReparent } from '../parent-epic-under-mission.ts';

let currentPath: string | null = null;

function makeDb(): { path: string; db: Database } {
  const path = join(tmpdir(), `peum-${randomUUID()}.db`);
  currentPath = path;
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec(`
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      title TEXT,
      parentId TEXT,
      status TEXT,
      kind TEXT,
      claimedBy TEXT,
      claimToken TEXT,
      claimedAt TEXT,
      claimLeaseMs INTEGER,
      claim TEXT,
      executedBySession TEXT,
      updatedAt TEXT
    );
  `);

  const insert = db.query(
    `INSERT INTO todos (id, title, parentId, status, kind, claimedBy, claim, executedBySession, updatedAt)
     VALUES ($id, $title, $parentId, $status, $kind, $claimedBy, $claim, $executedBySession, $updatedAt)`,
  );

  insert.run({
    $id: 'M',
    $title: 'Converge on X',
    $parentId: null,
    $status: 'planned',
    $kind: 'mission',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'E',
    $title: 'Deliverable epic',
    $parentId: null,
    $status: 'planned',
    $kind: 'epic',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'B',
    $title: 'Inbox',
    $parentId: null,
    $status: 'planned',
    $kind: 'epic',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'L',
    $title: 'A leaf',
    $parentId: 'E',
    $status: 'planned',
    $kind: 'leaf',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'C',
    $title: 'Claimed epic',
    $parentId: null,
    $status: 'planned',
    $kind: 'epic',
    $claimedBy: 'w1',
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'P',
    $title: 'Epic with in-flight descendant',
    $parentId: null,
    $status: 'planned',
    $kind: 'epic',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'INFLIGHTLEAF',
    $title: 'in-flight leaf',
    $parentId: 'P',
    $status: 'in_progress',
    $kind: 'leaf',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });
  insert.run({
    $id: 'AP',
    $title: 'Already parented epic',
    $parentId: 'SOME_OTHER_PARENT',
    $status: 'planned',
    $kind: 'epic',
    $claimedBy: null,
    $claim: null,
    $executedBySession: null,
    $updatedAt: '2026-01-01T00:00:00.000Z',
  });

  db.close();
  return { path, db: new Database(path) };
}

afterEach(() => {
  if (currentPath && existsSync(currentPath)) {
    rmSync(currentPath, { force: true });
  }
  currentPath = null;
});

describe('main — dry run', () => {
  it('writes nothing to the db file', () => {
    const { path, db } = makeDb();
    db.close();
    const before = readFileSync(path);

    const exitCode = main(['E', 'M', '--db', path]);

    const after = readFileSync(path);
    expect(exitCode).toBe(0);
    expect(Buffer.compare(before, after)).toBe(0);
  });
});

describe('main --commit', () => {
  it('moves E and only E', () => {
    const { path, db } = makeDb();
    db.close();

    const exitCode = main(['E', 'M', '--commit', '--db', path]);
    expect(exitCode).toBe(0);

    const check = new Database(path);
    const rows = check.query('SELECT id, parentId FROM todos').all() as { id: string; parentId: string | null }[];
    check.close();

    const byId = Object.fromEntries(rows.map((r) => [r.id, r.parentId]));
    expect(byId.E).toBe('M');
    expect(byId.B).toBeNull();
    expect(byId.L).toBe('E');
    expect(byId.C).toBeNull();
    expect(byId.P).toBeNull();
    expect(byId.INFLIGHTLEAF).toBe('P');
    expect(byId.AP).toBe('SOME_OTHER_PARENT');
  });
});

describe('planReparent refusals', () => {
  it('bucket epic -> bucket-epic, message names Inbox', () => {
    const { path, db } = makeDb();
    const result = planReparent(db, 'B', 'M');
    db.close();
    expect(result).toMatchObject({ reason: 'bucket-epic' });
    expect('message' in result && result.message).toContain('Inbox');
  });

  it('non-epic leaf -> not-an-epic, message names leaf', () => {
    const { path, db } = makeDb();
    const result = planReparent(db, 'L', 'M');
    db.close();
    expect(result).toMatchObject({ reason: 'not-an-epic' });
    expect('message' in result && result.message).toContain('leaf');
  });

  it('claimed epic -> claimed, message names claimant', () => {
    const { path, db } = makeDb();
    const result = planReparent(db, 'C', 'M');
    db.close();
    expect(result).toMatchObject({ reason: 'claimed' });
    expect('message' in result && result.message).toContain('w1');
  });

  it('epic with in-flight descendant -> in-flight-descendants', () => {
    const { path, db } = makeDb();
    const result = planReparent(db, 'P', 'M');
    db.close();
    expect(result).toMatchObject({ reason: 'in-flight-descendants' });
  });

  it('already-parented epic -> already-parented', () => {
    const { path, db } = makeDb();
    const result = planReparent(db, 'AP', 'M');
    db.close();
    expect(result).toMatchObject({ reason: 'already-parented' });
  });

  it('target not a mission -> not-a-mission', () => {
    const { path, db } = makeDb();
    const exitCode = main(['E', 'E', '--db', path]);
    db.close();
    expect(exitCode).toBe(2);
  });
});

describe('main — missing args', () => {
  it('returns 1', () => {
    expect(main([])).toBe(1);
  });
});

describe('applyReparent invariant', () => {
  it('exactly one row ends up with parentId = M after commit', () => {
    const { path, db } = makeDb();
    db.close();

    main(['E', 'M', '--commit', '--db', path]);

    const check = new Database(path);
    const rows = check.query('SELECT id FROM todos WHERE parentId = ?').all('M') as { id: string }[];
    check.close();

    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe('E');
  });
});
