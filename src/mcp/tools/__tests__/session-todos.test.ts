/**
 * Tests for session todos tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, access, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getSessionTodosPath,
  readSessionTodosFile,
  writeSessionTodosFile,
  addSessionTodo,
  listSessionTodos,
  updateSessionTodo,
  toggleSessionTodo,
  removeSessionTodo,
  clearCompletedSessionTodos,
  reorderSessionTodos,
} from '../session-todos';

let projectDir: string;
const sessionName = 'test-session';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'session-todos-test-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('getSessionTodosPath', () => {
  it('returns <project>/.collab/sessions/<session>/session-todos.json', () => {
    const p = getSessionTodosPath(projectDir, sessionName);
    expect(p).toBe(join(projectDir, '.collab', 'sessions', sessionName, 'session-todos.json'));
  });
});

describe('readSessionTodosFile', () => {
  it('returns empty default on ENOENT', async () => {
    const data = await readSessionTodosFile(projectDir, sessionName);
    expect(data).toEqual({ todos: [], nextId: 1 });
  });

  it('round-trips after a write', async () => {
    const payload = {
      todos: [
        {
          id: 1,
          text: 'hello',
          completed: false,
          order: 10,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      nextId: 2,
    };
    await writeSessionTodosFile(projectDir, sessionName, payload);
    const read = await readSessionTodosFile(projectDir, sessionName);
    expect(read).toEqual(payload);
  });
});

describe('writeSessionTodosFile', () => {
  it('creates the .collab/sessions/<session>/ chain if missing', async () => {
    const payload = { todos: [], nextId: 1 };
    await writeSessionTodosFile(projectDir, sessionName, payload);
    const dir = join(projectDir, '.collab', 'sessions', sessionName);
    await expect(access(dir)).resolves.toBeUndefined();
  });

  it('writes a file on disk that parses as JSON', async () => {
    const payload = { todos: [], nextId: 1 };
    await writeSessionTodosFile(projectDir, sessionName, payload);
    const content = await readFile(getSessionTodosPath(projectDir, sessionName), 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
    expect(JSON.parse(content)).toEqual(payload);
  });
});

describe('addSessionTodo', () => {
  it('assigns id=1, order=10, completed=false, with timestamps on first add', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'First');
    expect(todo.id).toBe(1);
    expect(todo.order).toBe(10);
    expect(todo.completed).toBe(false);
    expect(todo.text).toBe('First');
    expect(todo.createdAt).toBeTruthy();
    expect(todo.updatedAt).toBeTruthy();
  });

  it('assigns id=2 and order=20 on second add', async () => {
    await addSessionTodo(projectDir, sessionName, 'First');
    const second = await addSessionTodo(projectDir, sessionName, 'Second');
    expect(second.id).toBe(2);
    expect(second.order).toBe(20);
  });

  it('never reuses IDs after remove+add', async () => {
    await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    await removeSessionTodo(projectDir, sessionName, b.id);
    const c = await addSessionTodo(projectDir, sessionName, 'C');
    expect(c.id).toBe(3);
  });

  it('uses max+10 for order, not length*10, after a manual reorder', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');
    // Reorder to produce orders [30, 10, 20] (c, a, b)
    await reorderSessionTodos(projectDir, sessionName, [c.id, a.id, b.id]);

    const next = await addSessionTodo(projectDir, sessionName, 'D');
    expect(next.order).toBe(40);
  });
});

describe('listSessionTodos', () => {
  it('returns empty list when nothing has been added', async () => {
    const list = await listSessionTodos(projectDir, sessionName);
    expect(list).toEqual([]);
  });

  it('returns todos sorted by order ascending', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');
    // Reorder so the on-disk array order differs from sort order
    await reorderSessionTodos(projectDir, sessionName, [c.id, a.id, b.id]);

    const list = await listSessionTodos(projectDir, sessionName);
    expect(list.map((t) => t.order)).toEqual([10, 20, 30]);
    // c->10, a->20, b->30
    expect(list.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it('default returns all (including completed)', async () => {
    await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    await updateSessionTodo(projectDir, sessionName, b.id, { completed: true });

    const list = await listSessionTodos(projectDir, sessionName);
    expect(list).toHaveLength(2);
  });

  it('includeCompleted=false filters out completed todos', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    await updateSessionTodo(projectDir, sessionName, b.id, { completed: true });

    const list = await listSessionTodos(projectDir, sessionName, { includeCompleted: false });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(a.id);
  });
});

describe('updateSessionTodo', () => {
  it('updates text independently and bumps updatedAt', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'Before');
    const originalUpdatedAt = todo.updatedAt;
    await sleep(10);
    const updated = await updateSessionTodo(projectDir, sessionName, todo.id, { text: 'After' });
    expect(updated.text).toBe('After');
    expect(updated.completed).toBe(false);
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('updates completed independently', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'Task');
    const updated = await updateSessionTodo(projectDir, sessionName, todo.id, { completed: true });
    expect(updated.completed).toBe(true);
    expect(updated.text).toBe('Task');
  });

  it('updates order independently', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'Task');
    const updated = await updateSessionTodo(projectDir, sessionName, todo.id, { order: 99 });
    expect(updated.order).toBe(99);
    expect(updated.text).toBe('Task');
  });

  it('throws "Todo not found" on unknown id', async () => {
    await addSessionTodo(projectDir, sessionName, 'Task');
    await expect(
      updateSessionTodo(projectDir, sessionName, 9999, { text: 'nope' })
    ).rejects.toThrow('Todo not found');
  });
});

describe('toggleSessionTodo', () => {
  it('flips completed when no arg', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'Task');
    const once = await toggleSessionTodo(projectDir, sessionName, todo.id);
    expect(once.completed).toBe(true);
    const twice = await toggleSessionTodo(projectDir, sessionName, todo.id);
    expect(twice.completed).toBe(false);
  });

  it('sets explicitly when provided', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'Task');
    const result = await toggleSessionTodo(projectDir, sessionName, todo.id, true);
    expect(result.completed).toBe(true);
  });

  it('is idempotent with explicit value', async () => {
    const todo = await addSessionTodo(projectDir, sessionName, 'Task');
    const a = await toggleSessionTodo(projectDir, sessionName, todo.id, true);
    expect(a.completed).toBe(true);
    const b = await toggleSessionTodo(projectDir, sessionName, todo.id, true);
    expect(b.completed).toBe(true);
  });

  it('throws "Todo not found" on unknown id without explicit arg', async () => {
    await addSessionTodo(projectDir, sessionName, 'Task');
    await expect(toggleSessionTodo(projectDir, sessionName, 9999)).rejects.toThrow(
      'Todo not found'
    );
  });

  it('throws "Todo not found" on unknown id with explicit arg', async () => {
    await addSessionTodo(projectDir, sessionName, 'Task');
    await expect(toggleSessionTodo(projectDir, sessionName, 9999, true)).rejects.toThrow(
      'Todo not found'
    );
  });
});

describe('removeSessionTodo', () => {
  it('removes by id and returns the removed todo', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const removed = await removeSessionTodo(projectDir, sessionName, a.id);
    expect(removed.id).toBe(a.id);
    expect(removed.text).toBe('A');

    const list = await listSessionTodos(projectDir, sessionName);
    expect(list.map((t) => t.id)).toEqual([b.id]);
  });

  it('throws on missing id', async () => {
    await addSessionTodo(projectDir, sessionName, 'Task');
    await expect(removeSessionTodo(projectDir, sessionName, 9999)).rejects.toThrow(
      'Todo not found'
    );
  });
});

describe('clearCompletedSessionTodos', () => {
  it('returns { removedCount: 0 } when nothing is completed', async () => {
    await addSessionTodo(projectDir, sessionName, 'A');
    await addSessionTodo(projectDir, sessionName, 'B');
    const result = await clearCompletedSessionTodos(projectDir, sessionName);
    expect(result).toEqual({ removedCount: 0 });
  });

  it('removes exactly the completed ones with mixed completed/incomplete', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');
    await updateSessionTodo(projectDir, sessionName, a.id, { completed: true });
    await updateSessionTodo(projectDir, sessionName, c.id, { completed: true });

    const result = await clearCompletedSessionTodos(projectDir, sessionName);
    expect(result.removedCount).toBe(2);

    const list = await listSessionTodos(projectDir, sessionName);
    expect(list.map((t) => t.id)).toEqual([b.id]);
  });

  it('does not decrement nextId; next add gets a fresh id', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    await updateSessionTodo(projectDir, sessionName, a.id, { completed: true });
    await updateSessionTodo(projectDir, sessionName, b.id, { completed: true });

    await clearCompletedSessionTodos(projectDir, sessionName);

    const c = await addSessionTodo(projectDir, sessionName, 'C');
    expect(c.id).toBe(3);
  });
});

describe('reorderSessionTodos', () => {
  it('assigns dense orders 10, 20, 30 for a valid permutation', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');

    await reorderSessionTodos(projectDir, sessionName, [c.id, a.id, b.id]);

    const list = await listSessionTodos(projectDir, sessionName);
    expect(list.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    expect(list.map((t) => t.order)).toEqual([10, 20, 30]);
  });

  it('writes the todos array in the new sequence on disk', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');

    await reorderSessionTodos(projectDir, sessionName, [c.id, a.id, b.id]);

    const raw = JSON.parse(
      await readFile(getSessionTodosPath(projectDir, sessionName), 'utf-8')
    );
    expect(raw.todos.map((t: { id: number }) => t.id)).toEqual([c.id, a.id, b.id]);
  });

  it('throws on length mismatch', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    await addSessionTodo(projectDir, sessionName, 'C');

    await expect(
      reorderSessionTodos(projectDir, sessionName, [a.id, b.id])
    ).rejects.toThrow();
  });

  it('throws on unknown id', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');

    await expect(
      reorderSessionTodos(projectDir, sessionName, [a.id, b.id, 9999])
    ).rejects.toThrow();
    // Sanity: c still present
    const list = await listSessionTodos(projectDir, sessionName);
    expect(list.some((t) => t.id === c.id)).toBe(true);
  });

  it('throws on duplicate id', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    await addSessionTodo(projectDir, sessionName, 'C');

    await expect(
      reorderSessionTodos(projectDir, sessionName, [a.id, b.id, a.id])
    ).rejects.toThrow();
  });

  it('bumps updatedAt on all reordered items', async () => {
    const a = await addSessionTodo(projectDir, sessionName, 'A');
    const b = await addSessionTodo(projectDir, sessionName, 'B');
    const c = await addSessionTodo(projectDir, sessionName, 'C');

    const before = new Map<number, string>([
      [a.id, a.updatedAt],
      [b.id, b.updatedAt],
      [c.id, c.updatedAt],
    ]);

    await sleep(10);
    await reorderSessionTodos(projectDir, sessionName, [c.id, a.id, b.id]);

    const list = await listSessionTodos(projectDir, sessionName);
    for (const todo of list) {
      expect(todo.updatedAt).not.toBe(before.get(todo.id));
    }
  });
});

describe('isolation', () => {
  it('two sessions under the same project do not share todos', async () => {
    await addSessionTodo(projectDir, 'session-a', 'A-only');
    await addSessionTodo(projectDir, 'session-b', 'B-only');

    const listA = await listSessionTodos(projectDir, 'session-a');
    const listB = await listSessionTodos(projectDir, 'session-b');

    expect(listA).toHaveLength(1);
    expect(listA[0].text).toBe('A-only');
    expect(listB).toHaveLength(1);
    expect(listB[0].text).toBe('B-only');
  });

  it('two projects do not share todos', async () => {
    const project2 = await mkdtemp(join(tmpdir(), 'session-todos-proj2-'));
    try {
      await addSessionTodo(projectDir, sessionName, 'P1');
      await addSessionTodo(project2, sessionName, 'P2');

      const list1 = await listSessionTodos(projectDir, sessionName);
      const list2 = await listSessionTodos(project2, sessionName);

      expect(list1).toHaveLength(1);
      expect(list1[0].text).toBe('P1');
      expect(list2).toHaveLength(1);
      expect(list2[0].text).toBe('P2');
    } finally {
      await rm(project2, { recursive: true, force: true });
    }
  });

  it('reload equals last write', async () => {
    await addSessionTodo(projectDir, sessionName, 'A');
    await addSessionTodo(projectDir, sessionName, 'B');
    const before = await readSessionTodosFile(projectDir, sessionName);
    const after = await readSessionTodosFile(projectDir, sessionName);
    expect(after).toEqual(before);
  });
});
