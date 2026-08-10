/**
 * Two hazards that the consolidation INTRODUCED, neither of which had a test watching it.
 *
 * 1. `todos.parentId` now cascades on delete. That is the point — it replaces a hand-written
 *    cascade and makes orphans unrepresentable — but it silently widens every existing DELETE.
 *    `clearCompleted` was the dangerous one: a DONE container in the matched set would take its
 *    whole subtree, including `in_progress` children and children owned by OTHER sessions that
 *    its WHERE clause deliberately excludes, while reporting only the directly-matched count.
 *
 * 2. The import must survive a LEGACY database shape. A source missing a column is the definition
 *    of legacy; a positional `INSERT ... SELECT *` fails on exactly those databases, and because
 *    the import runs inside the opener, that throw takes down every store call for the project
 *    rather than just the migration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createTodo, clearCompleted, openDb } from '../todo-store';

/** Row ids actually on disk. listTodos applies view filters; survival is the question here. */
function idsOnDisk(proj: string): string[] {
  return (openDb(proj).query('SELECT id FROM todos').all() as Array<{ id: string }>).map((r) => r.id);
}
import { openCollabDb, _closeAllCollabDbs, lastImportReport } from '../collab-db';

const made: string[] = [];
function tmpProject(prefix: string): string {
  const p = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(p);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

afterEach(() => {
  _closeAllCollabDbs();
  while (made.length) { try { rmSync(made.pop()!, { recursive: true, force: true }); } catch { /* ignore */ } }
});

describe('clearCompleted under an enforced delete cascade', () => {
  let proj: string;
  beforeEach(() => { proj = tmpProject('clear-completed-'); });

  it('does NOT take a live child away with its done parent', async () => {
    const epic = await createTodo(proj, { title: 'epic', ownerSession: 'me', kind: 'epic', status: 'done' });
    // Unfinished, so `clearCompleted` has no business touching it — directly or by cascade.
    const leaf = await createTodo(proj, { title: 'leaf', ownerSession: 'me', kind: 'leaf', parentId: epic.id });

    const { removed } = await clearCompleted(proj, 'me');

    const ids = idsOnDisk(proj);
    expect(ids).toContain(leaf.id); // the live child survives …
    expect(ids).toContain(epic.id); // … and so must its parent, or the child is orphaned
    expect(removed).toBe(0);
  });

  it('does NOT take another session\'s child, even a done one', async () => {
    const epic = await createTodo(proj, { title: 'epic', ownerSession: 'me', kind: 'epic', status: 'done' });
    const theirs = await createTodo(proj, {
      title: 'theirs', ownerSession: 'someone-else', kind: 'leaf', parentId: epic.id, status: 'done',
    });

    await clearCompleted(proj, 'me');

    // The WHERE clause deliberately scopes to one session; the cascade must not smuggle past it.
    expect(idsOnDisk(proj)).toContain(theirs.id);
  });

  it('clears a fully-done subtree bottom-up, and COUNTS every row it removed', async () => {
    const epic = await createTodo(proj, { title: 'epic', ownerSession: 'me', kind: 'epic', status: 'done' });
    await createTodo(proj, { title: 'a', ownerSession: 'me', kind: 'leaf', parentId: epic.id, status: 'done' });
    await createTodo(proj, { title: 'b', ownerSession: 'me', kind: 'leaf', parentId: epic.id, status: 'done' });

    const { removed } = await clearCompleted(proj, 'me');

    expect(idsOnDisk(proj)).toHaveLength(0);
    // 3, not 1: a count of directly-matched rows would under-report what was destroyed.
    expect(removed).toBe(3);
  });

  it('still clears an ordinary flat set of done todos', async () => {
    await createTodo(proj, { title: 'x', ownerSession: 'me', kind: 'leaf', status: 'done', allowOrphan: true });
    const live = await createTodo(proj, { title: 'y', ownerSession: 'me', kind: 'leaf', allowOrphan: true });

    const { removed } = await clearCompleted(proj, 'me');

    expect(removed).toBe(1);
    expect(idsOnDisk(proj)).toEqual([live.id]);
  });
});

/** A minimal pre-consolidation todos.db holding exactly one work item. */
function legacyTodosOnly(proj: string): void {
    const todos = new Database(join(proj, '.collab', 'todos.db'), { create: true });
    todos.exec(`CREATE TABLE todos (
      id TEXT PRIMARY KEY, ownerSession TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
      dependsOn TEXT NOT NULL, ord REAL NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      retryCount INTEGER NOT NULL, assigneeKind TEXT NOT NULL, isBucket INTEGER NOT NULL,
      reserveCount INTEGER NOT NULL, baseMovedRefunds INTEGER NOT NULL, baseRepair INTEGER NOT NULL,
      kind TEXT, parentId TEXT)`);
    todos.prepare(
      `INSERT INTO todos VALUES ('m1','s','mission','todo','[]',1,'t','t',0,'agent',0,0,0,0,'mission',NULL)`,
    ).run();
    todos.close();
}

describe('the import tolerates a legacy database shape', () => {
  /** A mission.db predating several columns — exactly what an old machine carries. */
  function legacyPair(proj: string): void {
    legacyTodosOnly(proj);

    // Deliberately SHORT: no forgeState, no queuePos, no archivedAt on mission; mission_criterion
    // stops at `evidence`. A positional `SELECT *` cannot copy either of these.
    const mission = new Database(join(proj, '.collab', 'mission.db'), { create: true });
    mission.exec(`
      CREATE TABLE mission (todoId TEXT PRIMARY KEY, createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE mission_criterion (id TEXT PRIMARY KEY, todoId TEXT NOT NULL, text TEXT NOT NULL,
        met INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL, evidence TEXT);
      CREATE TABLE mission_recheck (criterionId TEXT PRIMARY KEY, todoId TEXT NOT NULL,
        reason TEXT NOT NULL, enqueuedAt INTEGER NOT NULL);
      CREATE TABLE mission_criterion_verdict_history (id TEXT PRIMARY KEY, criterionId TEXT NOT NULL,
        todoId TEXT NOT NULL, met INTEGER NOT NULL, clearedAt INTEGER NOT NULL)`);
    mission.prepare('INSERT INTO mission VALUES (?,?,?,1)').run('m1', 1, 1);
    mission.prepare('INSERT INTO mission_criterion VALUES (?,?,?,?,?,?)')
      .run('c1', 'm1', 'the criterion', 1, 5, 'proof');
    mission.close();
  }

  it('imports a mission.db that is short several columns', () => {
    const proj = tmpProject('legacy-shape-');
    legacyPair(proj);

    const db = openCollabDb(proj); // must not throw — a throw here bricks the whole project

    const crit = db.query('SELECT text, met, evidence, forgeState IS NULL AS n FROM mission_criterion, mission')
      .get() as { text: string; met: number; evidence: string } | null;
    expect(crit?.text).toBe('the criterion');
    expect(crit?.evidence).toBe('proof');       // the columns it DOES have are carried
    expect((db.query('SELECT queuePos FROM mission').get() as { queuePos: null }).queuePos)
      .toBeNull();                               // the ones it lacks take the destination default
    expect(lastImportReport(proj)?.violations).toEqual([]);
  });

  it('reports a source column the destination cannot hold, rather than dropping it quietly', () => {
    const proj = tmpProject('legacy-extra-');
    legacyPair(proj);
    const mission = new Database(join(proj, '.collab', 'mission.db'));
    mission.exec("ALTER TABLE mission ADD COLUMN retiredKnob TEXT");
    mission.prepare("UPDATE mission SET retiredKnob = 'held real data'").run();
    mission.close();

    openCollabDb(proj);

    expect(lastImportReport(proj)?.violations.join(' ')).toContain('retiredKnob');
  });
});

describe('a FAILED import must not strand the project', () => {
  it('leaves no destination behind, so the next open retries instead of serving an empty database', () => {
    const proj = tmpProject('import-fail-');
    // A todos.db that is not a database at all. Any failure mode does: the point is that the
    // importer creates its destination BEFORE it reads the source, so a naive implementation
    // leaves a complete, empty, migrated collab.db and the existence guard then skips the import
    // forever — turning a populated project permanently empty, silently.
    Bun.write(join(proj, '.collab', 'todos.db'), 'not a database');

    expect(() => openCollabDb(proj)).toThrow();
    expect(existsSync(join(proj, '.collab', 'collab.db'))).toBe(false);
    expect(existsSync(join(proj, '.collab', 'collab.db.importing'))).toBe(false);

    // And it is still a retry, not a permanent state: repair the source and the move completes.
    rmSync(join(proj, '.collab', 'todos.db'));
    legacyTodosOnly(proj);
    const db = openCollabDb(proj);
    expect((db.query('SELECT COUNT(*) c FROM todos').get() as { c: number }).c).toBe(1);
  });
});
