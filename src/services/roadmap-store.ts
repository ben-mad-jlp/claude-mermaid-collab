import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT roadmap store. Mirrors `src/services/todo-store.ts` conventions
 * (dbCache/openDb/_closeProject, withLock, ord increments, JSON-parse row mapper).
 * Source of truth is local disk at `<project>/.collab/roadmap.db`.
 */

export type RoadmapStatus = 'planned' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'dropped';

export interface RoadmapItem {
  id: string;
  project: string;
  title: string;
  description: string | null;
  status: RoadmapStatus;
  ord: number;
  parentId: string | null;
  dependsOn: string[];
  sessionName: string | null;
  blueprintId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface RoadmapItemRow {
  id: string;
  project: string;
  title: string;
  description: string | null;
  status: string;
  ord: number;
  parentId: string | null;
  dependsOn: string;
  sessionName: string | null;
  blueprintId: string | null;
  createdAt: number;
  updatedAt: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS roadmap_item (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  ord REAL NOT NULL,
  parentId TEXT,
  dependsOn TEXT NOT NULL DEFAULT '[]',
  sessionName TEXT,
  blueprintId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS roadmap_item_todo (
  itemId TEXT NOT NULL,
  todoId TEXT NOT NULL,
  PRIMARY KEY (itemId, todoId)
);
CREATE INDEX IF NOT EXISTS idx_item_status ON roadmap_item(status);
CREATE INDEX IF NOT EXISTS idx_item_session ON roadmap_item(sessionName);
`;

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'roadmap.db');
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

function rowToItem(row: RoadmapItemRow): RoadmapItem {
  let dependsOn: string[] = [];
  try { dependsOn = JSON.parse(row.dependsOn); } catch { /* default [] */ }
  return {
    id: row.id,
    project: row.project,
    title: row.title,
    description: row.description,
    status: row.status as RoadmapStatus,
    ord: row.ord,
    parentId: row.parentId,
    dependsOn,
    sessionName: row.sessionName,
    blueprintId: row.blueprintId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateRoadmapItemInput {
  title: string;
  description?: string | null;
  parentId?: string | null;
  dependsOn?: string[];
  ord?: number;
}

export type UpdateRoadmapItemPatch = Partial<{
  title: string;
  description: string | null;
  status: RoadmapStatus;
  ord: number;
  parentId: string | null;
  dependsOn: string[];
}>;

export function getItem(project: string, id: string): RoadmapItem | null {
  const db = openDb(project);
  const row = db.query('SELECT * FROM roadmap_item WHERE id = ?').get(id) as RoadmapItemRow | null;
  return row ? rowToItem(row) : null;
}

export function listItems(project: string): RoadmapItem[] {
  const db = openDb(project);
  const rows = db.query('SELECT * FROM roadmap_item ORDER BY ord ASC').all() as RoadmapItemRow[];
  return rows.map(rowToItem);
}

export function createItem(project: string, input: CreateRoadmapItemInput): Promise<RoadmapItem> {
  return withLock(project, () => {
    const db = openDb(project);
    let ord = input.ord;
    if (ord === undefined) {
      const maxOrd = (db.query('SELECT MAX(ord) AS m FROM roadmap_item').get() as { m: number | null }).m;
      ord = maxOrd == null ? 10 : maxOrd + 10;
    }
    const id = crypto.randomUUID();
    const ts = Date.now();
    const status: RoadmapStatus = 'planned';
    db.prepare(
      `INSERT INTO roadmap_item (id, project, title, description, status, ord, parentId,
        dependsOn, sessionName, blueprintId, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, project, input.title, input.description ?? null, status, ord, input.parentId ?? null,
      JSON.stringify(input.dependsOn ?? []), null, null, ts, ts
    );
    return getItem(project, id)!;
  });
}

export function updateItem(project: string, id: string, patch: UpdateRoadmapItemPatch): Promise<RoadmapItem> {
  return withLock(project, () => {
    const existing = getItem(project, id);
    if (!existing) throw new Error(`roadmap item not found: ${id}`);

    const next = {
      title: patch.title !== undefined ? patch.title : existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      status: patch.status !== undefined ? patch.status : existing.status,
      ord: patch.ord !== undefined ? patch.ord : existing.ord,
      parentId: patch.parentId !== undefined ? patch.parentId : existing.parentId,
      dependsOn: patch.dependsOn !== undefined ? patch.dependsOn : existing.dependsOn,
    };
    const db = openDb(project);
    db.prepare(
      `UPDATE roadmap_item SET title=?, description=?, status=?, ord=?, parentId=?,
        dependsOn=?, updatedAt=? WHERE id=?`
    ).run(
      next.title, next.description, next.status, next.ord, next.parentId,
      JSON.stringify(next.dependsOn), Date.now(), id
    );
    return getItem(project, id)!;
  });
}

export function deleteItem(project: string, id: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare('DELETE FROM roadmap_item WHERE id = ?').run(id);
    db.prepare('DELETE FROM roadmap_item_todo WHERE itemId = ?').run(id);
  });
}

export function setItemSession(
  project: string,
  id: string,
  sessionName: string,
  blueprintId?: string
): Promise<RoadmapItem> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare(
      'UPDATE roadmap_item SET sessionName=?, blueprintId=?, updatedAt=? WHERE id=?'
    ).run(sessionName, blueprintId ?? null, Date.now(), id);
    return getItem(project, id)!;
  });
}

export function linkTodo(project: string, itemId: string, todoId: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare('INSERT OR IGNORE INTO roadmap_item_todo (itemId, todoId) VALUES (?, ?)').run(itemId, todoId);
  });
}

export function listItemTodos(project: string, itemId: string): string[] {
  const db = openDb(project);
  const rows = db.query('SELECT todoId FROM roadmap_item_todo WHERE itemId = ?').all(itemId) as { todoId: string }[];
  return rows.map((r) => r.todoId);
}
