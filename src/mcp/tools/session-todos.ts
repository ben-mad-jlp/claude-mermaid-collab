/**
 * Session Todos Tools
 *
 * MCP tools for managing per-session todo items (checkable list
 * attached to a specific collab session). Stored as JSON at
 * <project>/.collab/sessions/<session>/session-todos.json
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

// ============= Per-(project, session) write mutex =============

const mutexes = new Map<string, Promise<unknown>>();

function withLock<T>(project: string, session: string, fn: () => Promise<T>): Promise<T> {
  const key = `${project}::${session}`;
  const prev = mutexes.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  mutexes.set(
    key,
    next.catch(() => {}).finally(() => {
      if (mutexes.get(key) === next) {
        mutexes.delete(key);
      }
    }),
  );
  return next;
}

// ============= Type Definitions =============

export interface SessionTodo {
  id: number;
  text: string;
  completed: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTodosFile {
  todos: SessionTodo[];
  nextId: number;
}

export interface ListSessionTodosOptions {
  includeCompleted?: boolean;
}

export interface ClearCompletedResult {
  removedCount: number;
}

// ============= Schemas =============

export const listSessionTodosSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    includeCompleted: {
      type: 'boolean',
      description: 'Include completed todos in the result (default: true)',
    },
  },
  required: ['project', 'session'],
};

export const addSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    text: { type: 'string', description: 'Todo text' },
  },
  required: ['project', 'session', 'text'],
};

export const updateSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    id: { type: 'number', description: 'Todo id to update' },
    text: { type: 'string', description: 'New text (optional)' },
    completed: { type: 'boolean', description: 'New completed state (optional)' },
    order: { type: 'number', description: 'New explicit order value (optional)' },
  },
  required: ['project', 'session', 'id'],
};

export const toggleSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    id: { type: 'number', description: 'Todo id to toggle' },
    completed: {
      type: 'boolean',
      description: 'Explicit state; when omitted the current value is flipped',
    },
  },
  required: ['project', 'session', 'id'],
};

export const removeSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    id: { type: 'number', description: 'Todo id to remove' },
  },
  required: ['project', 'session', 'id'],
};

export const clearCompletedSessionTodosSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
  },
  required: ['project', 'session'],
};

export const reorderSessionTodosSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    orderedIds: {
      type: 'array',
      items: { type: 'number' },
      description: 'Full permutation of existing todo ids in desired order',
    },
  },
  required: ['project', 'session', 'orderedIds'],
};

// ============= Helpers =============

export function getSessionTodosPath(project: string, session: string): string {
  return join(project, '.collab', 'sessions', session, 'session-todos.json');
}

export async function readSessionTodosFile(
  project: string,
  session: string
): Promise<SessionTodosFile> {
  const filePath = getSessionTodosPath(project, session);
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<SessionTodosFile>;
    return {
      todos: Array.isArray(parsed.todos) ? (parsed.todos as SessionTodo[]) : [],
      nextId: typeof parsed.nextId === 'number' ? parsed.nextId : 1,
    };
  } catch {
    return { todos: [], nextId: 1 };
  }
}

export async function writeSessionTodosFile(
  project: string,
  session: string,
  data: SessionTodosFile
): Promise<void> {
  const filePath = getSessionTodosPath(project, session);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============= Tool Functions =============

export async function listSessionTodos(
  project: string,
  session: string,
  opts: ListSessionTodosOptions = {}
): Promise<SessionTodo[]> {
  const { includeCompleted = true } = opts;
  const data = await readSessionTodosFile(project, session);
  const todos = includeCompleted
    ? data.todos.slice()
    : data.todos.filter(t => !t.completed);
  todos.sort((a, b) => a.order - b.order);
  return todos;
}

export async function addSessionTodo(
  project: string,
  session: string,
  text: string
): Promise<SessionTodo> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('text must be non-empty');
  return withLock(project, session, async () => {
    const data = await readSessionTodosFile(project, session);
    const maxOrder = data.todos.reduce((m, t) => (t.order > m ? t.order : m), 0);
    const now = nowIso();
    const todo: SessionTodo = {
      id: data.nextId,
      text: trimmed,
      completed: false,
      order: data.todos.length === 0 ? 10 : maxOrder + 10,
      createdAt: now,
      updatedAt: now,
    };
    data.todos.push(todo);
    data.nextId += 1;
    await writeSessionTodosFile(project, session, data);
    return todo;
  });
}

export async function updateSessionTodo(
  project: string,
  session: string,
  id: number,
  updates: { text?: string; completed?: boolean; order?: number }
): Promise<SessionTodo> {
  let trimmedText: string | undefined;
  if (updates.text !== undefined) {
    trimmedText = updates.text.trim();
    if (!trimmedText) throw new Error('text must be non-empty');
  }
  return withLock(project, session, async () => {
    const data = await readSessionTodosFile(project, session);
    const todo = data.todos.find(t => t.id === id);
    if (!todo) {
      throw new Error('Todo not found');
    }
    if (trimmedText !== undefined) todo.text = trimmedText;
    if (updates.completed !== undefined) todo.completed = updates.completed;
    if (updates.order !== undefined) todo.order = updates.order;
    todo.updatedAt = nowIso();
    await writeSessionTodosFile(project, session, data);
    return todo;
  });
}

export async function toggleSessionTodo(
  project: string,
  session: string,
  id: number,
  completed?: boolean
): Promise<SessionTodo> {
  return withLock(project, session, async () => {
    const data = await readSessionTodosFile(project, session);
    const todo = data.todos.find(t => t.id === id);
    if (!todo) {
      throw new Error('Todo not found');
    }
    const nextCompleted = completed === undefined ? !todo.completed : completed;
    todo.completed = nextCompleted;
    todo.updatedAt = nowIso();
    await writeSessionTodosFile(project, session, data);
    return todo;
  });
}

export async function removeSessionTodo(
  project: string,
  session: string,
  id: number
): Promise<SessionTodo> {
  return withLock(project, session, async () => {
    const data = await readSessionTodosFile(project, session);
    const idx = data.todos.findIndex(t => t.id === id);
    if (idx === -1) {
      throw new Error('Todo not found');
    }
    const [removed] = data.todos.splice(idx, 1);
    await writeSessionTodosFile(project, session, data);
    return removed;
  });
}

export async function clearCompletedSessionTodos(
  project: string,
  session: string
): Promise<ClearCompletedResult> {
  return withLock(project, session, async () => {
    const data = await readSessionTodosFile(project, session);
    const before = data.todos.length;
    data.todos = data.todos.filter(t => !t.completed);
    const removedCount = before - data.todos.length;
    if (removedCount > 0) {
      await writeSessionTodosFile(project, session, data);
    }
    return { removedCount };
  });
}

export async function reorderSessionTodos(
  project: string,
  session: string,
  orderedIds: number[]
): Promise<SessionTodo[]> {
  return withLock(project, session, async () => {
    const data = await readSessionTodosFile(project, session);

    if (orderedIds.length !== data.todos.length) {
      throw new Error('orderedIds must be a permutation of existing todo ids');
    }
    const seen = new Set<number>();
    for (const id of orderedIds) {
      if (seen.has(id)) {
        throw new Error('orderedIds contains duplicate id');
      }
      seen.add(id);
    }
    const byId = new Map(data.todos.map(t => [t.id, t] as const));
    for (const id of orderedIds) {
      if (!byId.has(id)) {
        throw new Error('orderedIds contains unknown id');
      }
    }

    const now = nowIso();
    orderedIds.forEach((id, i) => {
      const todo = byId.get(id)!;
      todo.order = (i + 1) * 10;
      todo.updatedAt = now;
    });

    data.todos = orderedIds.map(id => byId.get(id)!);
    await writeSessionTodosFile(project, session, data);
    return data.todos.slice();
  });
}
