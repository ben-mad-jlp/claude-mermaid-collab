/**
 * Session Todos Tools
 *
 * MCP tools for managing per-session todo items (checkable list
 * attached to a specific collab session). Delegates to the project-scoped
 * todo-store (SQLite) introduced in the todos-upgrade.
 */

import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  assignTodo,
  removeTodo,
  clearCompleted,
  reorder,
  type Todo,
  type TodoStatus,
  type TodoLink,
} from '../../services/todo-store.js';
import { inferProfileType } from '../../config/agent-profiles.js';
import { inferTypeFromManifest } from '../../config/project-manifest.js';

// ============= Type Re-exports =============

/** Compat alias — api.ts imports SessionTodoLink */
export type SessionTodoLink = TodoLink;

/** Compat alias — setup.ts and api.ts may import SessionTodo */
export type SessionTodo = Todo;

// ============= Options / Result Interfaces =============

export interface ListSessionTodosOptions {
  includeCompleted?: boolean;
  assigneeSession?: string;
  status?: TodoStatus;
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
    assigneeSession: {
      type: 'string',
      description: 'Filter todos assigned to this session',
    },
    status: {
      type: 'string',
      enum: ['backlog', 'planned', 'todo', 'ready', 'in_progress', 'blocked', 'done', 'dropped'],
      description: 'Filter todos by status',
    },
  },
  required: ['project', 'session'],
};

export const addSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    text: { type: 'string', description: 'Todo text (becomes title)' },
    title: { type: 'string', description: 'Todo title (alias for text)' },
    assigneeSession: { type: 'string', description: 'Session to assign the todo to' },
    description: { type: 'string', description: 'Optional longer description' },
    status: {
      type: 'string',
      enum: ['backlog', 'planned', 'todo', 'ready', 'in_progress', 'blocked', 'done', 'dropped'],
      description: 'Initial status (default: todo)',
    },
    priority: { type: 'number', description: 'Priority 0-4 (0=highest)' },
    dueDate: { type: 'string', description: 'ISO date string for due date' },
    link: {
      type: 'object',
      description: 'Optional link to a blueprint task',
      properties: {
        blueprintId: { type: 'string', description: 'Blueprint id' },
        taskId: { type: 'string', description: 'Task id within the blueprint (optional)' },
      },
      required: ['blueprintId'],
    },
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of todo ids this todo depends on',
    },
    parentId: { type: 'string', description: 'Parent todo id (for subtasks)' },
    sessionName: { type: 'string', description: 'Session name to associate with this todo' },
    type: { type: 'string', description: 'Agent-profile type (frontend/backend/api/ui/library). Overrides inference from files.' },
    files: { type: 'array', items: { type: 'string' }, description: 'Touched files — used to infer the agent-profile type when `type` is omitted.' },
  },
  required: ['project', 'session', 'text'],
};

export const updateSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    id: { type: 'string', description: 'Todo id to update' },
    text: { type: 'string', description: 'New text/title (optional)' },
    title: { type: 'string', description: 'New title (optional, alias for text)' },
    completed: { type: 'boolean', description: 'New completed state (optional)' },
    status: {
      type: 'string',
      enum: ['backlog', 'planned', 'todo', 'ready', 'in_progress', 'blocked', 'done', 'dropped'],
      description: 'New status (optional)',
    },
    assigneeSession: { type: 'string', description: 'Reassign to this session (optional)' },
    description: { type: 'string', description: 'New description (optional)' },
    priority: { type: 'number', description: 'New priority 0-4 (optional)' },
    dueDate: { type: 'string', description: 'New due date ISO string (optional)' },
    link: {
      type: 'object',
      description: 'Set or clear the blueprint link. Provide null to clear, or an object to set.',
      properties: {
        blueprintId: { type: 'string', description: 'Blueprint id' },
        taskId: { type: 'string', description: 'Task id within the blueprint (optional)' },
      },
      required: ['blueprintId'],
    },
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of todo ids this todo depends on',
    },
    parentId: { type: 'string', description: 'Parent todo id (for subtasks)' },
    sessionName: { type: 'string', description: 'Session name to associate with this todo' },
  },
  required: ['project', 'session', 'id'],
};

export const completeLinkedTodosSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    blueprintId: { type: 'string', description: 'Blueprint id to match' },
    taskId: { type: 'string', description: 'Task id to match (optional; matches all tasks in blueprint when omitted)' },
  },
  required: ['project', 'session', 'blueprintId'],
};

export const toggleSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    id: { type: 'string', description: 'Todo id to toggle' },
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
    id: { type: 'string', description: 'Todo id to remove' },
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
      items: { type: 'string' },
      description: 'Full permutation of existing todo ids in desired order',
    },
  },
  required: ['project', 'session', 'orderedIds'],
};

export const assignSessionTodoSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    id: { type: 'string', description: 'Todo id to assign' },
    assigneeSession: {
      type: ['string', 'null'],
      description: 'Session to assign the todo to, or null to unassign',
    },
  },
  required: ['project', 'session', 'id', 'assigneeSession'],
};

