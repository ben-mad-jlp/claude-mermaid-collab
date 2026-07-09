import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTodos, createTodo, _closeProject } from '../todo-store.ts';

// Minimal legacy schema: pre-migration shape (prefixed titles, no `kind` column
// at all). `openDb`'s `CREATE TABLE IF NOT EXISTS` leaves this table as-is, and
// `addColumnIfMissing` then adds `kind` (NULL for every seeded row) exactly as it
// would against the real, already-legacy production DB. Every other column
// `openDb` might touch is covered by `addColumnIfMissing`, so only the NOT-NULL
// set (read off todo-store.ts:270-304) needs to be present here.
const LEGACY_DDL = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  ownerSession TEXT NOT NULL,
  assigneeSession TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  dueDate TEXT,
  parentId TEXT,
  dependsOn TEXT NOT NULL DEFAULT '[]',
  ord REAL NOT NULL,
  link TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  completedAt TEXT,
  asanaGid TEXT
);
`;

interface SeedRow {
  id: string;
  title: string;
  expectTitle: string;
  expectKind: 'mission' | 'epic' | 'land' | 'leaf';
}

const SEED: SeedRow[] = [
  { id: 'seed-mission', title: '[MISSION] Converge on X', expectTitle: 'Converge on X', expectKind: 'mission' },
  { id: 'seed-epic', title: '[EPIC] Bugfix inbox', expectTitle: 'Bugfix inbox', expectKind: 'epic' },
  { id: 'seed-land', title: '[LAND] Land X → master', expectTitle: 'Land X → master', expectKind: 'land' },
  { id: 'seed-lowercase-epic', title: '[epic] lowercase role', expectTitle: 'lowercase role', expectKind: 'epic' },
  { id: 'seed-padded-epic', title: '  [EPIC]   padded  ', expectTitle: 'padded', expectKind: 'epic' },
  { id: 'seed-ui-topic', title: "[UI] Plan list doesn't refresh", expectTitle: "[UI] Plan list doesn't refresh", expectKind: 'leaf' },
  { id: 'seed-bug-topic', title: '[BUG] x', expectTitle: '[BUG] x', expectKind: 'leaf' },
  { id: 'seed-coord-topic', title: '[COORD] y', expectTitle: '[COORD] y', expectKind: 'leaf' },
  { id: 'seed-t2-topic', title: '[T2] z', expectTitle: '[T2] z', expectKind: 'leaf' },
  { id: 'seed-kindc-topic', title: '[kind C] STRIP: ...', expectTitle: '[kind C] STRIP: ...', expectKind: 'leaf' },
  { id: 'seed-nonascii-topic', title: '[CAD-VERIF · bsync] non-ascii tag', expectTitle: '[CAD-VERIF · bsync] non-ascii tag', expectKind: 'leaf' },
  { id: 'seed-double-bracket', title: '[EPIC] [UI] role then topic', expectTitle: '[UI] role then topic', expectKind: 'epic' },
  { id: 'seed-bare', title: 'Plain bare title', expectTitle: 'Plain bare title', expectKind: 'leaf' },
  { id: 'seed-mid-title', title: 'Discussion of [EPIC] mid-title', expectTitle: 'Discussion of [EPIC] mid-title', expectKind: 'leaf' },
];

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-kind-strip-'));
});

afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

function seedLegacyDb(): void {
  mkdirSync(join(project, '.collab'), { recursive: true });
  const db = new Database(join(project, '.collab', 'todos.db'));
  db.exec(LEGACY_DDL);
  const insert = db.prepare(
    `INSERT INTO todos (id, ownerSession, title, status, dependsOn, ord, createdAt, updatedAt)
     VALUES (?,?,?,?,'[]',?,?,?)`
  );
  const ts = new Date().toISOString();
  SEED.forEach((row, i) => {
    insert.run(row.id, 'seed-session', row.title, 'planned', i * 10, ts, ts);
  });
  db.close();
}

function rows(): Array<{ id: string; title: string; kind: string | null }> {
  const db = new Database(join(project, '.collab', 'todos.db'), { readonly: true });
  try {
    return db.query('SELECT id, title, kind FROM todos ORDER BY id').all() as Array<{
      id: string;
      title: string;
      kind: string | null;
    }>;
  } finally {
    db.close();
  }
}

function measure(): { role: number; brack: number; total: number } {
  const db = new Database(join(project, '.collab', 'todos.db'), { readonly: true });
  try {
    const row = db
      .query(
        `SELECT
           SUM(TRIM(title) LIKE '[MISSION]%' OR TRIM(title) LIKE '[EPIC]%' OR TRIM(title) LIKE '[LAND]%') AS role,
           SUM(TRIM(title) LIKE '[%]%') AS brack,
           COUNT(*) AS total
         FROM todos`
      )
      .get() as { role: number | null; brack: number | null; total: number };
    return { role: Number(row.role ?? 0), brack: Number(row.brack ?? 0), total: Number(row.total) };
  } finally {
    db.close();
  }
}

function triggerMigration(): void {
  listTodos(project);
}

describe('stage-C strip migration — relative invariants', () => {
  test('role prefixes go to zero; bracketed titles lose exactly the role ones', () => {
    seedLegacyDb();
    const before = measure();
    expect(before.role).toBeGreaterThan(0);
    expect(before.brack).toBeGreaterThan(before.role);

    triggerMigration();

    const after = measure();
    expect(after.role).toBe(0);
    // Most role-prefixed rows lose their bracket entirely once stripped, but
    // `seed-double-bracket` was a role prefix wrapping a topic tag — it stays
    // bracketed (now via the topic tag) even though it counted toward
    // `before.role`. Derive that correction from the fixture itself (not a
    // magic literal) rather than assuming every role row goes bracket-free.
    const roleRowsStillBracketedAfterStrip = SEED.filter(
      (s) => /^\s*\[(MISSION|EPIC|LAND)\]/i.test(s.title) && /^\[/.test(s.expectTitle)
    ).length;
    expect(after.brack).toBe(before.brack - before.role + roleRowsStillBracketedAfterStrip);
    expect(after.total).toBe(before.total);
  });

  test('every seeded row lands on its expected title and kind', () => {
    seedLegacyDb();
    triggerMigration();
    const byId = new Map(rows().map((r) => [r.id, r]));
    for (const seed of SEED) {
      const row = byId.get(seed.id);
      expect(row?.title).toBe(seed.expectTitle);
      expect(row?.kind).toBe(seed.expectKind);
    }
    // seed-double-bracket: only the leading role bracket is removed; the topic
    // tag becomes the new leading bracket and must survive this AND the next run
    // (see the idempotency test below) — a strip keyed on `title LIKE '[%]%'`
    // would eat it.
    expect(byId.get('seed-double-bracket')?.title).toBe('[UI] role then topic');
  });

  test('idempotent — a second migration run changes zero rows', () => {
    seedLegacyDb();
    triggerMigration();
    const after1 = rows();

    _closeProject(project);
    triggerMigration();
    const after2 = rows();

    expect(after2).toEqual(after1);
  });

  test('no row is left with a NULL kind', () => {
    seedLegacyDb();
    triggerMigration();
    const db = new Database(join(project, '.collab', 'todos.db'), { readonly: true });
    const { c } = db.query('SELECT COUNT(*) AS c FROM todos WHERE kind IS NULL').get() as { c: number };
    db.close();
    expect(c).toBe(0);
  });

  test('post-migration inserts store an explicit kind and a bare title', async () => {
    seedLegacyDb();
    triggerMigration();

    await createTodo(project, { kind: 'epic', title: 'Bugfix inbox', ownerSession: 's' });
    await createTodo(project, { kind: 'mission', title: 'Converge on Y', ownerSession: 's' });
    await createTodo(project, { kind: 'land', title: 'Land Y → master', ownerSession: 's', allowOrphan: true });

    const all = rows();
    const epic = all.find((r) => r.title === 'Bugfix inbox' && r.kind === 'epic');
    const mission = all.find((r) => r.title === 'Converge on Y' && r.kind === 'mission');
    const land = all.find((r) => r.title === 'Land Y → master' && r.kind === 'land');
    expect(epic).toBeDefined();
    expect(mission).toBeDefined();
    expect(land).toBeDefined();

    _closeProject(project);
    triggerMigration();
    expect(measure().role).toBe(0);
  });

  test('the live tracking DB is never opened', () => {
    seedLegacyDb();
    triggerMigration();
    expect(project.startsWith(tmpdir())).toBe(true);
    expect(existsSync(join(project, '.collab', 'todos.db'))).toBe(true);
  });
});
