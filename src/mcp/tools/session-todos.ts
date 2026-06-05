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
import type { ToolDef } from './registry.js';

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
  /**
   * Return a slim projection (drops `description` and bulky timestamp/claim
   * fields) so a session with dozens of richly-described todos stays well
   * under the tool-result token cap. Use `get_todo` to fetch a single todo's
   * full description. Mutually shaped with `descriptionLimit` (compact wins).
   */
  compact?: boolean;
  /**
   * When NOT compact, truncate each `description` to this many characters
   * (a `… (+N more)` marker is appended when truncated). Ignored if compact.
   */
  descriptionLimit?: number;
}

/** Slim todo projection returned when `compact: true`. */
export interface CompactTodo {
  id: string;
  title: string;
  status: TodoStatus;
  completed: boolean;
  ownerSession: string;
  assigneeSession: string | null;
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dependsOn: string[];
  parentId: string | null;
  order: number;
  type: string | null;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  claimedBy: string | null;
  targetProject: string | null;
}

function toCompactTodo(t: Todo): CompactTodo {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    completed: t.completed,
    ownerSession: t.ownerSession,
    assigneeSession: t.assigneeSession,
    priority: t.priority,
    dependsOn: t.dependsOn,
    parentId: t.parentId,
    order: t.order,
    type: t.type,
    acceptanceStatus: t.acceptanceStatus,
    claimedBy: t.claimedBy,
    targetProject: t.targetProject,
  };
}