// ============= Tool Functions =============

export async function listSessionTodos(
  project: string,
  session: string,
  opts: ListSessionTodosOptions = {}
): Promise<Todo[]> {
  return listTodos(project, {
    session,
    assigneeSession: opts.assigneeSession,
    status: opts.status,
    includeCompleted: opts.includeCompleted,
  });
}

export async function addSessionTodo(
  project: string,
  session: string,
  text: string,
  link?: SessionTodoLink,
  extras?: {
    title?: string;
    assigneeSession?: string;
    description?: string;
    status?: TodoStatus;
    priority?: 0 | 1 | 2 | 3 | 4;
    dueDate?: string;
    dependsOn?: string[];
    parentId?: string | null;
    sessionName?: string | null;
    type?: string | null;
    /** Touched files — used to INFER the agent-profile type when `type` is absent. */
    files?: string[];
  },
): Promise<Todo> {
  const { title: _extrasTitle, files, type, ...extrasRest } = extras ?? {};
  const trimmed = (extras?.title ?? text).trim();
  if (!trimmed) throw new Error('text must be non-empty');
  // Explicit type wins; otherwise infer from the touched files (open-problem #8) —
  // the project's manifest path-rules get first say (so a repo can route its own
  // file shapes to a profile collab has never heard of), then the global rules.
  const resolvedType = type ?? (files && files.length
    ? (inferTypeFromManifest(project, files) ?? inferProfileType(files))
    : null);
  return createTodo(project, {
    ownerSession: session,
    ...extrasRest,
    title: trimmed, // after the spread so the trimmed value always wins
    link: link ?? null,
    type: resolvedType,
  });
}

export async function updateSessionTodo(
  project: string,
  session: string,
  id: string | number,
  updates: {
    text?: string;
    title?: string;
    completed?: boolean;
    status?: TodoStatus;
    assigneeSession?: string | null;
    description?: string | null;
    priority?: 0 | 1 | 2 | 3 | 4 | null;
    dueDate?: string | null;
    link?: SessionTodoLink | null;
    dependsOn?: string[];
    parentId?: string | null;
    sessionName?: string | null;
  }
): Promise<Todo & { previousAssigneeSession: string | null }> {
  const titleValue = updates.title ?? updates.text;
  if (titleValue !== undefined && !titleValue.trim()) {
    throw new Error('text must be non-empty');
  }
  // Snapshot the prior assignee so callers can notify the session a todo was
  // moved AWAY from — otherwise its list never refreshes (the reassign bug).
  const previousAssigneeSession = getTodo(project, String(id))?.assigneeSession ?? null;
  const updated = await updateTodo(project, String(id), {
    title: titleValue?.trim(),
    completed: updates.completed,
    status: updates.status,
    assigneeSession: updates.assigneeSession,
    description: updates.description,
    priority: updates.priority,
    dueDate: updates.dueDate,
    link: updates.link,
    dependsOn: updates.dependsOn,
    parentId: updates.parentId,
    sessionName: updates.sessionName,
  });
  return Object.assign(updated, { previousAssigneeSession });
}

export async function toggleSessionTodo(
  project: string,
  session: string,
  id: string | number,
  completed?: boolean
): Promise<Todo> {
  const current = getTodo(project, String(id));
  return updateTodo(project, String(id), {
    completed: completed ?? !(current?.completed ?? false),
  });
}

export async function removeSessionTodo(
  project: string,
  session: string,
  id: string | number
): Promise<Todo | null> {
  const t = getTodo(project, String(id));
  await removeTodo(project, String(id));
  return t;
}

export async function clearCompletedSessionTodos(
  project: string,
  session: string
): Promise<ClearCompletedResult> {
  const r = await clearCompleted(project, session);
  return { removedCount: r.removed };
}

export async function reorderSessionTodos(
  project: string,
  session: string,
  orderedIds: (string | number)[]
): Promise<Todo[]> {
  await reorder(project, orderedIds.map(String));
  // includeCompleted so the returned list reflects the full reordered set.
  return listTodos(project, { session, includeCompleted: true });
}

export async function completeTodosForTask(
  project: string,
  session: string,
  blueprintId: string,
  taskId?: string,
): Promise<Todo[]> {
  const todos = listTodos(project, { session, includeCompleted: false });
  const matched = todos.filter(
    t => t.link?.blueprintId === blueprintId && (taskId ? t.link?.taskId === taskId : true)
  );
  for (const t of matched) {
    await updateTodo(project, t.id, { status: 'done' });
  }
  return matched;
}

export async function assignSessionTodo(
  project: string,
  session: string,
  id: string | number,
  assigneeSession: string | null
): Promise<Todo & { previousAssigneeSession: string | null }> {
  const previousAssigneeSession = getTodo(project, String(id))?.assigneeSession ?? null;
  const updated = await assignTodo(project, String(id), assigneeSession);
  return Object.assign(updated, { previousAssigneeSession });
}
