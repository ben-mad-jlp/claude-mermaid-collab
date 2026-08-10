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

describe('a database stamped at an OLD cut of a version', () => {
  it('is repaired by a NEW version, because re-editing the old one can never reach it', () => {
    // The 2026-08-10 incident in one test. v1 originally omitted asanaGid/blueprintId; putting
    // them back INSIDE v1 left every ALREADY-STAMPED database without them forever, and every
    // epic base gate went red on `table todos has no column named asanaGid`. A schema version is
    // a claim about what a database already contains — changing the code behind a version number
    // makes that claim false for every database that recorded it.
    //
    // Built by running the current v1 and then rebuilding `todos` without the two columns, which
    // is what the first cut of v1 actually produced. (ALTER TABLE DROP COLUMN is NOT used here:
    // against this schema SQLite rejects it with "incomplete input" — noted, not chased.)
    const db = new Database(':memory:');
    applyMigrations(db, [COLLAB_DB_MIGRATIONS[0]!], OPTS);
    db.exec(`
      CREATE TABLE todos_old AS SELECT * FROM todos;
      DROP TABLE todos;
      CREATE TABLE todos (
        id TEXT PRIMARY KEY NOT NULL, ownerSession TEXT NOT NULL, title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo', parentId TEXT REFERENCES todos(id) ON DELETE CASCADE,
        dependsOn TEXT NOT NULL DEFAULT '[]', ord REAL NOT NULL,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, retryCount INTEGER NOT NULL DEFAULT 0,
        assigneeKind TEXT NOT NULL DEFAULT 'agent', isBucket INTEGER NOT NULL DEFAULT 0,
        reserveCount INTEGER NOT NULL DEFAULT 0, baseMovedRefunds INTEGER NOT NULL DEFAULT 0,
        baseRepair INTEGER NOT NULL DEFAULT 0,
        kind TEXT CHECK (kind IN ('mission','epic','leaf','land','gate'))
      );`);
    const before = (db.query('PRAGMA table_info(todos)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(before).not.toContain('asanaGid'); // the broken state really is the starting point

    applyMigrations(db, COLLAB_DB_MIGRATIONS, OPTS); // v1 is spent; only v2 can reach this database

    const after = (db.query('PRAGMA table_info(todos)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(after).toContain('asanaGid');
    expect(after).toContain('blueprintId');
  });

  it('is a no-op on a database built by the current v1', () => {
    const fresh = freshDb();
    expect(() => applyMigrations(fresh, COLLAB_DB_MIGRATIONS, OPTS)).not.toThrow();
    expect(() => addTodo(fresh, 'y')).not.toThrow();
  });
});
