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
  collapseSplit,
  reorder,
  deriveTodoViews,
  type Todo,
  type TodoView,
  type TodoStatus,
  type TodoLink,
  type LeafTier,
} from '../../services/todo-store.js';
import { inferProfileType } from '../../config/agent-profiles.js';
import { inferTypeFromManifest } from '../../config/project-manifest.js';
import { INBOX_EPIC_TITLE, isInboxEpic, isInboxEpicTitle } from '../../services/claimability.js';
import { ensureBucket } from '../../services/bucket-registry.js';
import { labelFor, type TodoKind } from '../../services/todo-kind.js';
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
  /** Live-derived status (planned|ready|blocked|in_progress|done|dropped). */
  status: TodoStatus;
  /** Raw persisted status — never derived. */
  storedStatus: TodoStatus;
  isClaimable: boolean;
  claimReason: string;
  completed: boolean;
  ownerSession: string;
  assigneeSession: string | null;
  assigneeKind: 'agent' | 'human';
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dependsOn: string[];
  parentId: string | null;
  order: number;
  type: string | null;
  acceptanceStatus: 'pending' | 'accepted' | 'rejected' | null;
  claimedBy: string | null;
  completedBy: string | null;
  targetProject: string | null;
}

function toCompactTodo(t: TodoView): CompactTodo {
  return {
    id: t.id,
    title: t.title,
    status: t.derivedStatus,
    storedStatus: t.storedStatus,
    isClaimable: t.isClaimable,
    claimReason: t.claimReason,
    completed: t.completed,
    ownerSession: t.ownerSession,
    assigneeSession: t.assigneeSession,
    assigneeKind: t.assigneeKind,
    priority: t.priority,
    dependsOn: t.dependsOn,
    parentId: t.parentId,
    order: t.order,
    type: t.type,
    acceptanceStatus: t.acceptanceStatus,
    claimedBy: t.claimedBy,
    completedBy: t.completedBy,
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
      description: "Filter by status. ready/blocked/in_progress are DERIVED (computed live), so this filters on each todo's derivedStatus, not the raw stored value.",
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
    assigneeKind: { type: 'string', enum: ['agent', 'human'], description: "Whether the assignee is an autonomous agent (default) or a human. Attribution, not auth." },
    description: { type: 'string', description: 'Optional longer description' },
    status: {
      type: 'string',
      enum: ['backlog', 'planned', 'todo', 'ready', 'in_progress', 'blocked', 'done', 'dropped'],
      description: "Initial status (default: todo). ready/blocked/in_progress are DERIVED, not stored: 'ready' = approve-to-run (stamps approvedAt, stored status stays planned), 'blocked' = hold. The response's `derivedStatus`/`status` reflect the effective state.",
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
    parentId: { type: 'string', description: 'Parent todo id — the [EPIC] (or sub-task parent) this belongs under. REQUIRED for work todos: every todo must belong to an epic. Omitting it (and inbox) is REJECTED. For a kind:\'epic\' create, an explicit parentId here means "epic OR mission" and wins over missionId.' },
    missionId: { type: ['string', 'null'], description: "Mission homing for a kind:'epic' create. OMIT for the default: the epic is parented to the session's ACTIVE mission. Pass null to force a root epic (opt-out), or a mission todo id to home it explicitly. Ignored for leaves and for the Inbox / Bugfix inbox bucket epics, which are always roots." },
    servesCriterionId: { type: ['string', 'null'], description: 'A3 epic→criterion edge: the acceptance criterion this epic serves. When a kind:\'epic\' create homes to a mission, set this to the criterion ID to satisfy the approval-time guard. Optional at create; the approval check requires it for a mission-homed epic.' },
    sessionName: { type: 'string', description: 'Session name to associate with this todo' },
    type: { type: 'string', description: 'Agent-profile type (frontend/backend/api/ui/library). Overrides inference from files.' },
    files: { type: 'array', items: { type: 'string' }, description: 'Touched files — used to infer the agent-profile type when `type` is omitted.' },
    inbox: { type: 'boolean', description: 'Deliberately file an UNPLANNED high-level thought under [EPIC] Inbox. The ONLY way into the Inbox — never assumed. Use ONLY for genuine unplanned thoughts; planned work must pass parentId=<epic id> instead.' },
    kind: {
      type: 'string',
      enum: ['leaf', 'epic', 'land', 'mission'],
      description: "The node's role in the work graph (default: leaf). Set 'epic' for a container, 'land' for the final merge-to-master leaf, 'mission' for a convergence mission root. NEVER encode the role in the title — the [EPIC]/[LAND]/[MISSION] label is rendered from this field.",
    },
    tier: {
      type: 'string',
      enum: ['full', 'small', 'test-pinned'],
      description: "Executor recipe tier (default: full). 'test-pinned' pins the leaf to a test-authoring recipe; 'small' to the small-change recipe. Settable at create and at approve (status:'ready').",
    },
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
      description: "New status (optional). ready/blocked/in_progress are DERIVED, never stored: writing 'ready' APPROVES the todo (stamps approvedAt) — the raw stored `status` intentionally stays 'planned' while `derivedStatus`/`status` in the response become 'ready'. Writing 'blocked' = hold. 'in_progress' is rejected (claims are daemon-only). Do NOT retry if the stored status reads 'planned' after approving — check derivedStatus/isClaimable instead.",
    },
    assigneeSession: { type: 'string', description: 'Reassign to this session (optional)' },
    assigneeKind: { type: 'string', enum: ['agent', 'human'], description: 'Set assignee kind: agent (default) or human. Attribution, not auth (optional).' },
    completedBy: { type: ['string', 'null'], description: "Actor handle to record as the completer (e.g. 'local:host'). Normally omitted — a human todo auto-stamps on completion; pass null to clear (optional)." },
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
    servesCriterionId: { type: ['string', 'null'], description: 'A3 epic→criterion edge: the acceptance criterion this epic serves. Set this on a mission-homed epic before approving it. Pass null to clear.' },
    sessionName: { type: 'string', description: 'Session name to associate with this todo' },
    targetProject: { type: ['string', 'null'], description: 'Absolute path to the repo where this todo is IMPLEMENTED, when different from the tracking project (the worker spawns with cwd=targetProject and its gate runs there). Pass null to clear. Steward use: reroute a cross-project todo (e.g. a yolox/build123d todo) that was created without it.' },
    tier: {
      type: 'string',
      enum: ['full', 'small', 'test-pinned'],
      description: "Set the executor recipe tier (full|small|test-pinned). Settable alongside status:'ready' to pin the tier at approve time.",
    },
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

export const collapseSplitSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Absolute path to project root' },
    session: { type: 'string', description: 'Session name' },
    leafId: { type: 'string', description: 'Id of the split leaf to collapse' },
  },
  required: ['project', 'session', 'leafId'],
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
): Promise<TodoView[] | CompactTodo[]> {
  // Fetch raw (no status filter here — `ready`/`blocked`/`in_progress` are derived,
  // never stored, so a raw status filter would never match them), enrich to the
  // derived view, THEN filter on the derived status so `status:'ready'` works.
  const raw = await listTodos(project, {
    session,
    assigneeSession: opts.assigneeSession,
    includeCompleted: opts.includeCompleted,
  });
  let views = deriveTodoViews(project, raw);
  if (opts.status) views = views.filter((t) => t.derivedStatus === opts.status);
  if (opts.compact) return views.map(toCompactTodo);
  if (opts.descriptionLimit != null && opts.descriptionLimit >= 0) {
    return views.map((t) => truncateDescription(t, opts.descriptionLimit!) as TodoView);
  }
  return views;
}

