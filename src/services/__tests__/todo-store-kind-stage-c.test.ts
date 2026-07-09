// Runs via `bun test` (uses bun:sqlite). Stage C of the title-prefix → `kind`
// column migration (decision e852fb0c): the insert-path fallback to
// kindFromTitle is gone (BOMB 1), and initSchema now STRIPS the three role
// prefixes from stored titles, keyed on the already-backfilled `kind` column.
//
// Every test opens its own temp dir (`fs.mkdtempSync`) as the "project" — never
// the tracking repo's `.collab/todos.db`.
import Database from 'bun:sqlite';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTodo, getTodo, updateTodo, _closeProject } from '../todo-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-store-kind-stage-c-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

function dbPath(p: string): string {
  return join(p, '.collab', 'todos.db');
}

describe('BOMB 1 — post-strip insert path never derives kind from the title', () => {
  test('explicit kind is stored as given', async () => {
    const epic = await createTodo(project, { kind: 'epic', title: 'Bugfix inbox', ownerSession: 's' });
    expect(epic.kind).toBe('epic');
    expect((await getTodo(project, epic.id))!.kind).toBe('epic');
  });

  test('a bracket-prefixed-LOOKING title with NO kind stores leaf, not the bracket role', async () => {
    // This is the actual bomb: pre-strip, createTodo derived kind from the title
    // prefix via kindFromTitle. Post-strip, kind is explicit-only and defaults
    // to 'leaf' — the title is never consulted on insert.
    const t = await createTodo(project, { allowOrphan: true, title: '[EPIC] looks like one', ownerSession: 's' });
    expect(t.kind).toBe('leaf');
  });

  test('a bare mission-looking title with no kind stores leaf', async () => {
    const t = await createTodo(project, { allowOrphan: true, title: '[MISSION] looks like one', ownerSession: 's' });
    expect(t.kind).toBe('leaf');
  });

  test('a bare land-looking title with no kind stores leaf', async () => {
    const t = await createTodo(project, { allowOrphan: true, title: 'Land X → master', ownerSession: 's' });
    expect(t.kind).toBe('leaf');
  });
});

describe('no NULL kinds after a handful of creates', () => {
  test('every inserted row has a non-NULL kind', async () => {
    await createTodo(project, { kind: 'epic', title: 'E1', ownerSession: 's' });
    await createTodo(project, { allowOrphan: true, title: 'L1', ownerSession: 's' });
    await createTodo(project, { allowOrphan: true, title: 'L2', ownerSession: 's' });
    const db = new Database(dbPath(project));
    const row = db.query(`SELECT count(*) AS n FROM todos WHERE kind IS NULL`).get() as { n: number };
    db.close();
    expect(row.n).toBe(0);
  });
});

/** Raw-INSERT a legacy row (bypassing createTodo) to simulate a pre-migration
 *  row: title carries the role prefix, `kind` is NULL, exactly as a row written
 *  by a pre-stage-A binary would look. */
