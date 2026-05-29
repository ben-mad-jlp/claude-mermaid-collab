import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * GLOBAL supervisor store (single connection).
 *
 * Replaces the v1 per-project supervisor membership store. All supervisor
 * state lives in one DB at `~/.mermaid-collab/supervisor.db` (WAL mode,
 * single cached connection): watched projects, supervised sessions,
 * attended locks, and escalations.
 */

export interface WatchedProject {
  project: string;
  addedAt: number;
}

export interface SupervisedSession {
  project: string;
  session: string;
  source: 'roadmap' | 'manual';
  addedAt: number;
}

export interface AttendedLock {
  project: string;
  session: string;
  lockedAt: number;
  reason: string;
  expiresAt: number;
}

export interface Escalation {
  id: string;
  project: string;
  session: string;
  kind: string;
  questionText: string;
  status: string;
  createdAt: number;
  resolvedAt: number | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS watched_project (
  project TEXT PRIMARY KEY,
  addedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supervised_session (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  source TEXT NOT NULL,
  addedAt INTEGER NOT NULL,
  PRIMARY KEY (project, session)
);
CREATE TABLE IF NOT EXISTS attended_lock (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  lockedAt INTEGER NOT NULL,
  reason TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  PRIMARY KEY (project, session)
);
CREATE TABLE IF NOT EXISTS escalation (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  kind TEXT NOT NULL,
  questionText TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  resolvedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_esc_open ON escalation(project, session, questionText, status);
CREATE TABLE IF NOT EXISTS supervisor_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
`;

let db: Database | null = null;

function openDb(): Database {
  if (db) return db;
  const dir = join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'supervisor.db');
  db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

// --- Watched projects ---

export function addWatchedProject(project: string): void {
  const d = openDb();
  d.prepare('INSERT OR IGNORE INTO watched_project (project, addedAt) VALUES (?,?)').run(
    project,
    Date.now()
  );
}

export function removeWatchedProject(project: string): void {
  const d = openDb();
  d.prepare('DELETE FROM watched_project WHERE project = ?').run(project);
}

export function listWatchedProjects(): WatchedProject[] {
  const d = openDb();
  return d.query('SELECT * FROM watched_project ORDER BY addedAt').all() as WatchedProject[];
}

// --- Supervised sessions ---

export function addSupervised(
  project: string,
  session: string,
  source: 'roadmap' | 'manual'
): void {
  const d = openDb();
  d.prepare(
    'INSERT OR IGNORE INTO supervised_session (project, session, source, addedAt) VALUES (?,?,?,?)'
  ).run(project, session, source, Date.now());
}

export function removeSupervised(project: string, session: string): void {
  const d = openDb();
  d.prepare('DELETE FROM supervised_session WHERE project = ? AND session = ?').run(
    project,
    session
  );
}

export function listSupervised(): SupervisedSession[] {
  const d = openDb();
  return d.query('SELECT * FROM supervised_session ORDER BY addedAt').all() as SupervisedSession[];
}

export function isSupervised(project: string, session: string): boolean {
  const d = openDb();
  const row = d
    .query('SELECT 1 FROM supervised_session WHERE project = ? AND session = ?')
    .get(project, session);
  return !!row;
}

// --- Attended locks ---

const DEFAULT_LOCK_TTL_MS = 30 * 60 * 1000;

export function setLock(
  project: string,
  session: string,
  reason: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): void {
  const d = openDb();
  const now = Date.now();
  d.prepare(
    'INSERT OR REPLACE INTO attended_lock (project, session, lockedAt, reason, expiresAt) VALUES (?,?,?,?,?)'
  ).run(project, session, now, reason, now + ttlMs);
}

export function releaseLock(project: string, session: string): void {
  const d = openDb();
  d.prepare('DELETE FROM attended_lock WHERE project = ? AND session = ?').run(project, session);
}

export function getLock(project: string, session: string): AttendedLock | null {
  const d = openDb();
  const row = d
    .query('SELECT * FROM attended_lock WHERE project = ? AND session = ?')
    .get(project, session) as AttendedLock | null;
  return row ?? null;
}

export function listLocks(): AttendedLock[] {
  const d = openDb();
  // Only return live (non-expired) locks so callers (GET /locks, the UI lock
  // badge) don't show a 🔒 forever after a lock has logically expired. This
  // matches isLocked()'s expiry semantics.
  return d.query('SELECT * FROM attended_lock WHERE expiresAt > ?').all(Date.now()) as AttendedLock[];
}

export function isLocked(project: string, session: string): boolean {
  const lock = getLock(project, session);
  if (!lock) return false;
  if (lock.expiresAt <= Date.now()) return false;
  return true;
}

// --- Escalations ---

export function createEscalation(input: {
  project: string;
  session: string;
  kind: string;
  questionText: string;
}): Escalation {
  const d = openDb();
  const existing = d
    .query("SELECT * FROM escalation WHERE project = ? AND session = ? AND questionText = ? AND status = 'open'")
    .get(input.project, input.session, input.questionText) as Escalation | null;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  d.prepare(
    'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, resolvedAt) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, input.project, input.session, input.kind, input.questionText, 'open', createdAt, null);
  return {
    id,
    project: input.project,
    session: input.session,
    kind: input.kind,
    questionText: input.questionText,
    status: 'open',
    createdAt,
    resolvedAt: null,
  };
}

export function listOpenEscalations(): Escalation[] {
  const d = openDb();
  return d
    .query("SELECT * FROM escalation WHERE status = 'open' ORDER BY createdAt")
    .all() as Escalation[];
}

export function resolveEscalation(id: string, status: string): void {
  const d = openDb();
  d.prepare('UPDATE escalation SET status = ?, resolvedAt = ? WHERE id = ?').run(
    status,
    Date.now(),
    id
  );
}

// --- Supervisor identity (single global supervisor session) ---

export interface SupervisorIdentity {
  project: string;
  session: string;
  updatedAt: number;
}

/** Register which collab session IS the supervisor (singleton, id=1). */
export function setSupervisorIdentity(project: string, session: string): void {
  const d = openDb();
  d.prepare(
    'INSERT OR REPLACE INTO supervisor_identity (id, project, session, updatedAt) VALUES (1, ?, ?, ?)'
  ).run(project, session, Date.now());
}

export function getSupervisorIdentity(): SupervisorIdentity | null {
  const d = openDb();
  const row = d.query('SELECT project, session, updatedAt FROM supervisor_identity WHERE id = 1').get() as
    | SupervisorIdentity
    | null;
  return row ?? null;
}
