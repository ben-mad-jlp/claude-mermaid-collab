/**
 * Project Todos Tools
 *
 * MCP tools for managing project-level todo items.
 * Todos are stored in ~/.mermaid-collab/todos.json (global registry).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============= Word Lists for Session Name Generation =============

const ADJECTIVES = [
  'bright', 'calm', 'swift', 'bold', 'warm', 'cool', 'soft', 'clear',
  'fresh', 'pure', 'wise', 'keen', 'fair', 'true', 'kind', 'brave',
  'deep', 'wide', 'tall', 'light', 'dark', 'loud', 'quiet', 'quick',
  'slow', 'sharp', 'smooth', 'rough', 'wild', 'free', 'open', 'still'
];

const NOUNS = [
  'river', 'mountain', 'forest', 'meadow', 'ocean', 'valley', 'canyon', 'lake',
  'stream', 'hill', 'cliff', 'beach', 'island', 'bridge', 'tower', 'garden',
  'field', 'grove', 'pond', 'spring', 'peak', 'ridge', 'shore', 'delta',
  'harbor', 'bay', 'cape', 'reef', 'dune', 'oasis', 'mesa', 'fjord'
];

function generateSessionName(): string {
  const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj1}-${adj2}-${noun}`;
}

// ============= Type Definitions =============

export interface ProjectTodo {
  id: number;
  title: string;
  project: string;
  sessionName: string;
  createdAt: string;
}

export interface TodosFile {
  todos: ProjectTodo[];
  nextId: number;
}

export interface ListTodosResult {
  todos: ProjectTodo[];
  count: number;
}

export interface AddTodoResult {
  success: boolean;
  todo: ProjectTodo;
  count: number;
  message: string;
}

export interface RemoveTodoResult {
  success: boolean;
  removed: ProjectTodo | null;
  count: number;
  message: string;
}

export interface UpdateTodoResult {
  success: boolean;
  todo: ProjectTodo | null;
  message: string;
}

// ============= Schemas =============

export const listTodosSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
  },
  required: ['project'],
};

export const addTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    title: { type: 'string', description: 'Todo title' },
    description: { type: 'string', description: 'Todo description (optional)' },
  },
  required: ['project', 'title'],
};

export const updateTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    id: { type: 'number', description: 'Todo ID to update' },
    title: { type: 'string', description: 'New todo title (optional)' },
  },
  required: ['project', 'id'],
};

export const removeTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    id: { type: 'number', description: 'Todo ID to remove' },
  },
  required: ['project', 'id'],
};

export const listTodoItemsSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    id: { type: 'number', description: 'Todo ID' },
  },
  required: ['project', 'id'],
};

// ============= Helper Functions =============

/** Override for testing — set to redirect todos.json to a temp dir */
let _todosDataDir: string | null = null;

export function setTodosDataDir(dir: string | null): void {
  _todosDataDir = dir;
}

function getTodosPath(): string {
  const dataDir = _todosDataDir || join(homedir(), '.mermaid-collab');
  return join(dataDir, 'todos.json');
}

async function readTodosFile(): Promise<TodosFile> {
  const todosPath = getTodosPath();
  try {
    const content = await readFile(todosPath, 'utf-8');
    return JSON.parse(content) as TodosFile;
  } catch {
    return { todos: [], nextId: 1 };
  }
}

async function writeTodosFile(data: TodosFile): Promise<void> {
  const todosPath = getTodosPath();
  await mkdir(dirname(todosPath), { recursive: true });
  await writeFile(todosPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============= Tool Functions =============

/**
 * List all project todos.
 * Reads global registry and filters by project.
 */
export async function listTodos(project: string): Promise<ListTodosResult> {
  const data = await readTodosFile();
  const projectTodos = data.todos.filter(t => t.project === project);
  return {
    todos: projectTodos,
    count: projectTodos.length,
  };
}

/**
 * Add a todo to the project.
 * Automatically generates a session name and creates a vibe session directory.
 */
export async function addTodo(project: string, title: string): Promise<AddTodoResult> {
  const data = await readTodosFile();

  const sessionName = generateSessionName();

  const todo: ProjectTodo = {
    id: data.nextId,
    title,
    project,
    sessionName,
    createdAt: new Date().toISOString(),
  };

  data.todos.push(todo);
  data.nextId++;

  await writeTodosFile(data);

  // Create session directory structure under .collab/todos/
  const sessionDir = join(project, '.collab', 'todos', sessionName);
  await mkdir(join(sessionDir, 'diagrams'), { recursive: true });
  await mkdir(join(sessionDir, 'documents'), { recursive: true });

  // Write initial collab-state.json
  const collabState = {
    sessionType: 'vibe',
    state: 'vibe-active',
    phase: 'vibe-active',
    lastActivity: new Date().toISOString(),
    currentItem: null,
    useRenderUI: true,
  };
  await writeFile(join(sessionDir, 'collab-state.json'), JSON.stringify(collabState, null, 2), 'utf-8');

  return {
    success: true,
    todo,
    count: data.todos.filter(t => t.project === project).length,
    message: `Todo added: "${title}" (${data.todos.filter(t => t.project === project).length} total)`,
  };
}

/**
 * Update a todo's title and/or description.
 */
export async function updateTodo(project: string, id: number, updates: { title?: string }): Promise<UpdateTodoResult> {
  const data = await readTodosFile();

  const todo = data.todos.find((t) => t.id === id && t.project === project);
  if (!todo) {
    return {
      success: false,
      todo: null,
      message: `Todo with id ${id} not found`,
    };
  }

  if (updates.title !== undefined) {
    todo.title = updates.title;
  }

  await writeTodosFile(data);

  return {
    success: true,
    todo,
    message: `Todo updated: "${todo.title}"`,
  };
}

/**
 * Remove a todo from the project by ID.
 */
export async function removeTodo(project: string, id: number): Promise<RemoveTodoResult> {
  const data = await readTodosFile();

  const index = data.todos.findIndex((t) => t.id === id && t.project === project);
  if (index === -1) {
    const projectTodos = data.todos.filter(t => t.project === project);
    return {
      success: false,
      removed: null,
      count: projectTodos.length,
      message: `Todo with id ${id} not found`,
    };
  }

  const [removed] = data.todos.splice(index, 1);

  await writeTodosFile(data);

  const projectTodos = data.todos.filter(t => t.project === project);
  return {
    success: true,
    removed,
    count: projectTodos.length,
    message: `Todo removed: "${removed.title}" (${projectTodos.length} remaining)`,
  };
}
