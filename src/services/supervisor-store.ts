import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { validateUiSpec, type JsonRenderSpec } from './escalation-ui-schema';

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
  source: 'roadmap' | 'manual' | 'spawn';
  addedAt: number;
  serverId: string;
  /** The project the worker's tmux session was actually launched under, when it
   *  differs from the tracking `project` (a cross-project coordinator spawn:
   *  targetProject != tracking project). Null for the common same-project case.
   *  The supervised list stays grouped/scoped by the tracking `project`; this
   *  field only carries the launch project so create-terminal can derive the
   *  SAME tmux name the worker was launched under (tmuxBaseName(launchProject,
   *  session)) instead of the wrong tmuxBaseName(project, session). */
  launchProject: string | null;
}


/** A selectable answer for a structured escalation (A/B-style decision). */
export interface EscalationOption {
  id: string;
  label: string;
  detail?: string;
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
  /** The work-graph todo this escalation is about, when known — gives an exact
   *  link so the escalation can be auto-resolved when that todo completes. Null
   *  for escalations not tied to a specific todo. */
  todoId: string | null;
  /** Structured decision options for an A/B-style escalation. Empty/null when the
   *  escalation is a plain question (questionText only). */
  options: EscalationOption[] | null;
  /** The id of the recommended option (must be one of options[].id). Null when
   *  there is no recommendation or no options. */
  recommended: string | null;
  /** Optional rich JSON-render decision spec (BR-4). Server-validated against the
   *  closed catalog; null when absent or invalid. The options[] / legacy card
   *  remains the fallback, so this never affects answerability. */
  ui: JsonRenderSpec | null;
}

export const ESCALATION_KINDS = ['question', 'decision', 'blocker', 'approval'] as const;
export type EscalationKind = typeof ESCALATION_KINDS[number];

/** A human's answer to a (structured) escalation, posted via the decide endpoint
 *  and polled by the await_human_decision MCP tool. Keyed 1:1 by escalationId. */
