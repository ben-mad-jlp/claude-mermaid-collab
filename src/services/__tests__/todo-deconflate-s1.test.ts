import { describe, test, expect } from 'bun:test';
import Database from 'bun:sqlite';
import {
  readClaim,
  writeClaim,
  backfillDeconflateV1,
  MAX_CLAIM_RETRIES,
  type ClaimStruct,
} from '../todo-store';

// Minimal todos table matching the S1 schema shape (the columns the accessor +
// backfill touch). Enough to exercise readClaim/writeClaim and the backfill SQL
// in isolation, without going through openDb's project resolution.
function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      retryCount INTEGER NOT NULL DEFAULT 0,
      dependsOn TEXT NOT NULL DEFAULT '[]',
      acceptanceStatus TEXT,
      claimedBy TEXT, claimToken TEXT, claimedAt TEXT, claimLeaseMs INTEGER,
      claim TEXT, approvedAt TEXT, approvedBy TEXT, heldAt TEXT, heldReason TEXT
    );
  `);
  return db;
}

function insert(db: Database, row: Record<string, unknown>): void {
  const cols = ['id', 'status', 'updatedAt', 'retryCount', 'dependsOn', 'acceptanceStatus', 'claimedBy', 'claimToken', 'claimedAt', 'claimLeaseMs', 'claim', 'approvedAt', 'approvedBy', 'heldAt', 'heldReason'];
  const defaults: Record<string, unknown> = {
    retryCount: 0, dependsOn: '[]', acceptanceStatus: null,
    claimedBy: null, claimToken: null, claimedAt: null, claimLeaseMs: null,
    claim: null, approvedAt: null, approvedBy: null, heldAt: null, heldReason: null,
    updatedAt: '2026-06-16T09:00:00Z',
  };
  const merged = { ...defaults, ...row };
  const binds = cols.map((c) => (merged[c] ?? null) as string | number | null);
  db.prepare(`INSERT INTO todos (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...binds);
}

function get(db: Database, id: string): any {
  return db.query('SELECT * FROM todos WHERE id=?').get(id);
}

describe('readClaim / writeClaim round-trip', () => {
  test('writeClaim sets all 5 columns; readClaim returns the struct', () => {
    const db = freshDb();
    insert(db, { id: 't1', status: 'in_progress' });
    const c: ClaimStruct = { by: 'coord', token: 'tok-1', at: '2026-06-16T10:00:00Z', leaseMs: 60000 };
    writeClaim(db, 't1', c);
    const row = get(db, 't1');
    expect(row.claimedBy).toBe('coord');
    expect(row.claimToken).toBe('tok-1');
    expect(row.claimedAt).toBe('2026-06-16T10:00:00Z');
    expect(row.claimLeaseMs).toBe(60000);
    expect(JSON.parse(row.claim)).toEqual(c);
    expect(readClaim(row)).toEqual(c);
  });

  test('writeClaim(null) clears all 5 columns; readClaim returns null', () => {
    const db = freshDb();
    insert(db, { id: 't1', status: 'in_progress' });
    writeClaim(db, 't1', { by: 'c', token: 't', at: 'a', leaseMs: 1 });
    writeClaim(db, 't1', null);
    const row = get(db, 't1');
    expect(row.claimedBy).toBeNull();
    expect(row.claimToken).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.claimLeaseMs).toBeNull();
    expect(row.claim).toBeNull();
    expect(readClaim(row)).toBeNull();
  });

  test('readClaim derives from legacy cols when claim JSON absent', () => {
    const row = { claim: null, claimedBy: 'a', claimToken: 'b', claimedAt: 'c', claimLeaseMs: 5 };
    expect(readClaim(row)).toEqual({ by: 'a', token: 'b', at: 'c', leaseMs: 5 });
  });

  test('orphan class: ANY of the 4 legacy cols null → readClaim null', () => {
    expect(readClaim({ claim: null, claimedBy: null, claimToken: 'b', claimedAt: 'c', claimLeaseMs: 5 })).toBeNull();
    expect(readClaim({ claim: null, claimedBy: 'a', claimToken: null, claimedAt: 'c', claimLeaseMs: 5 })).toBeNull();
    expect(readClaim({ claim: null, claimedBy: 'a', claimToken: 'b', claimedAt: null, claimLeaseMs: 5 })).toBeNull();
    expect(readClaim({ claim: null, claimedBy: 'a', claimToken: 'b', claimedAt: 'c', claimLeaseMs: null })).toBeNull();
  });
});