function seedLegacyRow(db: Database, id: string, title: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO todos (id, ownerSession, assigneeKind, title, status, dependsOn, ord, createdAt, updatedAt, retryCount)
     VALUES (?, 's', 'agent', ?, 'planned', '[]', ?, ?, ?, 0)`,
  ).run(id, title, 10, now, now);
}

describe('stage-C strip migration', () => {
  test('strips exactly the three role prefixes, keyed on kind; topic tags survive verbatim', async () => {
    // Seed via a first createTodo (creates the DB + runs initSchema on an EMPTY
    // db), then close it and re-open the raw sqlite file to insert legacy rows
    // BEFORE the next todo-store openDb (so the migration runs against them).
    await createTodo(project, { allowOrphan: true, title: 'bootstrap', ownerSession: 's' });
    _closeProject(project);

    const raw = new Database(dbPath(project));
    seedLegacyRow(raw, 'id-epic', '[EPIC] Foo');
    seedLegacyRow(raw, 'id-mission', '[MISSION] Converge');
    seedLegacyRow(raw, 'id-land', '[LAND] → master');
    seedLegacyRow(raw, 'id-ui', "[UI] Plan list doesn't refresh");
    seedLegacyRow(raw, 'id-kindc', '[kind C] STRIP');
    seedLegacyRow(raw, 'id-leaf', 'plain leaf');

    const roleLike = (col: string) =>
      `(TRIM(${col}) LIKE '[MISSION]%' OR TRIM(${col}) LIKE '[EPIC]%' OR TRIM(${col}) LIKE '[LAND]%')`;
    const before_role = (raw.query(`SELECT count(*) AS n FROM todos WHERE ${roleLike('title')}`).get() as { n: number }).n;
    const before_brack = (raw.query(`SELECT count(*) AS n FROM todos WHERE TRIM(title) LIKE '[%]%'`).get() as { n: number }).n;
    const before_total = (raw.query(`SELECT count(*) AS n FROM todos`).get() as { n: number }).n;
    raw.close();

    // Re-open via todo-store — runs initSchema → kind backfill + strip.
    const bootstrap = await getTodo(project, 'nonexistent-forces-open');
    expect(bootstrap).toBeNull(); // just forcing openDb; not asserting on this

    const after = new Database(dbPath(project));
    const after_role = (after.query(`SELECT count(*) AS n FROM todos WHERE ${roleLike('title')}`).get() as { n: number }).n;
    const after_brack = (after.query(`SELECT count(*) AS n FROM todos WHERE TRIM(title) LIKE '[%]%'`).get() as { n: number }).n;
    const after_total = (after.query(`SELECT count(*) AS n FROM todos`).get() as { n: number }).n;

    expect(after_role).toBe(0);
    expect(after_brack).toBe(before_brack - before_role);
    expect(after_total).toBe(before_total);

    const rows = after.query(`SELECT id, title, kind FROM todos WHERE id LIKE 'id-%'`).all() as Array<{ id: string; title: string; kind: string }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    after.close();

    expect(byId.get('id-epic')).toEqual({ id: 'id-epic', title: 'Foo', kind: 'epic' });
    expect(byId.get('id-mission')).toEqual({ id: 'id-mission', title: 'Converge', kind: 'mission' });
    expect(byId.get('id-land')).toEqual({ id: 'id-land', title: '→ master', kind: 'land' });
    expect(byId.get('id-ui')).toEqual({ id: 'id-ui', title: "[UI] Plan list doesn't refresh", kind: 'leaf' });
    expect(byId.get('id-kindc')).toEqual({ id: 'id-kindc', title: '[kind C] STRIP', kind: 'leaf' });
    expect(byId.get('id-leaf')).toEqual({ id: 'id-leaf', title: 'plain leaf', kind: 'leaf' });

    // Byte-identical for the topic-tagged titles — the strip must not touch them.
    expect(byId.get('id-ui')!.title).toBe("[UI] Plan list doesn't refresh");
    expect(byId.get('id-kindc')!.title).toBe('[kind C] STRIP');
  });

  test('idempotence: re-opening a third time changes zero rows', async () => {
    await createTodo(project, { allowOrphan: true, title: 'bootstrap', ownerSession: 's' });
    _closeProject(project);
    const raw = new Database(dbPath(project));
    seedLegacyRow(raw, 'id-epic', '[EPIC] Foo');
    seedLegacyRow(raw, 'id-ui', '[UI] keep me');
    raw.close();

    // Second open — runs backfill + strip.
    await getTodo(project, 'force-open-2');
    _closeProject(project);

    const before = new Database(dbPath(project));
    const snapshotBefore = before.query(`SELECT id, title, kind FROM todos ORDER BY id`).all();
    before.close();

    // Third open — must be a no-op.
    await getTodo(project, 'force-open-3');

    const after = new Database(dbPath(project));
    const snapshotAfter = after.query(`SELECT id, title, kind FROM todos ORDER BY id`).all();
    after.close();

    expect(snapshotAfter).toEqual(snapshotBefore);
  });
});

describe('Inbox find-or-create across the migration boundary', () => {
  test('a legacy [EPIC] Inbox row is matched (not duplicated) after the strip', async () => {
    await createTodo(project, { allowOrphan: true, title: 'bootstrap', ownerSession: 's' });
    _closeProject(project);
    const raw = new Database(dbPath(project));
    seedLegacyRow(raw, 'id-inbox', '[EPIC] Inbox');
    raw.close();

    // Force the migration to run (backfill assigns kind='epic', strip drops the prefix → 'Inbox').
    await getTodo(project, 'force-open');

    const created = await createTodo(project, { ownerSession: 's', title: 'thought', inbox: true });
    const db = new Database(dbPath(project));
    const epics = db.query(`SELECT id FROM todos WHERE kind='epic' AND title='Inbox'`).all() as Array<{ id: string }>;
    db.close();

    expect(epics).toHaveLength(1);
    expect(epics[0]!.id).toBe('id-inbox');
    expect(created.parentId).toBe('id-inbox');
  });
});

describe('cascade-close does not read the title', () => {
  test('renaming a leaf to "[EPIC] renamed" while closing it does not cascade-drop siblings', async () => {
    const epic = await createTodo(project, { kind: 'epic', title: 'parent epic', ownerSession: 's' });
    const sibling = await createTodo(project, { title: 'untouched sibling', ownerSession: 's', parentId: epic.id });
    const renamed = await createTodo(project, { title: 'plain leaf', ownerSession: 's', parentId: epic.id });

    await updateTodo(project, renamed.id, { title: '[EPIC] renamed', completed: true });

    expect((await getTodo(project, sibling.id))!.status).not.toBe('dropped');
    expect((await getTodo(project, epic.id))!.status).not.toBe('done'); // epic itself untouched
  });
});
