/**
 * Tests for project todos tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, access, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listTodos, addTodo, removeTodo, updateTodo, setTodosDataDir } from '../todos';

let tempDir: string;
let globalDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'todos-test-'));
  globalDir = await mkdtemp(join(tmpdir(), 'todos-global-'));
  // Redirect global todos.json to temp directory
  setTodosDataDir(globalDir);
});

afterEach(async () => {
  setTodosDataDir(null);
  await rm(tempDir, { recursive: true, force: true });
  await rm(globalDir, { recursive: true, force: true });
});

describe('listTodos', () => {
  it('should return empty list when no todos file exists', async () => {
    const result = await listTodos(tempDir);
    expect(result.todos).toEqual([]);
    expect(result.count).toBe(0);
  });
});

describe('addTodo', () => {
  it('should add a todo and return it', async () => {
    const result = await addTodo(tempDir, 'First todo');
    expect(result.success).toBe(true);
    expect(result.todo.id).toBe(1);
    expect(result.todo.title).toBe('First todo');
    expect(result.todo.project).toBe(tempDir);
    expect(result.todo.sessionName).toBeTruthy();
    expect(result.todo.createdAt).toBeTruthy();
    expect(result.count).toBe(1);
  });

  it('should auto-increment IDs', async () => {
    const r1 = await addTodo(tempDir, 'First');
    const r2 = await addTodo(tempDir, 'Second');
    const r3 = await addTodo(tempDir, 'Third');

    expect(r1.todo.id).toBe(1);
    expect(r2.todo.id).toBe(2);
    expect(r3.todo.id).toBe(3);
    expect(r3.count).toBe(3);
  });

  it('should generate unique session names', async () => {
    const r1 = await addTodo(tempDir, 'First');
    const r2 = await addTodo(tempDir, 'Second');

    expect(r1.todo.sessionName).toBeTruthy();
    expect(r2.todo.sessionName).toBeTruthy();
    // Session names follow adjective-adjective-noun pattern
    expect(r1.todo.sessionName).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(r2.todo.sessionName).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it('should create session directories and collab-state.json', async () => {
    const result = await addTodo(tempDir, 'Test todo');
    const sessionDir = join(tempDir, '.collab', 'todos', result.todo.sessionName);

    // Verify directories exist
    await expect(access(join(sessionDir, 'diagrams'))).resolves.toBeUndefined();
    await expect(access(join(sessionDir, 'documents'))).resolves.toBeUndefined();

    // Verify collab-state.json
    const stateContent = await readFile(join(sessionDir, 'collab-state.json'), 'utf-8');
    const state = JSON.parse(stateContent);
    expect(state.sessionType).toBe('vibe');
    expect(state.state).toBe('vibe-active');
    expect(state.currentItem).toBeNull();
    expect(state.useRenderUI).toBe(true);
    expect(state.lastActivity).toBeTruthy();
  });

  it('should not reuse IDs after deletions', async () => {
    await addTodo(tempDir, 'First');
    const r2 = await addTodo(tempDir, 'Second');
    await removeTodo(tempDir, r2.todo.id);

    const r3 = await addTodo(tempDir, 'Third');
    expect(r3.todo.id).toBe(3); // Not 2
  });
});

describe('updateTodo', () => {
  it('should update title', async () => {
    await addTodo(tempDir, 'Original');
    const result = await updateTodo(tempDir, 1, { title: 'Updated' });
    expect(result.success).toBe(true);
    expect(result.todo?.title).toBe('Updated');
  });

  it('should return failure for non-existent ID', async () => {
    await addTodo(tempDir, 'Only one');
    const result = await updateTodo(tempDir, 999, { title: 'Nope' });
    expect(result.success).toBe(false);
    expect(result.todo).toBeNull();
  });

  it('should persist updates', async () => {
    await addTodo(tempDir, 'Before');
    await updateTodo(tempDir, 1, { title: 'After' });

    const list = await listTodos(tempDir);
    expect(list.todos[0].title).toBe('After');
  });
});

describe('removeTodo', () => {
  it('should remove a todo by ID', async () => {
    await addTodo(tempDir, 'First');
    const r2 = await addTodo(tempDir, 'Second');
    await addTodo(tempDir, 'Third');

    const result = await removeTodo(tempDir, r2.todo.id);
    expect(result.success).toBe(true);
    expect(result.removed?.title).toBe('Second');
    expect(result.count).toBe(2);

    const list = await listTodos(tempDir);
    expect(list.todos.map((t) => t.title)).toEqual(['First', 'Third']);
  });

  it('should return failure for non-existent ID', async () => {
    await addTodo(tempDir, 'First');
    const result = await removeTodo(tempDir, 999);
    expect(result.success).toBe(false);
    expect(result.removed).toBeNull();
    expect(result.count).toBe(1);
  });

  it('should not affect other todos', async () => {
    await addTodo(tempDir, 'A');
    await addTodo(tempDir, 'B');
    await addTodo(tempDir, 'C');

    await removeTodo(tempDir, 2);

    const list = await listTodos(tempDir);
    expect(list.todos).toHaveLength(2);
    expect(list.todos[0].id).toBe(1);
    expect(list.todos[0].title).toBe('A');
    expect(list.todos[1].id).toBe(3);
    expect(list.todos[1].title).toBe('C');
  });
});

describe('global registry', () => {
  it('should write todos.json to the global data dir', async () => {
    await addTodo(tempDir, 'Test');
    const content = await readFile(join(globalDir, 'todos.json'), 'utf-8');
    const data = JSON.parse(content);
    expect(data.todos).toHaveLength(1);
    expect(data.todos[0].project).toBe(tempDir);
  });

  it('should isolate todos by project', async () => {
    const project2 = await mkdtemp(join(tmpdir(), 'todos-proj2-'));
    try {
      await addTodo(tempDir, 'Project 1 todo');
      await addTodo(project2, 'Project 2 todo');

      const list1 = await listTodos(tempDir);
      expect(list1.count).toBe(1);
      expect(list1.todos[0].title).toBe('Project 1 todo');

      const list2 = await listTodos(project2);
      expect(list2.count).toBe(1);
      expect(list2.todos[0].title).toBe('Project 2 todo');
    } finally {
      await rm(project2, { recursive: true, force: true });
    }
  });
});
