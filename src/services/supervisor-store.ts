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
  serverId: string;
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
  serverId: string;
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
  serverId TEXT NOT NULL DEFAULT '',
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
  resolvedAt INTEGER,
  serverId TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_esc_open ON escalation(project, session, questionText, status);
CREATE TABLE IF NOT EXISTS supervisor_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  serverId TEXT NOT NULL DEFAULT ''
);
`;

let db: Database | null = null;

function addColumnIfMissing(d: Database, table: string, col: string, ddl: string): void {
  const cols = d.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function openDb(): Database {
  if (db) return db;
  const dir = join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'supervisor.db');
  db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // Idempotent migrations for existing DBs.
  addColumnIfMissing(db, 'supervised_session', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'escalation', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'supervisor_identity', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
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
  source: 'roadmap' | 'manual',
  serverId = ''
): void {
  const d = openDb();
  d.prepare(
    'INSERT OR IGNORE INTO supervised_session (project, session, source, addedAt, serverId) VALUES (?,?,?,?,?)'
  ).run(project, session, source, Date.now(), serverId);
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


// --- Escalations ---

export function createEscalation(input: {
  project: string;
  session: string;
  kind: string;
  questionText: string;
  serverId?: string;
}): Escalation {
  const d = openDb();
  const existing = d
    .query("SELECT * FROM escalation WHERE project = ? AND session = ? AND questionText = ? AND status = 'open'")
    .get(input.project, input.session, input.questionText) as Escalation | null;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const serverId = input.serverId ?? '';
  d.prepare(
    'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, input.project, input.session, input.kind, input.questionText, 'open', createdAt, null, serverId);
  return {
    id,
    project: input.project,
    session: input.session,
    kind: input.kind,
    questionText: input.questionText,
    status: 'open',
    createdAt,
    resolvedAt: null,
    serverId,
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
  serverId: string;
}

/** Register which collab session IS the supervisor (singleton, id=1). */
export function setSupervisorIdentity(project: string, session: string, serverId = ''): void {
  const d = openDb();
  d.prepare(
    'INSERT OR REPLACE INTO supervisor_identity (id, project, session, updatedAt, serverId) VALUES (1, ?, ?, ?, ?)'
  ).run(project, session, Date.now(), serverId);
}

export function getSupervisorIdentity(): SupervisorIdentity | null {
  const d = openDb();
  const row = d.query('SELECT project, session, updatedAt, serverId FROM supervisor_identity WHERE id = 1').get() as
    | SupervisorIdentity
    | null;
  return row ?? null;
}

// --- Peer registry (in-memory cache of known peer servers) ---

export interface PeerInfo { serverId: string; baseUrl: string; token?: string }
let peerRegistry: PeerInfo[] = [];
export function setPeerRegistry(peers: PeerInfo[]): void { peerRegistry = peers; }
export function getPeer(serverId: string): PeerInfo | undefined { return peerRegistry.find((p) => p.serverId === serverId); }
export function listPeers(): PeerInfo[] { return peerRegistry; }
