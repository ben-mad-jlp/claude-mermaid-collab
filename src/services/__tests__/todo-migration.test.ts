// Runs via `bun test` (touches bun:sqlite via the store) — excluded from vitest.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateProject } from '../todo-migration';
import { listTodos, _closeProject } from '../todo-store';

let project: string;

function seedSession(session: string, todos: unknown[]) {
  const dir = join(project, '.collab', 'sessions', session);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session-todos.json'), JSON.stringify({ todos, nextId: todos.length + 1 }));
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-migration-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('migrateProject', () => {
  test('migrates legacy per-session files into the store, mapping fields', async () => {
    seedSession('session-a', [
      { id: 1, text: 'first', completed: false, order: 10, link: { blueprintId: 'bp' } },
      { id: 2, text: 'second', completed: true, order: 20 },
    ]);
    seedSession('session-b', [{ id: 1, text: 'b-one', completed: false, order: 10 }]);

    const res = await migrateProject(project);
    expect(res.migrated).toBe(3);

    const a = listTodos(project, { session: 'session-a', includeCompleted: true });
    expect(a.map((t) => t.title).sort()).toEqual(['first', 'second']);
    expect(a.every((t) => t.ownerSession === 'session-a')).toBe(true);
    expect(a.find((t) => t.title === 'second')!.status).toBe('done');
    expect(a.find((t) => t.title === 'first')!.link).toEqual({ blueprintId: 'bp' });
    expect(listTodos(project, { session: 'session-b' }).map((t) => t.title)).toEqual(['b-one']);

    // source renamed, sidecar written
    expect(existsSync(join(project, '.collab', 'sessions', 'session-a', 'session-todos.json'))).toBe(false);
    expect(existsSync(join(project, '.collab', 'sessions', 'session-a', 'session-todos.json.migrated'))).toBe(true);
    expect(existsSync(join(project, '.collab', 'sessions', 'session-a', 'session-todos.migrated.json'))).toBe(true);
  });

  test('is idempotent — a second run migrates nothing', async () => {
    seedSession('s', [{ id: 1, text: 'x', completed: false, order: 10 }]);
    expect((await migrateProject(project)).migrated).toBe(1);
    expect((await migrateProject(project)).migrated).toBe(0);
    expect(listTodos(project, { session: 's' }).length).toBe(1); // not duplicated
  });

  test('no sessions dir → 0', async () => {
    expect((await migrateProject(project)).migrated).toBe(0);
  });
});
