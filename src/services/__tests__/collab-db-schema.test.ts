/**
 * The consolidated schema exists to make two measured defects UNREPRESENTABLE, not merely
 * discouraged:
 *
 *  1. A mission row outliving its node, or a claim outliving its leaf. Previously impossible to
 *     enforce because they lived in different DATABASE FILES; SQLite can enforce nothing across
 *     files and no transaction spans them. Measured drift on 2026-08-10: todos.status said 2
 *     leaves were running while the global leaf_inflight held 0 rows, and 3 leaf_blueprint rows
 *     referenced deleted todos.
 *  2. "In progress" as a status someone is trusted to clear. The daemon is SIGKILLed by its
 *     liveness watchdog (477 times in 18 days) and SIGKILL runs no cleanup, so a claim must be a
 *     fact with a deadline.
 *
 * These tests assert the constraints actually BITE, which for SQLite means checking that foreign
 * keys are switched on — they are per-connection and default OFF, so a declared-but-unenforced FK
 * is a real and easy failure mode.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { COLLAB_DB_MIGRATIONS, enforceForeignKeys } from '../collab-db-schema';
import { applyMigrations } from '../schema-migrate';

const OPTS = { storeName: 'collab', now: () => 1_700_000_000_000 };

function freshDb(withFk = true): Database {
  const db = new Database(':memory:');
  if (withFk) enforceForeignKeys(db);
  applyMigrations(db, COLLAB_DB_MIGRATIONS, OPTS);
  return db;
}

function addTodo(db: Database, id: string, kind = 'leaf', parentId: string | null = null) {
  db.prepare(
    `INSERT INTO todos (id, ownerSession, title, status, dependsOn, ord, createdAt, updatedAt,
                        retryCount, assigneeKind, isBucket, reserveCount, baseMovedRefunds,
                        baseRepair, kind, parentId)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, 'sess', 't', 'todo', '[]', 1, 'now', 'now', 0, 'agent', 0, 0, 0, 0, kind, parentId);
}

let db: Database;
beforeEach(() => { db = freshDb(); });

describe('one database, so integrity is enforceable at all', () => {
  it('rejects a mission row whose node does not exist', () => {
    expect(() =>
      db.prepare('INSERT INTO mission (todoId, createdAt, updatedAt, active) VALUES (?,?,?,1)')
        .run('ghost-mission', 1, 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('rejects a criterion whose mission node does not exist', () => {
    expect(() =>
      db.prepare('INSERT INTO mission_criterion (id, todoId, text, updatedAt) VALUES (?,?,?,?)')
        .run('c1', 'ghost', 'text', 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('deletes a mission node and its criteria together, in one transaction', () => {
    addTodo(db, 'm1', 'mission');
    db.prepare('INSERT INTO mission (todoId, createdAt, updatedAt, active) VALUES (?,?,?,1)').run('m1', 1, 1);
    db.prepare('INSERT INTO mission_criterion (id, todoId, text, updatedAt) VALUES (?,?,?,?)').run('c1', 'm1', 'x', 1);

    db.prepare('DELETE FROM todos WHERE id=?').run('m1');

    // Previously these lived in another FILE, so a drop left them behind as orphans.
    expect((db.query('SELECT COUNT(*) c FROM mission').get() as { c: number }).c).toBe(0);
    expect((db.query('SELECT COUNT(*) c FROM mission_criterion').get() as { c: number }).c).toBe(0);
  });

  it('cascades to child work items, replacing the hand-written drop cascade', () => {
    addTodo(db, 'epic1', 'epic');
    addTodo(db, 'leaf1', 'leaf', 'epic1');
    db.prepare('DELETE FROM todos WHERE id=?').run('epic1');
    expect((db.query('SELECT COUNT(*) c FROM todos').get() as { c: number }).c).toBe(0);
  });
});

describe('claims are leases', () => {
  it('cannot exist without their leaf', () => {
    expect(() =>
      db.prepare('INSERT INTO leaf_claim (leafId, holder, acquiredAt, expiresAt, heartbeatAt) VALUES (?,?,?,?,?)')
        .run('no-such-leaf', 'w1', 1, 2, 1),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('vanish with their leaf, so a dropped leaf cannot stay "claimed"', () => {
    addTodo(db, 'leaf1');
    db.prepare('INSERT INTO leaf_claim (leafId, holder, acquiredAt, expiresAt, heartbeatAt) VALUES (?,?,?,?,?)')
      .run('leaf1', 'w1', 1, 999, 1);
    db.prepare('DELETE FROM todos WHERE id=?').run('leaf1');
    expect((db.query('SELECT COUNT(*) c FROM leaf_claim').get() as { c: number }).c).toBe(0);
  });

  it('expire, so a SIGKILLed holder does not strand the leaf forever', () => {
    addTodo(db, 'leaf1');
    db.prepare('INSERT INTO leaf_claim (leafId, holder, acquiredAt, expiresAt, heartbeatAt) VALUES (?,?,?,?,?)')
      .run('leaf1', 'dead-worker', 1000, 2000, 1000);
    const now = 5000;
    const live = db.query('SELECT COUNT(*) c FROM leaf_claim WHERE expiresAt > ?').get(now) as { c: number };
    expect(live.c).toBe(0); // reclaimable by a sweeper without anyone having "released" it
  });

  it('one holder per leaf — the PK makes a double claim impossible', () => {
    addTodo(db, 'leaf1');
    const ins = db.prepare('INSERT INTO leaf_claim (leafId, holder, acquiredAt, expiresAt, heartbeatAt) VALUES (?,?,?,?,?)');
    ins.run('leaf1', 'w1', 1, 999, 1);
    expect(() => ins.run('leaf1', 'w2', 1, 999, 1)).toThrow(/UNIQUE|PRIMARY KEY/i);
  });
});

describe('history is not integrity-checked', () => {
  it('verdict history survives the criterion it judged', () => {
    // 6 of 10 live rows already reference dropped criteria. A judgement remains a true fact about
    // the past after its subject is gone; an FK here would refuse to record it or delete it later.
    expect(() =>
      db.prepare(
        `INSERT INTO mission_criterion_verdict_history (id, criterionId, todoId, met, clearedAt)
         VALUES (?,?,?,?,?)`,
      ).run('h1', 'long-dropped-criterion', 'long-dropped-mission', 1, 123),
    ).not.toThrow();
  });
});

describe('constraints that were previously unenforced', () => {
  it('rejects an unknown kind', () => {
    expect(() => addTodo(db, 'x', 'nonsense')).toThrow(/CHECK/i);
  });

  it('rejects a NULL id (the old TEXT PK permitted one)', () => {
    expect(() => addTodo(db, null as unknown as string)).toThrow(/NOT NULL/i);
  });
});

describe('the enforcement switch itself', () => {
  it('FKs do NOT bite without the pragma — the trap this guards against', () => {
    // SQLite foreign keys are per-connection and default OFF. Every declaration in the schema is
    // inert until enforceForeignKeys runs, and a schema that reads as protected but is not is
    // worse than none. This test exists so that regressing the pragma fails loudly here.
    const unguarded = freshDb(false);
    expect(() =>
      unguarded.prepare('INSERT INTO mission (todoId, createdAt, updatedAt, active) VALUES (?,?,?,1)')
        .run('ghost', 1, 1),
    ).not.toThrow();
    const guarded = freshDb(true);
    expect(() =>
      guarded.prepare('INSERT INTO mission (todoId, createdAt, updatedAt, active) VALUES (?,?,?,1)')
        .run('ghost', 1, 1),
    ).toThrow(/FOREIGN KEY/i);
  });
});
