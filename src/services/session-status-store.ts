import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT session status store. Mirrors the bun:sqlite-per-project pattern
 * used by todo-store.ts: one DB file per project under `.collab`, WAL journal
 * mode, and a Map-based connection cache keyed on project path.
 */

export type ClaudeStatus = 'active' | 'waiting' | 'permission' | 'checkpoint_ready';

/** Default window in which a recorded checkpoint counts as "ready" for clearing. */
export const CHECKPOINT_READY_MAX_AGE_MS = 10 * 60 * 1000;

export interface SessionStatusRow {
  project: string;
  session: string;
  status: ClaudeStatus;
  updatedAt: number;
  /** Last reported context-window usage (0-100), or null if never reported. */
  contextPercent: number | null;
  /** When contextPercent was last reported (ms epoch), or null. */
  contextUpdatedAt: number | null;
  /** When the session confirmed its checkpoint was persisted (ms epoch), or null.
   *  The context-watchdog's HARD GATE: never /clear until this is recent. */
  checkpointReadyAt: number | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS session_status (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  status TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  contextPercent INTEGER,
  contextUpdatedAt INTEGER,
  checkpointReadyAt INTEGER,
  PRIMARY KEY (project, session)
);
CREATE TABLE IF NOT EXISTS watchdog_debounce (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  action TEXT NOT NULL,
  emittedAt INTEGER NOT NULL,
  PRIMARY KEY (project, session, action)
);
`;

const dbCache = new Map<string, Database>();

/** Add a column to an existing table if a prior schema version lacks it. */
function addColumnIfMissing(db: Database, table: string, column: string, decl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
  }
}

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'session-status.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // Migrate DBs created before these columns existed.
  addColumnIfMissing(db, 'session_status', 'contextPercent', 'contextPercent INTEGER');
  addColumnIfMissing(db, 'session_status', 'contextUpdatedAt', 'contextUpdatedAt INTEGER');
  addColumnIfMissing(db, 'session_status', 'checkpointReadyAt', 'checkpointReadyAt INTEGER');
  dbCache.set(project, db);
  return db;
}

export function recordStatus(project: string, session: string, status: ClaudeStatus): void {
  const db = openDb(project);
  db.query(
    `INSERT INTO session_status (project, session, status, updatedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project, session) DO UPDATE SET
       status = excluded.status,
       updatedAt = excluded.updatedAt`,
  ).run(project, session, status, Date.now());
}

/**
 * Persist a reported context-window percentage WITHOUT clobbering the activity
 * status. If no row exists yet the session is, by definition, active (the
 * statusline only fires for a live session), so we seed status='active'.
 */
export function recordContextPercent(project: string, session: string, contextPercent: number): void {
  const db = openDb(project);
  const now = Date.now();
  db.query(
    `INSERT INTO session_status (project, session, status, updatedAt, contextPercent, contextUpdatedAt)
     VALUES (?, ?, 'active', ?, ?, ?)
     ON CONFLICT(project, session) DO UPDATE SET
       contextPercent = excluded.contextPercent,
       contextUpdatedAt = excluded.contextUpdatedAt`,
  ).run(project, session, now, contextPercent, now);
}

/**
 * Mark a session's checkpoint as persisted (the context-watchdog gate). Sets
 * status='checkpoint_ready' AND a durable `checkpointReadyAt` marker that
 * outlives a later status flip (so a stray 'active' on resume can't reopen the
 * clear gate spuriously — only `clearCheckpointReady` does).
 */
export function recordCheckpointReady(project: string, session: string): void {
  const db = openDb(project);
  const now = Date.now();
  db.query(
    `INSERT INTO session_status (project, session, status, updatedAt, checkpointReadyAt)
     VALUES (?, ?, 'checkpoint_ready', ?, ?)
     ON CONFLICT(project, session) DO UPDATE SET
       status = 'checkpoint_ready',
       updatedAt = excluded.updatedAt,
       checkpointReadyAt = excluded.checkpointReadyAt`,
  ).run(project, session, now, now);
}

/** Consume the checkpoint-ready marker (call right after a successful /clear). */
export function clearCheckpointReady(project: string, session: string): void {
  const db = openDb(project);
  db.query(
    `UPDATE session_status SET checkpointReadyAt = NULL WHERE project = ? AND session = ?`,
  ).run(project, session);
}

/** The HARD GATE: true only if a checkpoint was recorded within `maxAgeMs`. */
export function isCheckpointReady(
  project: string,
  session: string,
  maxAgeMs: number = CHECKPOINT_READY_MAX_AGE_MS,
): boolean {
  const row = getStatus(project, session);
  if (!row || row.checkpointReadyAt == null) return false;
  return Date.now() - row.checkpointReadyAt <= maxAgeMs;
}

/**
 * Durable watchdog debounce. Returns true if `action` for this session was NOT
 * emitted within `cooldownMs` (i.e. it's OK to emit now) AND records the
 * emission. Survives a supervisor restart, so a repeatable nudge (e.g.
 * 'checkpoint') isn't re-sent every tick while we wait for the session to act.
 */
export function tryEmitWatchdogAction(
  project: string,
  session: string,
  action: string,
  cooldownMs: number,
  now: number = Date.now(),
): boolean {
  const db = openDb(project);
  const row = db.query(
    `SELECT emittedAt FROM watchdog_debounce WHERE project = ? AND session = ? AND action = ?`,
  ).get(project, session, action) as { emittedAt: number } | undefined;
  if (row && now - row.emittedAt < cooldownMs) return false;
  db.query(
    `INSERT INTO watchdog_debounce (project, session, action, emittedAt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project, session, action) DO UPDATE SET emittedAt = excluded.emittedAt`,
  ).run(project, session, action, now);
  return true;
}

/** Forget a session's debounce records (e.g. after it resumes from a clear). */
export function resetWatchdogDebounce(project: string, session: string): void {
  const db = openDb(project);
  db.query(`DELETE FROM watchdog_debounce WHERE project = ? AND session = ?`).run(project, session);
}

export function getStatuses(project: string): SessionStatusRow[] {
  const db = openDb(project);
  return db.query(
    `SELECT project, session, status, updatedAt, contextPercent, contextUpdatedAt, checkpointReadyAt
     FROM session_status
     WHERE project = ?`,
  ).all(project) as SessionStatusRow[];
}

export function getStatus(project: string, session: string): SessionStatusRow | null {
  const db = openDb(project);
  const row = db.query(
    `SELECT project, session, status, updatedAt, contextPercent, contextUpdatedAt, checkpointReadyAt
     FROM session_status
     WHERE project = ? AND session = ?`,
  ).get(project, session) as SessionStatusRow | undefined;
  return row ?? null;
}
