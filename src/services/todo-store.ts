import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT todo store (Phase 0 of the todos upgrade — see design-todos-upgrade).
 * Replaces the per-session JSON files with a single bun:sqlite DB per project,
 * so a "managing session" can own/assign todos across sessions with a plain
 * query/write (no cross-store merge). Source of truth is local disk.
 */

export type TodoStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';

export interface TodoLink {
  blueprintId: string;
  taskId?: string;
}

export interface Todo {
  id: string;
  ownerSession: string;
  assigneeSession: string | null;
  title: string;
  description: string | null;
  status: TodoStatus;
  completed: boolean; // derived: status === 'done'
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string[];
  order: number;
  link: TodoLink | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  asanaGid: string | null;
}

export interface TodoFilter {
  session?: string; // matches owner OR assignee
  ownerSession?: string;
  assigneeSession?: string;
  status?: TodoStatus;
  includeCompleted?: boolean;
}

export interface CreateTodoInput {
  ownerSession: string;
  assigneeSession?: string | null;
  title: string;
  description?: string | null;
  status?: TodoStatus;
  priority?: 0 | 1 | 2 | 3 | 4 | null;
  dueDate?: string | null;
  parentId?: string | null;
  dependsOn?: string[];
  link?: TodoLink | null;
}

export type UpdateTodoPatch = Partial<{
  title: string;
  description: string | null;
  status: TodoStatus;
  completed: boolean;
  priority: 0 | 1 | 2 | 3 | 4 | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string[];
  assigneeSession: string | null;
  link: TodoLink | null;
  asanaGid: string | null;
}>;

interface TodoRow {
  id: string;
  ownerSession: string;
  assigneeSession: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number | null;
  dueDate: string | null;
  parentId: string | null;
  dependsOn: string;
  ord: number;
  link: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  asanaGid: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  ownerSession TEXT NOT NULL,
  assigneeSession TEXT,
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
  asanaGid TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(ownerSession);
CREATE INDEX IF NOT EXISTS idx_todos_assignee ON todos(assigneeSession);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
`;

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'todos.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  dbCache.set(project, db);
  return db;
}

/** For tests: drop the cached handle so a fresh dir opens a fresh DB. */
export function _closeProject(project: string): void {
  const db = dbCache.get(project);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    dbCache.delete(project);
  }
}

// Per-project serialized write lock (mirrors session-todos.ts withLock, keyed on project).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

const nowIso = () => new Date().toISOString();

function rowToTodo(row: TodoRow): Todo {
  let dependsOn: string[] = [];
  try { dependsOn = JSON.parse(row.dependsOn); } catch { /* default [] */ }
  let link: TodoLink | null = null;
  if (row.link) { try { link = JSON.parse(row.link); } catch { /* null */ } }
  return {
    id: row.id,
    ownerSession: row.ownerSession,
    assigneeSession: row.assigneeSession,
    title: row.title,
    description: row.description,
    status: row.status as TodoStatus,
    completed: row.status === 'done',
    priority: (row.priority as Todo['priority']) ?? null,
    dueDate: row.dueDate,
    parentId: row.parentId,
    dependsOn,
    order: row.ord,
    link,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    asanaGid: row.asanaGid,
  };
}

export function getTodo(project: string, id: string): Todo | null {
  const db = openDb(project);
  const row = db.query('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | null;
  return row ? rowToTodo(row) : null;
}

export function listTodos(project: string, filter: TodoFilter = {}): Todo[] {
  const db = openDb(project);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.session) {
    where.push('(ownerSession = ? OR assigneeSession = ?)');
    params.push(filter.session, filter.session);
  }
  if (filter.ownerSession) { where.push('ownerSession = ?'); params.push(filter.ownerSession); }
  if (filter.assigneeSession) { where.push('assigneeSession = ?'); params.push(filter.assigneeSession); }
  if (filter.status) { where.push('status = ?'); params.push(filter.status); }
  if (!filter.includeCompleted && !filter.status) { where.push("status != 'done'"); }
  const sql = `SELECT * FROM todos${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ord ASC`;
  const rows = db.query(sql).all(...(params as never[])) as TodoRow[];
  return rows.map(rowToTodo);
}

export function createTodo(project: string, input: CreateTodoInput): Promise<Todo> {
  return withLock(project, () => {
    const db = openDb(project);
    const maxOrd = (db.query('SELECT MAX(ord) AS m FROM todos').get() as { m: number | null }).m;
    const ord = maxOrd == null ? 10 : maxOrd + 10;
    const id = crypto.randomUUID();
    const ts = nowIso();
    const status = input.status ?? 'todo';
    db.prepare(
      `INSERT INTO todos (id, ownerSession, assigneeSession, title, description, status, priority,
        dueDate, parentId, dependsOn, ord, link, createdAt, updatedAt, completedAt, asanaGid)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, input.ownerSession, input.assigneeSession ?? null, input.title, input.description ?? null,
      status, input.priority ?? null, input.dueDate ?? null, input.parentId ?? null,
      JSON.stringify(input.dependsOn ?? []), ord, input.link ? JSON.stringify(input.link) : null,
      ts, ts, status === 'done' ? ts : null, null
    );
    return getTodo(project, id)!;
  });
}