describe('backfillDeconflateV1', () => {
  test('approvedAt: set for ready/blocked/in_progress/done/dropped, NULL for planned/backlog/todo', () => {
    const db = freshDb();
    insert(db, { id: 'ready', status: 'ready', updatedAt: 'U1' });
    insert(db, { id: 'blocked', status: 'blocked', updatedAt: 'U2' });
    insert(db, { id: 'done', status: 'done', updatedAt: 'U3' });
    insert(db, { id: 'dropped', status: 'dropped', updatedAt: 'U4' });
    insert(db, { id: 'planned', status: 'planned' });
    insert(db, { id: 'backlog', status: 'backlog' });
    insert(db, { id: 'todo', status: 'todo' });
    // in_progress row must have a full claim or the assertion is irrelevant; give it one
    insert(db, { id: 'inprog', status: 'in_progress', updatedAt: 'U5', claimedBy: 'c', claimToken: 't', claimedAt: 'a', claimLeaseMs: 1 });

    backfillDeconflateV1(db);

    expect(get(db, 'ready').approvedAt).toBe('U1');
    expect(get(db, 'blocked').approvedAt).toBe('U2');
    expect(get(db, 'done').approvedAt).toBe('U3');
    expect(get(db, 'dropped').approvedAt).toBe('U4');
    expect(get(db, 'inprog').approvedAt).toBe('U5');
    expect(get(db, 'planned').approvedAt).toBeNull();
    expect(get(db, 'backlog').approvedAt).toBeNull();
    expect(get(db, 'todo').approvedAt).toBeNull();
  });

  test('heldAt: blocked + deps NOT satisfied → NULL (re-derives as deps-pending)', () => {
    const db = freshDb();
    insert(db, { id: 'dep', status: 'ready' }); // not done → unsatisfied
    insert(db, { id: 'w', status: 'blocked', dependsOn: JSON.stringify(['dep']) });
    backfillDeconflateV1(db);
    expect(get(db, 'w').heldAt).toBeNull();
    expect(get(db, 'w').heldReason).toBeNull();
  });

  test('heldAt: blocked + deps satisfied + no open deps → migrated-park hold', () => {
    const db = freshDb();
    insert(db, { id: 'dep', status: 'done', acceptanceStatus: 'accepted' });
    insert(db, { id: 'w', status: 'blocked', updatedAt: 'UW', dependsOn: JSON.stringify(['dep']) });
    backfillDeconflateV1(db);
    expect(get(db, 'w').heldAt).toBe('UW');
    expect(get(db, 'w').heldReason).toBe('migrated-park');
  });

  test('heldAt: blocked + deps satisfied + retryCount>=MAX → hold', () => {
    const db = freshDb();
    // no deps at all → noOpenDeps true anyway; use retryCount path explicitly with a done dep
    insert(db, { id: 'dep', status: 'done' });
    insert(db, { id: 'w', status: 'blocked', updatedAt: 'UW', retryCount: MAX_CLAIM_RETRIES, dependsOn: JSON.stringify(['dep']) });
    backfillDeconflateV1(db);
    expect(get(db, 'w').heldAt).toBe('UW');
    expect(get(db, 'w').heldReason).toBe('migrated-park');
  });

  test('heldAt: blocked rows with empty deps → held (no open deps)', () => {
    const db = freshDb();
    insert(db, { id: 'w', status: 'blocked', updatedAt: 'UW' });
    backfillDeconflateV1(db);
    expect(get(db, 'w').heldAt).toBe('UW');
  });

  test('claim: in_progress full legacy cols → packed JSON; orphan → NULL', () => {
    const db = freshDb();
    insert(db, { id: 'full', status: 'in_progress', updatedAt: 'U', claimedBy: 'c', claimToken: 't', claimedAt: 'a', claimLeaseMs: 99 });
    insert(db, { id: 'orphan', status: 'in_progress', updatedAt: 'U', claimedBy: 'c', claimToken: null, claimedAt: 'a', claimLeaseMs: 99 });
    backfillDeconflateV1(db);
    expect(JSON.parse(get(db, 'full').claim)).toEqual({ by: 'c', token: 't', at: 'a', leaseMs: 99 });
    expect(get(db, 'orphan').claim).toBeNull();
  });

  test('idempotent: a second run is a no-op (no throw, same values)', () => {
    const db = freshDb();
    insert(db, { id: 'done', status: 'done', updatedAt: 'U3' });
    insert(db, { id: 'w', status: 'blocked', updatedAt: 'UW' });
    backfillDeconflateV1(db);
    const after1 = { done: get(db, 'done'), w: get(db, 'w') };
    backfillDeconflateV1(db);
    expect(get(db, 'done').approvedAt).toBe(after1.done.approvedAt);
    expect(get(db, 'w').heldAt).toBe(after1.w.heldAt);
  });

  test('post-backfill approvedAt invariant holds (no throw) across a mixed graph', () => {
    const db = freshDb();
    insert(db, { id: 'a', status: 'done', updatedAt: 'U' });
    insert(db, { id: 'b', status: 'blocked', updatedAt: 'U' });
    insert(db, { id: 'c', status: 'ready', updatedAt: 'U' });
    insert(db, { id: 'd', status: 'dropped', updatedAt: 'U' });
    insert(db, { id: 'e', status: 'planned' });
    insert(db, { id: 'f', status: 'in_progress', updatedAt: 'U', claimedBy: 'c', claimToken: 't', claimedAt: 'a', claimLeaseMs: 1 });
    expect(() => backfillDeconflateV1(db)).not.toThrow();
    const orphan = db.query(
      `SELECT COUNT(*) AS n FROM todos WHERE approvedAt IS NULL AND status NOT IN ('planned','backlog','todo')`
    ).get() as { n: number };
    expect(orphan.n).toBe(0);
  });

  test('assertion fires when a row violates the invariant (defensive guard)', () => {
    const db = freshDb();
    // A status the approvedAt UPDATE does NOT cover cannot exist by construction;
    // simulate a corrupt enum value to prove the assertion is wired and throws.
    insert(db, { id: 'x', status: 'weird-status', updatedAt: 'U' });
    expect(() => backfillDeconflateV1(db)).toThrow(/assertion failed/);
  });
});
