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
  /** Per-project context-watchdog trigger threshold (%), or null to use the default. */
  watchdogThresholdPercent: number | null;
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

export const ESCALATION_KINDS = ['question', 'decision', 'blocker', 'approval'] as const;
export type EscalationKind = typeof ESCALATION_KINDS[number];

const DDL = `
CREATE TABLE IF NOT EXISTS watched_project (
  project TEXT PRIMARY KEY,
  addedAt INTEGER NOT NULL,
  watchdogThresholdPercent INTEGER
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
CREATE TABLE IF NOT EXISTS supervisor_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  supervisorProject TEXT NOT NULL,
  supervisorSession TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supervisor_audit (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  detail TEXT,
  serverId TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON supervisor_audit(ts);
CREATE INDEX IF NOT EXISTS idx_audit_project ON supervisor_audit(project, ts);
CREATE TABLE IF NOT EXISTS supervisor_pause (
  scope TEXT PRIMARY KEY,
  pausedAt INTEGER NOT NULL
);
`;

/** Scope for an emergency pause: the literal 'global' or a project path. */
export const GLOBAL_PAUSE_SCOPE = 'global';

let db: Database | null = null;

function addColumnIfMissing(d: Database, table: string, col: string, ddl: string): void {
  const cols = d.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function openDb(): Database {
  if (db) return db;
  // MERMAID_SUPERVISOR_DIR lets tests isolate the global supervisor.db.
  const dir = process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'supervisor.db');
  db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // Idempotent migrations for existing DBs.
  addColumnIfMissing(db, 'supervised_session', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'escalation', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'supervisor_identity', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'watched_project', 'watchdogThresholdPercent', 'watchdogThresholdPercent INTEGER');
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

/** Per-project context-watchdog threshold (%), or null if unset (use default). */
export function getWatchdogThreshold(project: string): number | null {
  const d = openDb();
  const row = d.query('SELECT watchdogThresholdPercent FROM watched_project WHERE project = ?')
    .get(project) as { watchdogThresholdPercent: number | null } | undefined;
  return row?.watchdogThresholdPercent ?? null;
}

/** Set (or clear, with null) a project's watchdog threshold. Upserts the watched_project row. */
export function setWatchdogThreshold(project: string, percent: number | null): void {
  const d = openDb();
  d.prepare(
    `INSERT INTO watched_project (project, addedAt, watchdogThresholdPercent) VALUES (?, ?, ?)
     ON CONFLICT(project) DO UPDATE SET watchdogThresholdPercent = excluded.watchdogThresholdPercent`,
  ).run(project, Date.now(), percent);
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

/**
 * Create an open escalation, deduping on (project, session, questionText). Returns
 * the escalation AND whether it was newly created — so callers broadcast/notify
 * only for genuinely-new escalations WITHOUT a separate pre-check (closes the
 * read-then-create TOCTOU; the check+insert here is one synchronous step).
 */
export function createEscalation(input: {
  project: string;
  session: string;
  kind: string;
  questionText: string;
  serverId?: string;
}): { escalation: Escalation; isNew: boolean } {
  const d = openDb();
  const existing = d
    .query("SELECT * FROM escalation WHERE project = ? AND session = ? AND questionText = ? AND status = 'open'")
    .get(input.project, input.session, input.questionText) as Escalation | null;
  if (existing) return { escalation: existing, isNew: false };

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const serverId = input.serverId ?? '';
  d.prepare(
    'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, input.project, input.session, input.kind, input.questionText, 'open', createdAt, null, serverId);
  return {
    escalation: {
      id,
      project: input.project,
      session: input.session,
      kind: input.kind,
      questionText: input.questionText,
      status: 'open',
      createdAt,
      resolvedAt: null,
      serverId,
    },
    isNew: true,
  };
}

export function listEscalations(status?: string): Escalation[] {
  const d = openDb();
  if (status !== undefined) {
    return d.query("SELECT * FROM escalation WHERE status = ? ORDER BY createdAt DESC").all(status) as Escalation[];
  }
  return d.query("SELECT * FROM escalation ORDER BY createdAt DESC").all() as Escalation[];
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

// --- Supervisor audit log (durable decision/action trail) ---

/** Action/decision kinds the supervisor records. Free-form, but these are canonical. */
export const SUPERVISOR_AUDIT_KINDS = ['nudge', 'escalate', 'checkpoint', 'clear', 'classify', 'reconcile', 'override'] as const;

export interface SupervisorAuditEntry {
  id: string;
  ts: number;
  kind: string;
  project: string;
  session: string;
  detail: string | null;
  serverId: string;
}

/**
 * Append a supervisor decision/action to the durable audit trail. Survives
 * restart (addresses the supervisor SPOF: no audit log surviving restart) and
 * feeds the System Map + observability. `detail` is free text or JSON.
 */
export function recordSupervisorAudit(input: {
  kind: string;
  project: string;
  session: string;
  detail?: string | null;
  serverId?: string;
  ts?: number;
}): SupervisorAuditEntry {
  const d = openDb();
  const entry: SupervisorAuditEntry = {
    id: crypto.randomUUID(),
    ts: input.ts ?? Date.now(),
    kind: input.kind,
    project: input.project,
    session: input.session,
    detail: input.detail ?? null,
    serverId: input.serverId ?? '',
  };
  d.prepare(
    'INSERT INTO supervisor_audit (id, ts, kind, project, session, detail, serverId) VALUES (?,?,?,?,?,?,?)'
  ).run(entry.id, entry.ts, entry.kind, entry.project, entry.session, entry.detail, entry.serverId);
  return entry;
}

/** Most-recent-first audit entries, optionally filtered by project and/or kind. */
export function listSupervisorAudit(filter?: { project?: string; kind?: string; limit?: number }): SupervisorAuditEntry[] {
  const d = openDb();
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter?.project) { where.push('project = ?'); params.push(filter.project); }
  if (filter?.kind) { where.push('kind = ?'); params.push(filter.kind); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 1000);
  return d.query(
    `SELECT * FROM supervisor_audit ${clause} ORDER BY ts DESC LIMIT ?`,
  ).all(...params, limit) as SupervisorAuditEntry[];
}

// --- Emergency pause / override (supervisor SPOF safety) ---

/** Pause ('global' or a project path) or resume supervisor driving-actions. */
export function setSupervisorPause(scope: string, paused: boolean): void {
  const d = openDb();
  if (paused) {
    d.prepare('INSERT INTO supervisor_pause (scope, pausedAt) VALUES (?,?) ON CONFLICT(scope) DO UPDATE SET pausedAt = excluded.pausedAt')
      .run(scope, Date.now());
  } else {
    d.prepare('DELETE FROM supervisor_pause WHERE scope = ?').run(scope);
  }
}

/** True if supervisor actions are paused globally, or for this specific project. */
export function isSupervisorPaused(project?: string): boolean {
  const d = openDb();
  const scopes = project ? [GLOBAL_PAUSE_SCOPE, project] : [GLOBAL_PAUSE_SCOPE];
  const placeholders = scopes.map(() => '?').join(',');
  const row = d.query(`SELECT 1 FROM supervisor_pause WHERE scope IN (${placeholders}) LIMIT 1`).get(...scopes);
  return !!row;
}

/** All active pauses (for UI/visibility). */
export function listSupervisorPauses(): Array<{ scope: string; pausedAt: number }> {
  const d = openDb();
  return d.query('SELECT scope, pausedAt FROM supervisor_pause ORDER BY pausedAt').all() as Array<{ scope: string; pausedAt: number }>;
}

// --- Supervisor identity (single global supervisor session) ---

export interface SupervisorConfig {
  supervisorProject: string;
  supervisorSession: string;
  updatedAt: number;
}

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

export function getSupervisorConfig(): SupervisorConfig | null {
  const d = openDb();
  const row = d.query('SELECT supervisorProject, supervisorSession, updatedAt FROM supervisor_config WHERE id = 1').get() as
    | SupervisorConfig
    | null;
  return row ?? null;
}

export function setSupervisorConfig(supervisorProject: string, supervisorSession: string): SupervisorConfig {
  const d = openDb();
  const updatedAt = Date.now();
  d.prepare(
    'INSERT OR REPLACE INTO supervisor_config (id, supervisorProject, supervisorSession, updatedAt) VALUES (1, ?, ?, ?)'
  ).run(supervisorProject, supervisorSession, updatedAt);
  return { supervisorProject, supervisorSession, updatedAt };
}

// --- Peer registry (in-memory cache of known peer servers) ---

export interface PeerInfo { serverId: string; baseUrl: string; token?: string }
let peerRegistry: PeerInfo[] = [];
export function setPeerRegistry(peers: PeerInfo[]): void { peerRegistry = peers; }
export function getPeer(serverId: string): PeerInfo | undefined { return peerRegistry.find((p) => p.serverId === serverId); }
export function listPeers(): PeerInfo[] { return peerRegistry; }
