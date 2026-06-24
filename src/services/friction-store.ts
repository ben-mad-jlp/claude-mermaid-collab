import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT friction-signal store (SEAM·collab — friction persistence).
 *
 * Failure attribution used to go into a void: the worker skill told workers to
 * write `.collab/attempts/<id>.json`, but that directory existed in no repo and
 * nothing in src/ read it; todos.db carried only `retryCount`, a noisy proxy that
 * increments on lease re-claim, not only on real failure. So "was the friction
 * collab-side (gate format / wrong test command — ORCHESTRATION) or project-side
 * (domain API re-derived / missing model — DOMAIN)?" was not queryable.
 *
 * This store makes that signal concrete and queryable: a worker emits a structured
 * friction note (attempt #, retry reason, LAYER) persisted to `.collab/friction.db`,
 * so DETECT/DRAFT (self-improving profiles, fd052733 stage-2) and the supervisor
 * can read real evidence without opening each worker's private ~/.claude transcript.
 */

/** Where the friction came from: the orchestration harness (collab), the
 *  project's own domain (the code/API the worker was editing), or a systemic
 *  operational observation any agent can emit without a leaf scope. */
export type FrictionLayer = 'orchestration' | 'domain' | 'operational';

export interface FrictionNote {
  id: string;
  /** The work-graph todo this attempt was against. Null for operational notes
   *  that are not scoped to a single leaf. */
  todoId: string | null;
  /** The worker/pool session that emitted it. */
  session: string | null;
  /** 1-based attempt number (the worker's own count, not the lease retryCount). */
  attempt: number;
  /** Which layer the friction came from. */
  layer: FrictionLayer;
  /** Short machine-ish reason tag (e.g. "gate-format", "wrong-test-cmd",
   *  "cad-api-rederived", "missing-domain-model"). */
  retryReason: string;
  /** Optional free-text elaboration. */
  detail: string | null;
  createdAt: string;
}

export interface RecordFrictionInput {
  todoId?: string | null;
  session?: string | null;
  attempt?: number;
  layer: FrictionLayer;
  retryReason: string;
  detail?: string | null;
}

export interface FrictionFilter {
  todoId?: string;
  session?: string;
  layer?: FrictionLayer;
}

const DDL = `
CREATE TABLE IF NOT EXISTS friction_notes (
  id TEXT PRIMARY KEY,
  todoId TEXT,
  session TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  layer TEXT NOT NULL,
  retryReason TEXT NOT NULL,
  detail TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friction_todo ON friction_notes(todoId);
CREATE INDEX IF NOT EXISTS idx_friction_layer ON friction_notes(layer);
CREATE TABLE IF NOT EXISTS friction_watch_state (
  signalKey TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
`;

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'friction.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);

  // Migration: older friction.db had `todoId TEXT NOT NULL`; operational notes are
  // not leaf-scoped, so todoId must be nullable. Rebuild the table if the old
  // constraint is present (idempotent — no-op once todoId is nullable).
  const cols = db.prepare(`PRAGMA table_info(friction_notes)`).all() as Array<{ name: string; notnull: number }>;
  const todoCol = cols.find((c) => c.name === 'todoId');
  if (todoCol && todoCol.notnull === 1) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`ALTER TABLE friction_notes RENAME TO friction_notes_old`);
      db.exec(DDL);
      db.exec(`INSERT INTO friction_notes (id, todoId, session, attempt, layer, retryReason, detail, createdAt)
               SELECT id, todoId, session, attempt, layer, retryReason, detail, createdAt FROM friction_notes_old`);
      db.exec(`DROP TABLE friction_notes_old`);
    })();
  }

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

// Per-project serialized write lock (mirrors todo-store.ts).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

const nowIso = () => new Date().toISOString();

const VALID_LAYERS: FrictionLayer[] = ['orchestration', 'domain', 'operational'];

function rowToNote(row: any): FrictionNote {
  return {
    id: row.id,
    todoId: row.todoId ?? null,
    session: row.session ?? null,
    attempt: row.attempt,
    layer: row.layer as FrictionLayer,
    retryReason: row.retryReason,
    detail: row.detail ?? null,
    createdAt: row.createdAt,
  };
}

/** Persist a worker's friction note. Validates the layer (the whole point of the
 *  store is a clean orchestration-vs-domain split). Returns the stored note. */
export function recordFriction(project: string, input: RecordFrictionInput): Promise<FrictionNote> {
  return withLock(project, () => {
    if (!input.retryReason) throw new Error('recordFriction: retryReason is required');
    if (!VALID_LAYERS.includes(input.layer)) {
      throw new Error(`recordFriction: layer must be one of ${VALID_LAYERS.join(' | ')} (got ${String(input.layer)})`);
    }
    const db = openDb(project);
    const id = crypto.randomUUID();
    const ts = nowIso();
    const attempt = input.attempt ?? 1;
    db.prepare(
      `INSERT INTO friction_notes (id, todoId, session, attempt, layer, retryReason, detail, createdAt)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, input.todoId ?? null, input.session ?? null, attempt, input.layer, input.retryReason, input.detail ?? null, ts);
    return rowToNote(db.prepare('SELECT * FROM friction_notes WHERE id = ?').get(id));
  });
}

/** Query friction notes, newest first. Filter by todoId / session / layer — e.g.
 *  `listFriction(project, { layer: 'domain' })` answers "which todos hit
 *  domain-layer friction and why" without opening any worker transcript. */
export function listFriction(project: string, filter: FrictionFilter = {}): FrictionNote[] {
  const db = openDb(project);
  const where: string[] = [];
  const params: string[] = [];
  if (filter.todoId) { where.push('todoId = ?'); params.push(filter.todoId); }
  if (filter.session) { where.push('session = ?'); params.push(filter.session); }
  if (filter.layer) { where.push('layer = ?'); params.push(filter.layer); }
  const sql = `SELECT * FROM friction_notes${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt DESC, rowid DESC`;
  return (db.prepare(sql).all(...params) as any[]).map(rowToNote);
}

/** Read durable watch-dedup state for a signal key (operational friction watcher
 *  uses this to record a STANDING condition once per edge, not every tick).
 *  Returns null if the key has never been set. Unlocked read, mirrors listFriction. */
export function getWatchState(project: string, signalKey: string): string | null {
  const db = openDb(project);
  const row = db
    .prepare('SELECT state FROM friction_watch_state WHERE signalKey = ?')
    .get(signalKey) as { state?: string } | undefined;
  return row?.state ?? null;
}

/** Upsert durable watch-dedup state. Serialized via withLock like recordFriction. */
export function setWatchState(project: string, signalKey: string, state: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare(
      `INSERT INTO friction_watch_state (signalKey, state, updatedAt) VALUES (?,?,?)
       ON CONFLICT(signalKey) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`
    ).run(signalKey, state, nowIso());
  });
}
