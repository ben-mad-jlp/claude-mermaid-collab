import { describe, test, expect } from 'bun:test';
import Database from 'bun:sqlite';
import {
  backfillParentReleaseV2,
  type TodoStatus,
} from '../todo-store';
import { claimReason, isClaimable } from '../claimability';
import type { Todo } from '../todo-store';

// Minimal todos table for parent-release backfill testing. Includes kind and parentId
// for the gate logic.
function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      parentId TEXT,
      approvedAt TEXT,
      approvedBy TEXT,
      acceptanceStatus TEXT
    );
  `);
  return db;
}

function insert(db: Database, row: Record<string, unknown>): void {
  const cols = ['id', 'kind', 'status', 'updatedAt', 'parentId', 'approvedAt', 'approvedBy', 'acceptanceStatus'];
  const defaults: Record<string, unknown> = {
    parentId: null,
    approvedAt: null,
    approvedBy: null,
    acceptanceStatus: null,
    updatedAt: '2026-06-16T09:00:00Z',
  };
  const merged = { ...defaults, ...row };
  const binds = cols.map((c) => (merged[c] ?? null) as string | null);
  db.prepare(`INSERT INTO todos (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...binds);
}

function get(db: Database, id: string): any {
  return db.query('SELECT * FROM todos WHERE id=?').get(id);
}

function buildTodo(row: any): Partial<Todo> {
  return {
    id: row.id,
    kind: row.kind as any,
    status: row.status as TodoStatus,
    updatedAt: row.updatedAt,
    parentId: row.parentId,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    acceptanceStatus: row.acceptanceStatus as any,
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: row.id,
    description: null,
    completed: false,
    priority: null,
    dueDate: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    servesCriterionId: null,
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
  };
}

describe('backfillParentReleaseV2', () => {
  test('case 1: backfill releases an epic with an approved child', () => {
    const db = freshDb();
    insert(db, { id: 'ep', kind: 'epic', status: 'planned', updatedAt: 'U1', approvedAt: null });
    insert(db, { id: 'child', kind: 'leaf', status: 'planned', updatedAt: 'U2', parentId: 'ep', approvedAt: 'U2' });

    backfillParentReleaseV2(db);

    expect(get(db, 'ep').approvedAt).toBe('U1');
  });

  test('case 2: migration invariant — planned epic + approved children → epic released, all children claimable', () => {
    const db = freshDb();
    insert(db, { id: 'ep', kind: 'epic', status: 'planned', updatedAt: 'U_EP', approvedAt: null });
    insert(db, { id: 'c1', kind: 'leaf', status: 'planned', updatedAt: 'U_C1', parentId: 'ep', approvedAt: 'U_C1' });
    insert(db, { id: 'c2', kind: 'leaf', status: 'planned', updatedAt: 'U_C2', parentId: 'ep', approvedAt: 'U_C2' });

    backfillParentReleaseV2(db);

    // Epic released
    expect(get(db, 'ep').approvedAt).toBe('U_EP');

    // Feed through claimReason to verify all children are claimable
    const epicRow = buildTodo(get(db, 'ep'));
    const c1Row = buildTodo(get(db, 'c1'));
    const c2Row = buildTodo(get(db, 'c2'));

    const byId = new Map<string, Partial<Todo>>();
    byId.set('ep', epicRow);
    byId.set('c1', c1Row);
    byId.set('c2', c2Row);

    expect(claimReason(c1Row as Todo, byId as any)).toBe('claimable');
    expect(isClaimable(c1Row as Todo, byId as any)).toBe(true);
    expect(claimReason(c2Row as Todo, byId as any)).toBe('claimable');
    expect(isClaimable(c2Row as Todo, byId as any)).toBe(true);
  });

  test('case 3: in-flight child not revoked — child approvedAt untouched, claimReason is in-flight', () => {
    const db = freshDb();
    insert(db, { id: 'ep', kind: 'epic', status: 'planned', updatedAt: 'U_EP', approvedAt: null });
    insert(db, { id: 'infl', kind: 'leaf', status: 'in_progress', updatedAt: 'U_INF', parentId: 'ep', approvedAt: 'U_INF' });

    backfillParentReleaseV2(db);

    // Child's approvedAt should stay the same
    expect(get(db, 'infl').approvedAt).toBe('U_INF');

    // claimReason reports in-flight (protected by top-of-ladder)
    const inflRow = buildTodo(get(db, 'infl'));
    inflRow.claim = { by: 'coord', token: 'tok', at: 'T', leaseMs: 1000 };

    const byId = new Map<string, Partial<Todo>>();
    byId.set('ep', buildTodo(get(db, 'ep')));
    byId.set('infl', inflRow);

    expect(claimReason(inflRow as Todo, byId as any)).toBe('in-flight');
  });

  test('case 4: no approved child → epic left NULL', () => {
    const db = freshDb();
    insert(db, { id: 'ep', kind: 'epic', status: 'planned', updatedAt: 'U', approvedAt: null });
    insert(db, { id: 'child', kind: 'leaf', status: 'planned', updatedAt: 'U', parentId: 'ep', approvedAt: null });

    backfillParentReleaseV2(db);

    expect(get(db, 'ep').approvedAt).toBeNull();
  });

  test('case 5: idempotent — second run changes no approvedAt value', () => {
    const db = freshDb();
    insert(db, { id: 'ep', kind: 'epic', status: 'planned', updatedAt: 'U_EP', approvedAt: null });
    insert(db, { id: 'child', kind: 'leaf', status: 'planned', updatedAt: 'U_C', parentId: 'ep', approvedAt: 'U_C' });

    backfillParentReleaseV2(db);
    const after1 = get(db, 'ep').approvedAt;

    backfillParentReleaseV2(db);
    const after2 = get(db, 'ep').approvedAt;

    expect(after1).toBe(after2);
    expect(after2).toBe('U_EP');
  });

  test('case 6: leaf-with-children is NOT released (kind=leaf, not epic)', () => {
    const db = freshDb();
    insert(db, { id: 'leaf_parent', kind: 'leaf', status: 'planned', updatedAt: 'U_P', approvedAt: null });
    insert(db, { id: 'child', kind: 'leaf', status: 'planned', updatedAt: 'U_C', parentId: 'leaf_parent', approvedAt: 'U_C' });

    backfillParentReleaseV2(db);

    // Leaf parent must stay NULL (only epics are released)
    expect(get(db, 'leaf_parent').approvedAt).toBeNull();
    // Child stays approved
    expect(get(db, 'child').approvedAt).toBe('U_C');
  });
});