function truncateDescription(t: Todo, limit: number): Todo {
  if (t.description == null || t.description.length <= limit) return t;
  const head = t.description.slice(0, limit);
  const remaining = t.description.length - limit;
  return { ...t, description: `${head}… (+${remaining} more chars — use get_todo for full)` };
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
    compact: {
      type: 'boolean',
      description: 'Return a slim projection (id, title, status, assignee, priority, dependsOn, parentId, type, acceptanceStatus, claimedBy, targetProject) — omits `description` and bulky timestamp/claim fields. Use this for long-lived sessions with many richly-described todos to stay under the token cap; fetch a single full description with get_todo.',
    },
    descriptionLimit: {
      type: 'number',
      description: 'When NOT compact, truncate each description to this many characters (a marker is appended when truncated). Ignored if compact=true.',
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
): Promise<Todo[] | CompactTodo[]> {
  const todos = await listTodos(project, {
    session,
    assigneeSession: opts.assigneeSession,
    status: opts.status,
    includeCompleted: opts.includeCompleted,
  });
  if (opts.compact) return todos.map(toCompactTodo);
  if (opts.descriptionLimit != null && opts.descriptionLimit >= 0) {
    return todos.map((t) => truncateDescription(t, opts.descriptionLimit!));
  }
  return todos;
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

// ============= Tool definitions (registry) =============
//
// Migrated out of setup.ts's monolithic switch. NO behaviour change — identical
// request shapes, required-field checks, WS broadcasts, and JSON output. The WS
// broadcast (previously `getWebSocketHandler()?.broadcast(...)`) is now routed
// through the injected `ctx.broadcast`, which keeps handlers unit-testable.

export const sessionTodoToolDefs: ToolDef[] = [
  {
    name: 'list_session_todos',
    description: 'List per-session todos (checkable list attached to a collab session). Set includeCompleted=false to filter out completed items. For long-lived sessions with many todos, pass compact=true (slim projection, omits descriptions) to stay under the token cap, or descriptionLimit=N to truncate descriptions. Results are sorted by order ascending.',
    inputSchema: listSessionTodosSchema,
    handler: async (args) => {
      const { project, session, includeCompleted, assigneeSession, status, compact, descriptionLimit } = args as {
        project: string;
        session: string;
        includeCompleted?: boolean;
        assigneeSession?: string;
        status?: TodoStatus;
        compact?: boolean;
        descriptionLimit?: number;
      };
      if (!project || !session) throw new Error('Missing required: project, session');
      const result = await listSessionTodos(project, session, { includeCompleted, assigneeSession, status, compact, descriptionLimit });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'add_session_todo',
    description: 'Add a new per-session todo. Appended to the end of the list with an order value greater than any existing todo.',
    inputSchema: addSessionTodoSchema,
    handler: async (args, ctx) => {
      const { project, session, text, title, link, assigneeSession, description, status, priority, dueDate, dependsOn, parentId, sessionName, type, files } = args as {
        project: string;
        session: string;
        text?: string;
        title?: string;
        link?: SessionTodoLink;
        assigneeSession?: string;
        description?: string;
        status?: TodoStatus;
        priority?: 0 | 1 | 2 | 3 | 4;
        dueDate?: string;
        dependsOn?: string[];
        parentId?: string | null;
        sessionName?: string | null;
        type?: string | null;
        files?: string[];
      };
      if (!project || !session || !(title ?? text)) throw new Error('Missing required: project, session, text');
      const result = await addSessionTodo(project, session, title ?? text!, link, { assigneeSession, description, status, priority, dueDate, dependsOn, parentId, sessionName, type, files });
      ctx.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'update_session_todo',
    description: 'Update a per-session todo. Any combination of text, completed, and order can be provided; omitted fields are left unchanged.',
    inputSchema: updateSessionTodoSchema,
    handler: async (args, ctx) => {
      const { project, session, id, text, title, completed, link, assigneeSession, description, status, priority, dueDate, dependsOn, parentId, sessionName } = args as {
        project: string;
        session: string;
        id: string;
        text?: string;
        title?: string;
        completed?: boolean;
        order?: number;
        link?: SessionTodoLink | null;
        assigneeSession?: string;
        description?: string;
        status?: TodoStatus;
        priority?: 0 | 1 | 2 | 3 | 4 | null;
        dueDate?: string;
        dependsOn?: string[];
        parentId?: string | null;
        sessionName?: string | null;
      };
      if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
      const result = await updateSessionTodo(project, session, id, { text, title, completed, link, assigneeSession, description, status, priority, dueDate, dependsOn, parentId, sessionName });
      ctx.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined, previousAssigneeSession: result.previousAssigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'toggle_session_todo',
    description: 'Toggle the completed state of a per-session todo. If completed is omitted, the current value is flipped.',
    inputSchema: toggleSessionTodoSchema,
    handler: async (args, ctx) => {
      const { project, session, id, completed } = args as {
        project: string;
        session: string;
        id: string;
        completed?: boolean;
      };
      if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
      const result = await toggleSessionTodo(project, session, id, completed);
      ctx.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'remove_session_todo',
    description: 'Remove a per-session todo by id.',
    inputSchema: removeSessionTodoSchema,
    handler: async (args, ctx) => {
      const { project, session, id } = args as {
        project: string;
        session: string;
        id: string;
      };
      if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
      const result = await removeSessionTodo(project, session, id);
      ctx.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result?.ownerSession, assigneeSession: result?.assigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'clear_completed_session_todos',
    description: 'Remove all completed per-session todos for a session. Returns the number of todos removed.',
    inputSchema: clearCompletedSessionTodosSchema,
    handler: async (args, ctx) => {
      const { project, session } = args as { project: string; session: string };
      if (!project || !session) throw new Error('Missing required: project, session');
      const result = await clearCompletedSessionTodos(project, session);
      ctx.broadcast({ type: 'session_todos_updated', project, session });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'reorder_session_todos',
    description: 'Reorder per-session todos by providing a full permutation of existing todo ids. Assigns new order values (10, 20, 30, ...) in the provided sequence.',
    inputSchema: reorderSessionTodosSchema,
    handler: async (args, ctx) => {
      const { project, session, orderedIds } = args as {
        project: string;
        session: string;
        orderedIds: string[];
      };
      if (!project || !session || !Array.isArray(orderedIds)) throw new Error('Missing required: project, session, orderedIds');
      const result = await reorderSessionTodos(project, session, orderedIds);
      ctx.broadcast({ type: 'session_todos_updated', project, session });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'complete_linked_todos',
    description: 'Mark completed all session todos linked to a blueprint (and optional taskId). Used to sync linked todos when a Go task finishes.',
    inputSchema: completeLinkedTodosSchema,
    handler: async (args, ctx) => {
      const { project, session, blueprintId, taskId } = args as {
        project: string; session: string; blueprintId: string; taskId?: string;
      };
      if (!project || !session || !blueprintId) throw new Error('Missing required: project, session, blueprintId');
      const result = await completeTodosForTask(project, session, blueprintId, taskId);
      ctx.broadcast({ type: 'session_todos_updated', project, session });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'assign_session_todo',
    description: 'Assign a session todo to a specific session (assigneeSession). Pass null to unassign.',
    inputSchema: assignSessionTodoSchema,
    handler: async (args, ctx) => {
      const { project, session, id, assigneeSession } = args as {
        project: string;
        session: string;
        id: string;
        assigneeSession: string | null;
      };
      if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
      const result = await assignSessionTodo(project, session, id, assigneeSession);
      ctx.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined, previousAssigneeSession: result.previousAssigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    },
  },
];
