import { describe, test, expect, afterAll } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { openDb, getTodo, createTodo, _closeProject } from '../todo-store';

const NICKNAME_RE = /^[a-z0-9]+(-[a-z0-9]+){1,3}$/;

const tmpDirs: string[] = [];
function freshProject(prefix: string): string {
  const dir = mkdtempSync(join(os.tmpdir(), prefix));
  mkdirSync(join(dir, '.collab'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    _closeProject(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('todo nickname column', () => {
  test('created mission and epic todos each carry a non-empty hyphenated nickname readable via getTodo', async () => {
    const project = freshProject('todo-nickname-create-');

    // createTodo is a synchronous, in-process await on the project lock — the nickname is
    // computed inside that critical section with no network/LLM call on the path.
    const mission = await createTodo(project, {
      ownerSession: 'test-owner',
      title: 'Nickname every work graph entity',
      kind: 'mission',
    });
    const epic = await createTodo(project, {
      ownerSession: 'test-owner',
      title: 'Backfill nickname column on todo rows',
      kind: 'epic',
    });

    for (const created of [mission, epic]) {
      const read = getTodo(project, created.id)!;
      // nickname is optional in the type (always populated by rowToTodo); assert it is present.
      expect(read.nickname).toBeDefined();
      expect(read.nickname ?? '').toMatch(NICKNAME_RE);
      expect((read.nickname ?? '').length).toBeGreaterThan(0);
    }

    expect(getTodo(project, mission.id)!.nickname).not.toBe(
      getTodo(project, epic.id)!.nickname,
    );
  });

  test('reopening a fixture DB seeded with NULL nicknames backfills every row to a non-empty unique nickname', () => {
    const project = freshProject('todo-nickname-backfill-');
    const dbPath = join(project, '.collab', 'todos.db');

    const seed = new Database(dbPath);
    seed.exec(`
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
        targetProject TEXT
      )
    `);
    const ins = seed.prepare(
      'INSERT INTO todos (id, ownerSession, title, status, ord, createdAt, updatedAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const ts = '2026-01-01T00:00:00Z';
    // Two rows share a title on purpose: uniquification must still yield distinct nicknames.
    ins.run('11111111-0000-0000-0000-000000000001', 'test-owner', 'Nickname rows', 'planned', 1, ts, ts, 'leaf');
    ins.run('22222222-0000-0000-0000-000000000002', 'test-owner', 'Nickname rows', 'planned', 2, ts, ts, 'leaf');
    ins.run('33333333-0000-0000-0000-000000000003', 'test-owner', 'Backfill existing rows', 'planned', 3, ts, ts, 'leaf');
    // Only the V10 gate should fire.
    seed.exec('PRAGMA user_version = 9');
    seed.close();

    const db = openDb(project);

    const cols = db.query('PRAGMA table_info(todos)').all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === 'nickname')).toBe(true);

    const rows = db.query('SELECT id, nickname FROM todos').all() as Array<{
      id: string;
      nickname: string | null;
    }>;
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.nickname).toBeTruthy();
      expect(row.nickname!).toMatch(NICKNAME_RE);
    }
    expect(new Set(rows.map((r) => r.nickname)).size).toBe(3);
  });
});
