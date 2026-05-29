// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, listTodos, getTodo, updateTodo, assignTodo, removeTodo, clearCompleted, reorder, _closeProject,
} from '../todo-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-store-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('todo-store', () => {
  test('createTodo returns the upgraded shape, completed derived false', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'first' });
    expect(typeof t.id).toBe('string');
    expect(t.ownerSession).toBe('s1');
    expect(t.status).toBe('todo');
    expect(t.completed).toBe(false);
    expect(t.order).toBe(10);
    expect(t.dependsOn).toEqual([]);
  });

  test('listTodos session scope is owner-only; assigneeSession filter is separate; excludes done by default', async () => {
    await createTodo(project, { ownerSession: 's1', title: 'a' });
    await createTodo(project, { ownerSession: 's1', assigneeSession: 's2', title: 'b' });
    await createTodo(project, { ownerSession: 's3', title: 'c' });
    // `session` scopes by OWNER only — 'b' is owned by s1 (assigned to s2), so s2 owns nothing.
    expect(listTodos(project, { session: 's2' }).map((t) => t.title)).toEqual([]);
    expect(listTodos(project, { session: 's1' }).map((t) => t.title).sort()).toEqual(['a', 'b']);
    // assignee filter surfaces work assigned to a session regardless of owner.
    expect(listTodos(project, { assigneeSession: 's2' }).map((t) => t.title)).toEqual(['b']);

    const done = await createTodo(project, { ownerSession: 's1', title: 'd' });
    await updateTodo(project, done.id, { status: 'done' });
    expect(listTodos(project, { session: 's1' }).some((t) => t.title === 'd')).toBe(false);
    expect(listTodos(project, { session: 's1', includeCompleted: true }).some((t) => t.title === 'd')).toBe(true);
  });

  test('createTodo defaults assigneeSession to the owner session (assigned to the session it was added in)', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'a' });
    expect(t.assigneeSession).toBe('s1');
    // explicit assignee still wins
    const u = await createTodo(project, { ownerSession: 's1', assigneeSession: 's2', title: 'b' });
    expect(u.assigneeSession).toBe('s2');
  });

  test('getTodo returns null for a missing id', () => {
    expect(getTodo(project, 'nope')).toBeNull();
  });

  test('updateTodo syncs completed + completedAt when status -> done', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await updateTodo(project, t.id, { status: 'done' });
    expect(u.completed).toBe(true);
    expect(u.completedAt).not.toBeNull();
  });

  test('updateTodo with completed:true forces status done', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await updateTodo(project, t.id, { completed: true });
    expect(u.status).toBe('done');
  });

  test('assignTodo sets assigneeSession', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await assignTodo(project, t.id, 's2');
    expect(u.assigneeSession).toBe('s2');
  });

  test('removeTodo throws for missing id', async () => {
    await expect(removeTodo(project, 'nope')).rejects.toThrow('todo not found');
  });

  test('clearCompleted removes only done todos for the session', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'a' });
    await createTodo(project, { ownerSession: 's1', title: 'b' });
    await updateTodo(project, a.id, { status: 'done' });
    const res = await clearCompleted(project, 's1');
    expect(res.removed).toBe(1);
    expect(listTodos(project, { session: 's1', includeCompleted: true }).map((t) => t.title)).toEqual(['b']);
  });

  test('reorder reassigns ord in x10 increments', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'a' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'b' });
    await reorder(project, [b.id, a.id]);
    const ordered = listTodos(project, { session: 's1' });
    expect(ordered.map((t) => t.title)).toEqual(['b', 'a']);
    expect(ordered.map((t) => t.order)).toEqual([10, 20]);
  });

  test('link round-trips as JSON', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', link: { blueprintId: 'bp', taskId: 'tk' } });
    expect(getTodo(project, t.id)!.link).toEqual({ blueprintId: 'bp', taskId: 'tk' });
  });
});