/** The per-project default epic that orphan work todos are parented under so
 *  nothing floats at the top level (constraint 373a2d52 / every-todo-needs-an-epic).
 *  Matched/created by this exact title. Epics are roots (no parent themselves).
 *  Imported from claimability.ts (the single source of Inbox identity, shared
 *  with the claim gate + approval block) and re-exported for back-compat. */
export { INBOX_EPIC_TITLE };

/** Find (or create once) the project's default Inbox epic and return its id. The
 *  epic stays a root (no parent) because it is a BUCKET epic (isBucketEpicTitle),
 *  not because epics are roots in general — a non-bucket epic still resolves
 *  through the §4d mission ladder. */
async function ensureInboxEpic(project: string, _session: string): Promise<string> {
  // R1: the Inbox is a bucket singleton — route through the ONE writer so its structural
  // bucketType is always set (unifies this path with resolveTodoParent's inbox auto-home
  // and prevents a second, bucketType-less Inbox from forking).
  return ensureBucket(project, 'inbox');
}

export async function addSessionTodo(
  project: string,
  session: string,
  text: string,
  link?: SessionTodoLink,
  extras?: {
    title?: string;
    assigneeSession?: string;
    assigneeKind?: 'agent' | 'human';
    description?: string;
    status?: TodoStatus;
    priority?: 0 | 1 | 2 | 3 | 4;
    dueDate?: string;
    dependsOn?: string[];
    parentId?: string | null;
    /** §4d mission homing for a `kind:'epic'` create. Omitted → parented to the caller's
     *  ACTIVE mission BY DEFAULT. `null` → force a root epic. A string → that mission.
     *  Ignored for leaves and for BUCKET epics (Inbox / Bugfix inbox), which stay roots. */
    missionId?: string | null;
    /** A3 epic→criterion edge: the mission acceptance-criterion id this epic serves. */
    servesCriterionId?: string | null;
    sessionName?: string | null;
    type?: string | null;
    /** Touched files — used to INFER the agent-profile type when `type` is absent. */
    files?: string[];
    /** Deliberately file an unplanned high-level thought under [EPIC] Inbox. The ONLY
     *  path into the Inbox — without it (and without a parentId/epic title) the create
     *  is REJECTED, so a forgotten epic surfaces loudly instead of silently landing here. */
    inbox?: boolean;
    /** The node's ROLE. Explicit, never inferred from the title (stage C / BOMB 1).
     *  'leaf' is the default ONLY because the overwhelming majority of creates mean a leaf;
     *  epic/mission/land callers MUST say so. */
    kind?: TodoKind;
    tier?: LeafTier;
  },
): Promise<Todo> {
  const { title: _extrasTitle, files, type, inbox, kind: kindArg, ...extrasRest } = extras ?? {};
  const kind: TodoKind = kindArg ?? 'leaf';
  const trimmed = (extras?.title ?? text).trim();
  if (!trimmed) throw new Error('text must be non-empty');
  // Explicit type wins; otherwise infer from the touched files (open-problem #8) —
  // the project's manifest path-rules get first say (so a repo can route its own
  // file shapes to a profile collab has never heard of), then the global rules.
  const resolvedType = type ?? (files && files.length
    ? (inferTypeFromManifest(project, files) ?? inferProfileType(files))
    : null);
  // Every work todo belongs to an epic (constraint 373a2d52). We NO LONGER silently
  // auto-parent under the Inbox — that masked planning skills that forgot the epic.
  // createTodo now REJECTS a non-epic top-level create unless `inbox:true` is set
  // (the explicit "unplanned thought" path). An explicit Inbox flag pre-resolves the
  // epic here so the title-based Inbox identity stays in this layer. Epic creates
  // (kind:'epic') fall through untouched to createTodo/resolveTodoParent's §4d
  // mission resolver (missionId omitted → active mission, null → root, bucket
  // titles → root) rather than being defaulted to root here.
  let parentId = extrasRest.parentId ?? null;
  // Roots (epic / mission) are exempt from auto-parenting — they ARE the parents.
  // The role comes from the explicit `kind` argument; a title is never read for a role.
  const isRoot = kind === 'epic' || kind === 'mission';
  if (!parentId && inbox && !isRoot) {
    parentId = await ensureInboxEpic(project, session);
  }
  return createTodo(project, {
    ownerSession: session,
    ...extrasRest,
    parentId,
    kind,                       // explicit; never inferred at insert (BOMB 1)
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
    assigneeKind?: 'agent' | 'human';
    completedBy?: string | null;
    description?: string | null;
    priority?: 0 | 1 | 2 | 3 | 4 | null;
    dueDate?: string | null;
    link?: SessionTodoLink | null;
    dependsOn?: string[];
    parentId?: string | null;
    servesCriterionId?: string | null;
    sessionName?: string | null;
    targetProject?: string | null;
    tier?: LeafTier | null;
  }
): Promise<Todo & { previousAssigneeSession: string | null }> {
  const titleValue = updates.title ?? updates.text;
  if (titleValue !== undefined && !titleValue.trim()) {
    throw new Error('text must be non-empty');
  }
  // Snapshot the prior assignee so callers can notify the session a todo was
  // moved AWAY from — otherwise its list never refreshes (the reassign bug).
  const existing = getTodo(project, String(id));
  const previousAssigneeSession = existing?.assigneeSession ?? null;
  // Inbox = planning-only: refuse to approve (status:'ready' stamps approvedAt) a
  // triage child of [EPIC] Inbox. Check the EFFECTIVE parent — an explicit parentId
  // in this same call (a re-home) is honored first, so "move + approve" is allowed.
  if (updates.status === 'ready') {
    const effectiveParentId =
      updates.parentId !== undefined ? updates.parentId : (existing?.parentId ?? null);
    const parent = effectiveParentId ? getTodo(project, effectiveParentId) : null;
    if (parent && isInboxEpic(parent)) {
      throw new Error(
        `Cannot approve a todo parented under ${labelFor('epic')} ${INBOX_EPIC_TITLE} — re-home it to a real epic before approving.`,
      );
    }
  }
  const updated = await updateTodo(project, String(id), {
    title: titleValue?.trim(),
    completed: updates.completed,
    status: updates.status,
    assigneeSession: updates.assigneeSession,
    assigneeKind: updates.assigneeKind,
    completedBy: updates.completedBy,
    description: updates.description,
    priority: updates.priority,
    dueDate: updates.dueDate,
    link: updates.link,
    dependsOn: updates.dependsOn,
    parentId: updates.parentId,
    servesCriterionId: updates.servesCriterionId,
    sessionName: updates.sessionName,
    targetProject: updates.targetProject,
    tier: updates.tier,
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

export async function collapseSplitTodo(project: string, leafId: string) {
  return collapseSplit(project, leafId);
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
      const { project, session, text, title, link, assigneeSession, assigneeKind, description, status, priority, dueDate, dependsOn, parentId, missionId, servesCriterionId, sessionName, type, files, inbox, kind, tier } = args as {
        project: string;
        session: string;
        text?: string;
        title?: string;
        link?: SessionTodoLink;
        assigneeSession?: string;
        assigneeKind?: 'agent' | 'human';
        description?: string;
        status?: TodoStatus;
        priority?: 0 | 1 | 2 | 3 | 4;
        dueDate?: string;
        dependsOn?: string[];
        parentId?: string | null;
        missionId?: string | null;
        servesCriterionId?: string | null;
        sessionName?: string | null;
        type?: string | null;
        files?: string[];
        inbox?: boolean;
        kind?: TodoKind;
        tier?: LeafTier;
      };
      if (!project || !session || !(title ?? text)) throw new Error('Missing required: project, session, text');
      if (args && typeof args === 'object' && 'bucketType' in (args as Record<string, unknown>)) {
        throw new Error('add_session_todo: `bucketType` is not caller-settable — buckets are created via ensureBucket');
      }
      const result = await addSessionTodo(project, session, title ?? text!, link, { assigneeSession, assigneeKind, description, status, priority, dueDate, dependsOn, parentId, missionId, servesCriterionId, sessionName, type, files, inbox, kind, tier });
      ctx.broadcast({ type: 'session_todos_updated', project, session, ownerSession: result.ownerSession, assigneeSession: result.assigneeSession ?? undefined });
      return JSON.stringify(result, null, 2);
    },
  },
  {
    name: 'update_session_todo',
    description: 'Update a per-session todo. Any combination of text, completed, and order can be provided; omitted fields are left unchanged.',
    inputSchema: updateSessionTodoSchema,
    handler: async (args, ctx) => {
      const { project, session, id, text, title, completed, link, assigneeSession, assigneeKind, completedBy, description, status, priority, dueDate, dependsOn, parentId, servesCriterionId, sessionName, targetProject, tier } = args as {
        project: string;
        session: string;
        id: string;
        text?: string;
        title?: string;
        completed?: boolean;
        order?: number;
        link?: SessionTodoLink | null;
        assigneeSession?: string;
        assigneeKind?: 'agent' | 'human';
        completedBy?: string | null;
        description?: string;
        status?: TodoStatus;
        priority?: 0 | 1 | 2 | 3 | 4 | null;
        dueDate?: string;
        dependsOn?: string[];
        parentId?: string | null;
        servesCriterionId?: string | null;
        sessionName?: string | null;
        targetProject?: string | null;
        tier?: LeafTier | null;
      };
      if (!project || !session || id === undefined) throw new Error('Missing required: project, session, id');
      const result = await updateSessionTodo(project, session, id, { text, title, completed, link, assigneeSession, assigneeKind, completedBy, description, status, priority, dueDate, dependsOn, parentId, servesCriterionId, sessionName, targetProject, tier });
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
    name: 'collapse_split',
    description: "Undo a leaf split: drop the leaf's open children and restore the leaf itself to a claimable leaf, atomically, preserving the leaf id (and its blueprint). Idempotent — reports which children it dropped. Note: the size gate may re-split on the next claim unless the leaf's spec changes.",
    inputSchema: collapseSplitSchema,
    handler: async (args, ctx) => {
      const { project, session, leafId } = args as {
        project: string;
        session: string;
        leafId: string;
      };
      if (!project || !session || !leafId) throw new Error('Missing required: project, session, leafId');
      const result = await collapseSplitTodo(project, leafId);
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