export function updateTodo(project: string, id: string, patch: UpdateTodoPatch): Promise<Todo> {
  return withLock(project, () => {
    const existing = getTodo(project, id);
    if (!existing) throw new Error(`todo not found: ${id}`);

    // Reconcile status <-> completed.
    let status = patch.status ?? existing.status;
    if (patch.completed === true) status = 'done';
    if (patch.completed === false && existing.status === 'done') status = 'todo';
    const completedAt = status === 'done' ? (existing.completedAt ?? nowIso()) : null;

    const next = {
      title: patch.title ?? existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      status,
      priority: patch.priority !== undefined ? patch.priority : existing.priority,
      dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
      parentId: patch.parentId !== undefined ? patch.parentId : existing.parentId,
      dependsOn: patch.dependsOn ?? existing.dependsOn,
      assigneeSession: patch.assigneeSession !== undefined ? patch.assigneeSession : existing.assigneeSession,
      link: patch.link !== undefined ? patch.link : existing.link,
      asanaGid: patch.asanaGid !== undefined ? patch.asanaGid : existing.asanaGid,
    };
    const db = openDb(project);
    db.prepare(
      `UPDATE todos SET title=?, description=?, status=?, priority=?, dueDate=?, parentId=?,
        dependsOn=?, assigneeSession=?, link=?, asanaGid=?, completedAt=?, updatedAt=? WHERE id=?`
    ).run(
      next.title, next.description, next.status, next.priority, next.dueDate, next.parentId,
      JSON.stringify(next.dependsOn), next.assigneeSession, next.link ? JSON.stringify(next.link) : null,
      next.asanaGid, completedAt, nowIso(), id
    );
    return getTodo(project, id)!;
  });
}

export function assignTodo(project: string, id: string, assigneeSession: string | null): Promise<Todo> {
  return updateTodo(project, id, { assigneeSession });
}

export function removeTodo(project: string, id: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    const res = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    if (res.changes === 0) throw new Error(`todo not found: ${id}`);
  });
}

export function clearCompleted(project: string, session: string): Promise<{ removed: number }> {
  return withLock(project, () => {
    const db = openDb(project);
    const res = db
      .prepare("DELETE FROM todos WHERE (ownerSession = ? OR assigneeSession = ?) AND status = 'done'")
      .run(session, session);
    return { removed: res.changes };
  });
}

export function reorder(project: string, ids: string[]): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    const stmt = db.prepare('UPDATE todos SET ord = ?, updatedAt = ? WHERE id = ?');
    const ts = nowIso();
    db.transaction(() => {
      ids.forEach((id, i) => stmt.run((i + 1) * 10, ts, id));
    })();
  });
}