export interface EscalationDecision {
  escalationId: string;
  /** The chosen option id (one of the escalation's options[].id), or null for a
   *  free-text-only answer. */
  optionId: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: number;
}

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
  launchProject TEXT,
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
  serverId TEXT NOT NULL DEFAULT '',
  todoId TEXT,
  optionsJson TEXT,
  recommended TEXT,
  uiJson TEXT
);
CREATE INDEX IF NOT EXISTS idx_esc_open ON escalation(project, session, questionText, status);
CREATE TABLE IF NOT EXISTS escalation_decision (
  escalationId TEXT PRIMARY KEY,
  optionId TEXT,
  note TEXT,
  decidedBy TEXT,
  decidedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supervisor_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  serverId TEXT NOT NULL DEFAULT '',
  epoch INTEGER NOT NULL DEFAULT 0
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
CREATE TABLE IF NOT EXISTS supervisor_decision (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  workerSession TEXT NOT NULL,
  signal TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  sigHash TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  verdictReason TEXT,
  resolvedBy TEXT,
  resolvedEpoch INTEGER,
  createdAt INTEGER NOT NULL,
  resolvedAt INTEGER
);
CREATE INDEX IF NOT EXISTS idx_decision_pending ON supervisor_decision(project, status, createdAt);
CREATE INDEX IF NOT EXISTS idx_decision_dedup ON supervisor_decision(sigHash, status);
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
  addColumnIfMissing(db, 'supervised_session', 'launchProject', 'launchProject TEXT');
  addColumnIfMissing(db, 'escalation', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'supervisor_identity', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'supervisor_identity', 'epoch', 'epoch INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'watched_project', 'watchdogThresholdPercent', 'watchdogThresholdPercent INTEGER');
  addColumnIfMissing(db, 'escalation', 'todoId', 'todoId TEXT');
  addColumnIfMissing(db, 'escalation', 'optionsJson', 'optionsJson TEXT');
  addColumnIfMissing(db, 'escalation', 'recommended', 'recommended TEXT');
  addColumnIfMissing(db, 'escalation', 'uiJson', 'uiJson TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_esc_todo ON escalation(project, todoId, status)');
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
  source: 'roadmap' | 'manual' | 'spawn',
  serverId = '',
  launchProject: string | null = null
): void {
  const d = openDb();
  // Only persist launchProject when it actually differs from the tracking
  // project — null keeps the common same-project case semantically clean and
  // lets create-terminal fall back to `project`.
  const launch = launchProject && launchProject !== project ? launchProject : null;
  d.prepare(
    'INSERT OR IGNORE INTO supervised_session (project, session, source, addedAt, serverId, launchProject) VALUES (?,?,?,?,?,?)'
  ).run(project, session, source, Date.now(), serverId, launch);
}

/** The project a supervised worker's tmux was launched under, when it differs
 *  from the tracking `project` (cross-project coordinator spawn). Returns null
 *  for same-project workers or unknown rows — callers fall back to `project`.
 *  This is what lets create-terminal derive the SAME tmux name the worker was
 *  launched under (the cross-project wrong-terminal bug fix). */
export function getSupervisedLaunchProject(project: string, session: string): string | null {
  const d = openDb();
  const row = d
    .query('SELECT launchProject FROM supervised_session WHERE project = ? AND session = ?')
    .get(project, session) as { launchProject: string | null } | undefined;
  return row?.launchProject ?? null;
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

/** Raw DB row shape: structured options live in a JSON column (`optionsJson`),
 *  parsed into `options` by mapEscalationRow before crossing the store boundary. */
type EscalationRow = Omit<Escalation, 'options' | 'ui'> & { optionsJson: string | null; uiJson: string | null };

/** Parse a stored ui blob, re-validating against the closed catalog (defensive). */
function parseUi(json: string | null): JsonRenderSpec | null {
  if (!json) return null;
  try {
    return validateUiSpec(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Parse a stored options blob into a typed array, tolerating null/garbage. */
function parseOptions(json: string | null): EscalationOption[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed
      .filter((o): o is EscalationOption => o && typeof o.id === 'string' && typeof o.label === 'string')
      .map((o) => ({ id: o.id, label: o.label, ...(o.detail != null ? { detail: String(o.detail) } : {}) }));
  } catch {
    return null;
  }
}

/** Map a raw DB row to the public Escalation shape (optionsJson → options[]). */
function mapEscalationRow(row: EscalationRow): Escalation {
  const { optionsJson, uiJson, ...rest } = row;
  return { ...rest, options: parseOptions(optionsJson), recommended: row.recommended ?? null, ui: parseUi(uiJson) };
}

/**
 * Create an open escalation, deduping on (project, session, questionText). Returns
 * the escalation AND whether it was newly created — so callers broadcast/notify
 * only for genuinely-new escalations WITHOUT a separate pre-check (closes the
 * read-then-create TOCTOU; the check+insert here is one synchronous step).
 *
 * Optional `options`/`recommended` carry a structured A/B-style decision; when
 * omitted the escalation is a plain question (questionText only). `recommended`
 * is only stored when it names one of the provided options.
 */
export function createEscalation(input: {
  project: string;
  session: string;
  kind: string;
  questionText: string;
  serverId?: string;
  todoId?: string | null;
  options?: EscalationOption[] | null;
  recommended?: string | null;
  ui?: unknown;
}): { escalation: Escalation; isNew: boolean } {
  const d = openDb();
  const existing = d
    .query("SELECT * FROM escalation WHERE project = ? AND session = ? AND questionText = ? AND status = 'open'")
    .get(input.project, input.session, input.questionText) as EscalationRow | null;
  if (existing) return { escalation: mapEscalationRow(existing), isNew: false };

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const serverId = input.serverId ?? '';
  const todoId = input.todoId ?? null;
  const options = input.options && input.options.length > 0 ? input.options : null;
  const optionsJson = options ? JSON.stringify(options) : null;
  // Only honour a recommendation that points at a real option.
  const recommended = options && input.recommended && options.some((o) => o.id === input.recommended)
    ? input.recommended
    : null;
  // Server-side validation of the optional rich ui spec (closed catalog,
  // terminal-action required, ≤40 elements). Invalid → dropped to null.
  const ui = validateUiSpec(input.ui);
  const uiJson = ui ? JSON.stringify(ui) : null;
  d.prepare(
    'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId, todoId, optionsJson, recommended, uiJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, input.project, input.session, input.kind, input.questionText, 'open', createdAt, null, serverId, todoId, optionsJson, recommended, uiJson);
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
      todoId,
      options,
      recommended,
      ui,
    },
    isNew: true,
  };
}

export function listEscalations(status?: string): Escalation[] {
  const d = openDb();
  const rows = status !== undefined
    ? d.query("SELECT * FROM escalation WHERE status = ? ORDER BY createdAt DESC").all(status) as EscalationRow[]
    : d.query("SELECT * FROM escalation ORDER BY createdAt DESC").all() as EscalationRow[];
  return rows.map(mapEscalationRow);
}

export function listOpenEscalations(): Escalation[] {
  const d = openDb();
  return (d
    .query("SELECT * FROM escalation WHERE status = 'open' ORDER BY createdAt")
    .all() as EscalationRow[]).map(mapEscalationRow);
}

export function getEscalation(id: string): Escalation | null {
  const d = openDb();
  const row = d.query('SELECT * FROM escalation WHERE id = ?').get(id) as EscalationRow | null;
  return row ? mapEscalationRow(row) : null;
}

export function resolveEscalation(id: string, status: string): void {
  const d = openDb();
  d.prepare('UPDATE escalation SET status = ?, resolvedAt = ? WHERE id = ?').run(
    status,
    Date.now(),
    id
  );
}

// --- Escalation decisions (poll-await relay; ED2) ---

/**
 * Record a human's answer to an escalation (idempotent upsert keyed by
 * escalationId). The await_human_decision MCP tool polls getEscalationDecision
 * until this row appears. Storing the answer does NOT itself resolve the
 * escalation — the decide route pairs this with resolveEscalation.
 */
export function recordEscalationDecision(input: {
  escalationId: string;
  optionId?: string | null;
  note?: string | null;
  decidedBy?: string | null;
}): EscalationDecision {
  const d = openDb();
  const decidedAt = Date.now();
  const optionId = input.optionId ?? null;
  const note = input.note ?? null;
  const decidedBy = input.decidedBy ?? null;
  d.prepare(
    `INSERT INTO escalation_decision (escalationId, optionId, note, decidedBy, decidedAt) VALUES (?,?,?,?,?)
     ON CONFLICT(escalationId) DO UPDATE SET optionId = excluded.optionId, note = excluded.note, decidedBy = excluded.decidedBy, decidedAt = excluded.decidedAt`,
  ).run(input.escalationId, optionId, note, decidedBy, decidedAt);
  return { escalationId: input.escalationId, optionId, note, decidedBy, decidedAt };
}

export function getEscalationDecision(escalationId: string): EscalationDecision | null {
  const d = openDb();
  const row = d.query('SELECT * FROM escalation_decision WHERE escalationId = ?').get(escalationId) as EscalationDecision | null;
  return row ?? null;
}

/**
 * Auto-resolve all OPEN escalations linked to a todo that just reached a
 * terminal state. Matches by exact `todoId` (escalations filed by the
 * coordinator carry it) OR by any of the given `sessions` (worker-<id8> /
 * pool session names — covers escalations filed before the todoId link
 * existed, e.g. a worker self-escalation). Returns the resolved escalations
 * so callers can broadcast/audit them. A no-op (returns []) when nothing matches.
 */
export function resolveEscalationsForTodo(
  project: string,
  todoId: string,
  sessions: string[] = [],
  status = 'resolved',
): Escalation[] {
  const d = openDb();
  const open = (d
    .query("SELECT * FROM escalation WHERE project = ? AND status = 'open'")
    .all(project) as EscalationRow[]).map(mapEscalationRow);
  const sessionSet = new Set(sessions.filter(Boolean));
  const matched = open.filter((e) => e.todoId === todoId || sessionSet.has(e.session));
  if (matched.length === 0) return [];
  const resolvedAt = Date.now();
  const stmt = d.prepare('UPDATE escalation SET status = ?, resolvedAt = ? WHERE id = ?');
  for (const e of matched) stmt.run(status, resolvedAt, e.id);
  return matched.map((e) => ({ ...e, status, resolvedAt }));
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
  /**
   * Monotonic ownership counter (NOT a timestamp — clock-skew-immune). Bumped on
   * every register. The single-writer fence: only the caller holding the CURRENT
   * epoch may mutate as the supervisor; a superseded (hung-then-resumed) supervisor
   * carries an older epoch and is rejected server-side. See assertSupervisorOwner.
   */
  epoch: number;
}

/**
 * Structured error thrown by assertSupervisorOwner when a caller's epoch is no
 * longer the current one (i.e. it was superseded by a respawn). The MCP handlers
 * catch this and return a `{ superseded: true }` payload performing NO write.
 */
export class SupersededError extends Error {
  readonly superseded = true;
  constructor(
    readonly callerEpoch: number | undefined,
    readonly currentEpoch: number | null,
    readonly currentSession: string | null,
  ) {
    super(
      `superseded: caller epoch ${callerEpoch ?? '(none)'} is not the current supervisor epoch ` +
        `${currentEpoch ?? '(no supervisor registered)'}`,
    );
    this.name = 'SupersededError';
  }
}

/**
 * Register which collab session IS the supervisor (singleton, id=1) and bump the
 * ownership epoch. Returns the NEW epoch — the caller must carry it on subsequent
 * mutating supervisor calls so the server can fence a superseded predecessor.
 */
export function setSupervisorIdentity(project: string, session: string, serverId = ''): number {
  const d = openDb();
  const prev = d.query('SELECT epoch FROM supervisor_identity WHERE id = 1').get() as { epoch: number } | null;
  const epoch = (prev?.epoch ?? 0) + 1;
  d.prepare(
    'INSERT OR REPLACE INTO supervisor_identity (id, project, session, updatedAt, serverId, epoch) VALUES (1, ?, ?, ?, ?, ?)'
  ).run(project, session, Date.now(), serverId, epoch);
  return epoch;
}

/**
 * Server-enforced single-writer fence (PCS invariant b9c4c5d applied to the
 * supervisor role). Throws SupersededError — performing NO write — when `epoch`
 * is not the current ownership epoch. A caller that omits its epoch is treated as
 * superseded too (it cannot prove ownership). This is the authoritative fence;
 * the supervisor skill self-exiting on `superseded` is only the politeness layer.
 */
export function assertSupervisorOwner(epoch: number | undefined): void {
  const id = getSupervisorIdentity();
  if (id == null || epoch == null || epoch !== id.epoch) {
    throw new SupersededError(epoch, id?.epoch ?? null, id?.session ?? null);
  }
}

/**
 * Heartbeat: refresh ONLY supervisor_identity.updatedAt to "now". No-op if no
 * supervisor is registered (id=1 row absent). Returns true if a row was
 * touched. This is what lets the UI distinguish a live supervisor from a
 * crashed/stale one — register_supervisor writes updatedAt once; this keeps
 * it advancing while the supervisor is alive.
 */
export function touchSupervisorIdentity(epoch?: number): boolean {
  const d = openDb();
  // Fenced touch: when an epoch is supplied, only the current owner may advance
  // liveness — a superseded supervisor cannot resurrect ownership by heartbeating.
  // Omitting the epoch is the server's own best-effort heartbeat (it keeps whoever
  // currently owns the row alive, which is always correct).
  if (epoch != null) {
    const info = d.prepare('UPDATE supervisor_identity SET updatedAt = ? WHERE id = 1 AND epoch = ?').run(Date.now(), epoch);
    return info.changes > 0;
  }
  const info = d.prepare('UPDATE supervisor_identity SET updatedAt = ? WHERE id = 1').run(Date.now());
  return info.changes > 0;
}

/** Heartbeat cadence (ms) the server refreshes supervisor liveness at. */
export const SUPERVISOR_HEARTBEAT_INTERVAL_MS = 30_000;
/** A supervisor is considered stale once updatedAt is older than this (2x heartbeat). */
export const SUPERVISOR_STALE_AFTER_MS = SUPERVISOR_HEARTBEAT_INTERVAL_MS * 2;

export function getSupervisorIdentity(): SupervisorIdentity | null {
  const d = openDb();
  const row = d.query('SELECT project, session, updatedAt, serverId, epoch FROM supervisor_identity WHERE id = 1').get() as
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

// --- Supervisor decision queue (COORD watchdog↔supervisor handoff) ---------------
//
// Realizes design `design-watchdog-daemon-decision-handoff` (decision eb3c3e60).
// The MECHANICAL watchdog runs as a deterministic daemon; it NEVER judges an
// ambiguous worker stop itself — it enqueues a bounded decision REQUEST here and
// later ACTS on the verdict an on-demand supervisor LLM session writes back. This
// durable SQLite queue is the handoff seam between the two:
//
//   daemon detects ambiguous stop → enqueueDecision (deduped by sigHash)
//     → supervisor LLM reads getNextPendingDecision → resolveDecision(verdict)
//       → daemon acts on the verdict (escalate/nudge/resume/wait) → markDecisionConsumed
//
// Fail-safe toward the human: a request never silently drops — an unresolved
// request older than the timeout defaults to ESCALATE (see coordinator-live).

/** Lifecycle of a queued decision request. */
export type DecisionStatus = 'pending' | 'resolved' | 'consumed';

/** The verdict a supervisor returns for an ambiguous stop. `escalate` surfaces it
 *  to the human (fail-safe default); `nudge`/`resume` push the worker to continue;
 *  `wait` leaves it (still working / will resolve itself). */
export type DecisionVerdict = 'escalate' | 'nudge' | 'resume' | 'wait';
export const DECISION_VERDICTS: readonly DecisionVerdict[] = ['escalate', 'nudge', 'resume', 'wait'];

export interface SupervisorDecision {
  id: string;
  project: string;
  /** The supervised worker session the ambiguous stop was observed on. */
  workerSession: string;
  /** The detection signal that enqueued this request (e.g. 'stall'). */
  signal: string;
  /** Captured pane / context snapshot the LLM judges from (capped by the caller). */
  snapshot: string;
  /** Dedupe key — repeat detections of the SAME episode collapse to one request. */
  sigHash: string;
  status: DecisionStatus;
  verdict: DecisionVerdict | null;
  verdictReason: string | null;
  /** "session@epoch" of the supervisor that resolved it (provenance). */
  resolvedBy: string | null;
  /** Ownership epoch of the resolving supervisor (epoch-gated per 2dd13c65). */
  resolvedEpoch: number | null;
  createdAt: number;
  resolvedAt: number | null;
}

interface DecisionRow {
  id: string;
  project: string;
  workerSession: string;
  signal: string;
  snapshot: string;
  sigHash: string;
  status: string;
  verdict: string | null;
  verdictReason: string | null;
  resolvedBy: string | null;
  resolvedEpoch: number | null;
  createdAt: number;
  resolvedAt: number | null;
}

function mapDecisionRow(r: DecisionRow): SupervisorDecision {
  return {
    id: r.id,
    project: r.project,
    workerSession: r.workerSession,
    signal: r.signal,
    snapshot: r.snapshot,
    sigHash: r.sigHash,
    status: r.status as DecisionStatus,
    verdict: (r.verdict as DecisionVerdict | null) ?? null,
    verdictReason: r.verdictReason ?? null,
    resolvedBy: r.resolvedBy ?? null,
    resolvedEpoch: r.resolvedEpoch ?? null,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt ?? null,
  };
}

/**
 * Enqueue a decision request for an ambiguous worker stop. DEDUPES on
 * (sigHash, status='pending'): a repeat detection of the same episode returns the
 * existing pending request instead of piling up duplicates. Returns the request
 * plus whether it was newly created (so the daemon logs/acts only for new ones).
 */
export function enqueueDecision(input: {
  project: string;
  workerSession: string;
  signal: string;
  snapshot: string;
  sigHash: string;
}): { decision: SupervisorDecision; isNew: boolean } {
  const d = openDb();
  const existing = d
    .query("SELECT * FROM supervisor_decision WHERE sigHash = ? AND status = 'pending'")
    .get(input.sigHash) as DecisionRow | null;
  if (existing) return { decision: mapDecisionRow(existing), isNew: false };
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  d.prepare(
    'INSERT INTO supervisor_decision (id, project, workerSession, signal, snapshot, sigHash, status, verdict, verdictReason, resolvedBy, resolvedEpoch, createdAt, resolvedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, input.project, input.workerSession, input.signal, input.snapshot, input.sigHash, 'pending', null, null, null, null, createdAt, null);
  return {
    decision: {
      id,
      project: input.project,
      workerSession: input.workerSession,
      signal: input.signal,
      snapshot: input.snapshot,
      sigHash: input.sigHash,
      status: 'pending',
      verdict: null,
      verdictReason: null,
      resolvedBy: null,
      resolvedEpoch: null,
      createdAt,
      resolvedAt: null,
    },
    isNew: true,
  };
}

/** All pending requests, oldest first. Optionally scoped to a project. */
export function listPendingDecisions(project?: string): SupervisorDecision[] {
  const d = openDb();
  const rows = (project
    ? d.query("SELECT * FROM supervisor_decision WHERE status = 'pending' AND project = ? ORDER BY createdAt ASC").all(project)
    : d.query("SELECT * FROM supervisor_decision WHERE status = 'pending' ORDER BY createdAt ASC").all()) as DecisionRow[];
  return rows.map(mapDecisionRow);
}

/** The oldest pending request for a project (the LLM polls this), or null. */
export function getNextPendingDecision(project?: string): SupervisorDecision | null {
  return listPendingDecisions(project)[0] ?? null;
}

/** Resolved-but-not-yet-consumed requests the daemon must still act on. */
export function listResolvedDecisions(project?: string): SupervisorDecision[] {
  const d = openDb();
  const rows = (project
    ? d.query("SELECT * FROM supervisor_decision WHERE status = 'resolved' AND project = ? ORDER BY resolvedAt ASC").all(project)
    : d.query("SELECT * FROM supervisor_decision WHERE status = 'resolved' ORDER BY resolvedAt ASC").all()) as DecisionRow[];
  return rows.map(mapDecisionRow);
}

export function getDecision(id: string): SupervisorDecision | null {
  const d = openDb();
  const row = d.query('SELECT * FROM supervisor_decision WHERE id = ?').get(id) as DecisionRow | null;
  return row ? mapDecisionRow(row) : null;
}

/**
 * Record a supervisor's verdict for a pending request. EPOCH-GATED (per 2dd13c65):
 * `assertSupervisorOwner(epoch)` throws SupersededError for a superseded supervisor,
 * performing NO write — a hung-then-resumed supervisor cannot resolve decisions a
 * replacement now owns. Only a `pending` request transitions to `resolved`
 * (idempotent: a second resolve is a no-op and returns null).
 */
export function resolveDecision(input: {
  id: string;
  verdict: DecisionVerdict;
  reason?: string | null;
  resolvedBy?: string | null;
  epoch?: number;
}): SupervisorDecision | null {
  // Single-writer fence: throws SupersededError (caught by the MCP handler) before
  // any write when the caller's epoch is stale.
  assertSupervisorOwner(input.epoch);
  const d = openDb();
  const resolvedAt = Date.now();
  const info = d
    .prepare(
      "UPDATE supervisor_decision SET status = 'resolved', verdict = ?, verdictReason = ?, resolvedBy = ?, resolvedEpoch = ?, resolvedAt = ? WHERE id = ? AND status = 'pending'"
    )
    .run(input.verdict, input.reason ?? null, input.resolvedBy ?? null, input.epoch ?? null, resolvedAt, input.id);
  if (info.changes === 0) return null;
  return getDecision(input.id);
}

/** Mark a request consumed (terminal) once the daemon has acted on it. Accepts a
 *  `resolved` row (acted on a verdict) OR a `pending` row (the timeout fail-safe
 *  escalated it without a verdict) — both end as `consumed`. Already-consumed → no-op. */
export function markDecisionConsumed(id: string): boolean {
  const d = openDb();
  const info = d
    .prepare("UPDATE supervisor_decision SET status = 'consumed' WHERE id = ? AND status IN ('pending','resolved')")
    .run(id);
  return info.changes > 0;
}

/** Count of requests still awaiting a verdict — drives on-demand supervisor spawn
 *  (a supervisor LLM session is ensured WHILE this is > 0, not always-on). */
export function pendingDecisionCount(project?: string): number {
  return listPendingDecisions(project).length;
}
