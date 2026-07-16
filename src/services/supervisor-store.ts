import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { validateUiSpec, type JsonRenderSpec } from './escalation-ui-schema';
import { trackingProjectRoot } from './project-registry';

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
  /** Per-project context-auto-recycle mode, or null (== 'off'). Gates the
   *  deterministic checkpoint→clear→collab driver (context-recycle.ts). */
  contextRecycleMode?: string | null;
  /** Per-project project-digest injection flag (default OFF). */
  projectDigestEnabled?: number | null;
  /** Per-project retry-context injection flag (default OFF). */
  promptInjectRetryContext?: number | null;
  /** Per-project active-constraints injection flag (default OFF). */
  promptInjectActiveConstraints?: number | null;
  /** Per-project gate SHADOW-MODE flag (default OFF). When on, a candidate gate runs
   *  advisory-only alongside the live gate. */
  gateShadowMode?: number | null;
}

/** Context-auto-recycle mode for a watched project:
 *  - 'off'    → the driver is inert (default).
 *  - 'notify' → at threshold, inject an advisory nudge; auto-clear+reload ONLY after
 *               the session itself produces a fresh checkpoint (assisted; never forces
 *               the checkpoint).
 *  - 'force'  → at threshold, inject /vibe-checkpoint, then /clear + /collab. Fully
 *               server-driven — for an unattended autonomous-loop session. */
export type ContextRecycleMode = 'off' | 'notify' | 'force';
export const CONTEXT_RECYCLE_MODES: ContextRecycleMode[] = ['off', 'notify', 'force'];


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

/** The five triage buckets the Orchestrator 'propose' level classifies into
 *  (design-unified-orchestrator-daemon §5). */
export type TriageBucket =
  | 'stale'
  | 'verified-done'
  | 'now-buildable'
  | 'genuine-decision'
  | 'needs-design';

/**
 * Orch P2 (design-orch-p2-propose): a Grok-suggested action attached INLINE to an
 * open escalation at level `propose`. NOT a separate queue — it lives and dies with
 * its escalation (no independent lifecycle to GC). The human confirms/dismisses it
 * on the escalation card; a confirm re-validates `verb`/`args.proof` through the
 * server proof gate before any mutation (Grok's classification is never trusted as
 * the act authority). `bundleInputs` records the ground-truth snapshot Grok saw, so
 * a stale suggestion (todo moved on) is detectable at confirm-time.
 */
export interface SuggestedAction {
  bucket: TriageBucket;
  /** The steward verb to apply on confirm, or null for a classify-only suggestion
   *  (genuine-decision / needs-design → no verb; just routes the human's attention). */
  verb: 'reset_todo' | 'override_accept_todo' | null;
  /** Args the verb needs — notably the machine-checkable `proof` the gate re-derives. */
  args: { proof?: unknown; status?: string } | null;
  /** Grok's self-rated confidence 0..1. */
  confidence: number;
  /** One-paragraph rationale shown on the card. */
  rationale: string;
  /** The ground-truth inputs Grok was given (git rev, dep snapshot, gate result,
   *  the todo revision) — provenance so a stale suggestion is detectable. */
  bundleInputs: Record<string, unknown>;
  /** When this suggestion was generated (ms) — drives freshness/expiry. */
  generatedAt: number;
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
  /** Server-routed destination decided at create-time by `routeOf` (design §3):
   *  'human' or 'steward'. Defaults 'human' (and is forced 'human' while
   *  MERMAID_STEWARD_AUTO is OFF). */
  routedTo: string;
  /** 1 when this escalation gates an irreversible/outward action — a hard server
   *  floor that always routes to the human, never the steward. */
  operatorGated: number;
  /** Deterministic, server-re-validated proof string cited on a steward
   *  resolution (Phase 2). Null until resolved by the steward. */
  proof: string | null;
  /** How many times the steward has auto-attempted this escalation — the thrash
   *  guard (rail 5). Defaults 0. */
  stewardAttempts: number;
  /** Orch P2: a Grok-suggested inline action (level `propose`), or null. Lives and
   *  dies with the escalation; the human confirms/dismisses it on the card. */
  suggestedAction: SuggestedAction | null;
  /** Triage lifecycle (fd934fb7): true WHILE a Grok triage consult is in flight for
   *  this escalation, so the card can show "Grok is triaging…". Flipped on before
   *  the classify await and off after; the flip is broadcast via escalation_created
   *  (an upsert by id — reuses the existing event, no new WS event per b2fe36b1). */
  triageInFlight: boolean;
  /** Who resolved this escalation when it is no longer open: 'ai' (the steward's
   *  drive auto-resolve) or 'human'. Null while open or on older rows. Lets the UI
   *  show an AI-resolved outcome briefly instead of letting it silently vanish. */
  resolvedBy: string | null;
  /** Escalation-briefing (epic 40771aab): a deep markdown decision briefing for the
   *  HUMAN — Decision/Situation/System-context/Recommendation over the enriched
   *  TriageBundle. Generated LAZILY on first human open and cached here (so a reload/
   *  recycle keeps it). Null until first briefed; degrades to the deterministic floor
   *  on LLM failure. `briefingModel` records which tier-role/model produced it. */
  briefingMd: string | null;
  briefingModel: string | null;
  briefingAt: number | null;
}

export const ESCALATION_KINDS = [
  'question',
  'decision',
  'blocker',
  'approval',
  // Steward routing (design-first-class-steward §3): a mechanical re-park request
  // (steward), a re-planning trigger (human), and an irreversible/outward gate (human).
  'needs-design',
  'assumption-invalidated',
  'operator-gated',
] as const;
export type EscalationKind = typeof ESCALATION_KINDS[number];

/** Where an escalation is routed at create-time (design §3). */
export type EscalationRoute = 'human' | 'steward';

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
  watchdogThresholdPercent INTEGER,
  contextRecycleMode TEXT,
  missionLoopMode TEXT,
  projectDigestEnabled INTEGER,
  promptInjectRetryContext INTEGER,
  promptInjectActiveConstraints INTEGER,
  gateShadowMode INTEGER
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
  uiJson TEXT,
  routedTo TEXT DEFAULT 'human',
  operatorGated INTEGER DEFAULT 0,
  proof TEXT,
  stewardAttempts INTEGER DEFAULT 0,
  suggestedActionJson TEXT,
  briefingMd TEXT,
  briefingModel TEXT,
  briefingAt INTEGER
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
  role TEXT PRIMARY KEY,
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
  addColumnIfMissing(db, 'watched_project', 'contextRecycleMode', 'contextRecycleMode TEXT');
  addColumnIfMissing(db, 'watched_project', 'missionLoopMode', 'missionLoopMode TEXT');
  addColumnIfMissing(db, 'watched_project', 'projectDigestEnabled', 'projectDigestEnabled INTEGER');
  addColumnIfMissing(db, 'watched_project', 'promptInjectRetryContext', 'promptInjectRetryContext INTEGER');
  addColumnIfMissing(db, 'watched_project', 'promptInjectActiveConstraints', 'promptInjectActiveConstraints INTEGER');
  addColumnIfMissing(db, 'watched_project', 'gateShadowMode', 'gateShadowMode INTEGER');
  addColumnIfMissing(db, 'escalation', 'todoId', 'todoId TEXT');
  addColumnIfMissing(db, 'escalation', 'optionsJson', 'optionsJson TEXT');
  addColumnIfMissing(db, 'escalation', 'recommended', 'recommended TEXT');
  addColumnIfMissing(db, 'escalation', 'uiJson', 'uiJson TEXT');
  // Steward routing (design §3): create-time route + the irreversible/outward gate
  // + the resolution proof + the thrash counter. Additive, DEFAULTed so existing
  // open escalations backfill to routedTo='human' (no behavioural change).
  addColumnIfMissing(db, 'escalation', 'routedTo', "routedTo TEXT DEFAULT 'human'");
  addColumnIfMissing(db, 'escalation', 'operatorGated', 'operatorGated INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'escalation', 'proof', 'proof TEXT');
  addColumnIfMissing(db, 'escalation', 'stewardAttempts', 'stewardAttempts INTEGER DEFAULT 0');
  // Orch P2: inline Grok-suggested action (level `propose`). Additive, DEFAULT null
  // so existing open escalations carry no suggestion (no behavioural change).
  addColumnIfMissing(db, 'escalation', 'suggestedActionJson', 'suggestedActionJson TEXT');
  // Triage lifecycle (fd934fb7): in-flight flag while a Grok consult runs + who
  // resolved it (ai|human). Additive, DEFAULTed so older rows read not-in-flight /
  // unknown-resolver (no behavioural change).
  addColumnIfMissing(db, 'escalation', 'triageInFlight', 'triageInFlight INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'escalation', 'resolvedBy', 'resolvedBy TEXT');
  // Escalation-briefing (epic 40771aab): cached deep markdown decision briefing +
  // provenance. Additive, DEFAULT null so existing open escalations carry no briefing
  // until first opened (no behavioural change).
  addColumnIfMissing(db, 'escalation', 'briefingMd', 'briefingMd TEXT');
  addColumnIfMissing(db, 'escalation', 'briefingModel', 'briefingModel TEXT');
  addColumnIfMissing(db, 'escalation', 'briefingAt', 'briefingAt INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_esc_todo ON escalation(project, todoId, status)');
  // Steward role model (design §2): relax the supervisor_identity singleton
  // (id=1 CHECK) to PRIMARY KEY(role). Additive rebuild that backfills the
  // existing row to role='supervisor', so every current caller is untouched.
  migrateSupervisorIdentityToRole(db);
  return db;
}

/** One-time rebuild of the legacy `id=1 CHECK` supervisor_identity singleton into
 *  the role-keyed table (PRIMARY KEY(role)), backfilling the existing row to
 *  role='supervisor'. Idempotent: a no-op once the table is already role-keyed.
 *  Wrapped in a transaction so a partial rebuild can never leave a half-migrated
 *  identity that would fence the live supervisor (top risk #1). */
function migrateSupervisorIdentityToRole(d: Database): void {
  const cols = d.query('PRAGMA table_info(supervisor_identity)').all() as Array<{ name: string }>;
  const hasLegacyId = cols.some((c) => c.name === 'id');
  if (!hasLegacyId) return; // already role-keyed (fresh DB or prior migration)
  d.transaction(() => {
    d.exec(`CREATE TABLE supervisor_identity_new (
      role TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      session TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      serverId TEXT NOT NULL DEFAULT '',
      epoch INTEGER NOT NULL DEFAULT 0
    )`);
    d.exec(`INSERT INTO supervisor_identity_new (role, project, session, updatedAt, serverId, epoch)
      SELECT 'supervisor', project, session, updatedAt, COALESCE(serverId, ''), COALESCE(epoch, 0)
      FROM supervisor_identity WHERE id = 1`);
    d.exec('DROP TABLE supervisor_identity');
    d.exec('ALTER TABLE supervisor_identity_new RENAME TO supervisor_identity');
  })();
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

export function removeWatchedProject(project: string): boolean {
  const d = openDb();
  const res = d.prepare('DELETE FROM watched_project WHERE project = ?').run(project);
  return (res?.changes ?? 0) > 0;
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

/** Updates the watched_project row if the project is watched; a no-op otherwise. */
export function setWatchdogThreshold(project: string, percent: number | null): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET watchdogThresholdPercent = ? WHERE project = ?')
    .run(percent, project);
}

/** Per-project context-auto-recycle mode. Absent/unknown → 'off' (inert default). */
export function getContextRecycleMode(project: string): ContextRecycleMode {
  const d = openDb();
  const row = d.query('SELECT contextRecycleMode FROM watched_project WHERE project = ?')
    .get(project) as { contextRecycleMode: string | null } | undefined;
  const m = row?.contextRecycleMode;
  return m === 'notify' || m === 'force' ? m : 'off';
}

/** Updates the watched_project row if the project is watched; a no-op otherwise. */
export function setContextRecycleMode(project: string, mode: ContextRecycleMode): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET contextRecycleMode = ? WHERE project = ?')
    .run(mode, project);
}

/** Per-project project-digest injection flag. Default ON (mission-forge wiring): unset/NULL
 *  reads true — the payload is self-gating (no .collab/project-digest.md ⇒ zero bytes emitted),
 *  so the default only activates once a digest producer (e.g. /mission-forge) writes one.
 *  An explicit 0 (human toggled off) is honored. */
export function getProjectDigestEnabled(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT projectDigestEnabled FROM watched_project WHERE project = ?')
    .get(project) as { projectDigestEnabled: number | null } | undefined;
  return row?.projectDigestEnabled == null ? true : !!row.projectDigestEnabled;
}
export function setProjectDigestEnabled(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET projectDigestEnabled = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

/** Per-project retry-context injection flag. Default ON (6d67a801 lesson): unset/NULL reads
 *  true — payload B is self-gating (emits ONLY on attempt ≥2 with a real prior failure,
 *  ~500-token cap), and an attempt-2 node blind to why attempt 1 failed walks into the same
 *  traps at full price. An explicit 0 (human toggled off) is honored. */
export function getPromptInjectRetryContext(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT promptInjectRetryContext FROM watched_project WHERE project = ?')
    .get(project) as { promptInjectRetryContext: number | null } | undefined;
  return row?.promptInjectRetryContext == null ? true : !!row.promptInjectRetryContext;
}
export function setPromptInjectRetryContext(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET promptInjectRetryContext = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

/** Per-project active-constraints injection flag. Default ON (mission-forge wiring): unset/NULL
 *  reads true — the payload is self-gating (no ACTIVE constraint records ⇒ zero bytes emitted),
 *  so a mission's locked constraints reach the build nodes without a per-project toggle dance.
 *  An explicit 0 (human toggled off) is honored. */
export function getPromptInjectActiveConstraints(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT promptInjectActiveConstraints FROM watched_project WHERE project = ?')
    .get(project) as { promptInjectActiveConstraints: number | null } | undefined;
  return row?.promptInjectActiveConstraints == null ? true : !!row.promptInjectActiveConstraints;
}
export function setPromptInjectActiveConstraints(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET promptInjectActiveConstraints = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

/** Per-project gate SHADOW-MODE flag (default OFF). When on, a candidate gate runs
 *  advisory-only alongside the live gate (the sibling leaf reads this for the shadow guard). */
export function getGateShadowMode(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT gateShadowMode FROM watched_project WHERE project = ?')
    .get(project) as { gateShadowMode: number | null } | undefined;
  return !!row?.gateShadowMode;
}
export function setGateShadowMode(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET gateShadowMode = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

// Phase-2b mission-loop driving is no longer a per-project mode. It's governed by
// two things that already exist and already mean something: the project being WATCHED
// (the orchestrator only runs the pass for watched projects) and the mission being
// ACTIVE (one active mission per session). The old off|assist|auto tri-state — with
// 'auto' never implemented — was removed in favor of that. Unattended autonomy, when
// built, will be a single global stance, not a per-project setting. The dormant
// `missionLoopMode` column is left in the table (harmless) for back-compat.

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
type EscalationRow = Omit<Escalation, 'options' | 'ui' | 'suggestedAction'> & { optionsJson: string | null; uiJson: string | null; suggestedActionJson: string | null };

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

/** Parse a stored suggestedAction blob, tolerating null/garbage. Validates the
 *  minimal shape (bucket + verb domain) so a corrupt row degrades to null rather
 *  than surfacing a malformed card. */
function parseSuggestedAction(json: string | null): SuggestedAction | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== 'object') return null;
    const buckets = ['stale', 'verified-done', 'now-buildable', 'genuine-decision', 'needs-design'];
    if (!buckets.includes(p.bucket)) return null;
    const verb = p.verb === 'reset_todo' || p.verb === 'override_accept_todo' ? p.verb : null;
    return {
      bucket: p.bucket,
      verb,
      args: p.args && typeof p.args === 'object' ? p.args : null,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0,
      rationale: typeof p.rationale === 'string' ? p.rationale : '',
      bundleInputs: p.bundleInputs && typeof p.bundleInputs === 'object' ? p.bundleInputs : {},
      generatedAt: typeof p.generatedAt === 'number' ? p.generatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Map a raw DB row to the public Escalation shape (optionsJson → options[]). */
function mapEscalationRow(row: EscalationRow): Escalation {
  const { optionsJson, uiJson, suggestedActionJson, triageInFlight, ...rest } = row;
  return {
    ...rest,
    options: parseOptions(optionsJson),
    recommended: row.recommended ?? null,
    ui: parseUi(uiJson),
    suggestedAction: parseSuggestedAction(suggestedActionJson),
    // Stored 0/1; surface as a boolean. Coerce defensively (older rows / null).
    triageInFlight: !!triageInFlight,
    resolvedBy: row.resolvedBy ?? null,
  };
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
/**
 * Whether the steward auto-routing/acting path is enabled. Default OFF
 * (constraint 020b7ab1). While OFF, the role/routing machinery is INERT — every
 * escalation routes to the human exactly as before — so the Phase-1 migration can
 * never silently fence the live supervisor by diverting its escalations. Enable
 * with MERMAID_STEWARD_AUTO=1 (or =true) once the proof gate (Phase 2) is in.
 */
export function stewardAutoEnabled(): boolean {
  const v = process.env.MERMAID_STEWARD_AUTO;
  return v === '1' || v === 'true';
}

/**
 * Pure, deterministic create-time routing (design §3) — by KIND, not prose.
 * While steward-auto is OFF, EVERYTHING routes to the human. While ON, the hard
 * server floors stay human: an operator-gated (irreversible/outward) escalation,
 * an `approval` (human sign-off), a `decision` (genuine product A/B), and an
 * `assumption-invalidated` (re-planning is the Planner's). `blocker`, `question`,
 * and `needs-design` (mechanical re-park only) route to the steward. Unknown
 * kinds fail SAFE to the human.
 */
export function routeOf(kind: string, operatorGated: boolean): EscalationRoute {
  if (!isStewardArmed()) return 'human';
  if (operatorGated) return 'human';
  switch (kind) {
    case 'blocker':
    case 'question':
    case 'needs-design':
      return 'steward';
    case 'approval':
    case 'decision':
    case 'assumption-invalidated':
    case 'operator-gated':
      return 'human';
    default:
      return 'human';
  }
}

/**
 * P3 (readiness ergonomics): which escalation kinds should auto-attach a durable
 * human [GATE] to their linked work-todo (via todo-store createGate) INSTEAD of
 * the steward's manual re-park to 'planned'. A `needs-design` escalation
 * (mechanical re-park — "land a design / run vibe-blueprint") and ANY
 * operator-gated escalation (irreversible/outward — "provision env", a human must
 * clear it) become a self-clearing gate that surfaces in the human inbox and
 * auto-promotes the work-todo when the human completes it. Pure + deterministic so
 * the wiring (escalation_create) stays a thin, testable call.
 */
export function shouldAutoGate(kind: string, operatorGated: boolean): boolean {
  return operatorGated || kind === 'needs-design' || kind === 'operator-gated';
}

/** Pause scope for the steward role (design §4): a single sentinel scope in the
 *  shared supervisor_pause table, parallel to GLOBAL_PAUSE_SCOPE.
 *  @deprecated Use setSupervisorPause(GLOBAL_PAUSE_SCOPE, paused) instead; this scope is retained as vocabulary only. */
export const STEWARD_PAUSE_SCOPE = '__steward__';

/** Pause / resume the steward's auto-routing+acting. While paused the router
 *  forwards nothing (all→human) and the steward parks — the standin's
 *  "I've got it from here."
 *  @deprecated Use setSupervisorPause(GLOBAL_PAUSE_SCOPE, paused) instead — unified brake. */
export function setStewardPause(paused: boolean): void {
  setSupervisorPause(GLOBAL_PAUSE_SCOPE, paused);
}

/** Pause / resume the steward's auto-routing+acting. While paused the router
 *  forwards nothing (all→human) and the steward parks — the standin's
 *  "I've got it from here."
 *  @deprecated Use isSupervisorPaused() instead — unified brake. */
export function isStewardPaused(): boolean {
  return isSupervisorPaused();
}

/** Runtime ON/OFF switch for the steward's ESCALATION AUTO-ANSWER (the live human
 *  off-switch — distinct from MERMAID_STEWARD_AUTO, the build-time env arm, and from
 *  the transient steward_pause "I've got it"). PERSISTENT: survives a poll/restart,
 *  stored as a sentinel scope in the shared supervisor_pause table. Default ON
 *  (absent = enabled) so an env-armed steward auto-answers unless a human flips it
 *  off. The gate is NARROW (feedback_steward_dogfood_always_on): while OFF, the
 *  server routes every escalation to the human and the steward skill skips
 *  auto-answering them — but the steward's dogfood/friction-detection loop keeps
 *  running unconditionally. This switch never gates dogfooding. */
export const STEWARD_DISABLED_SCOPE = '__steward_disabled__';
export const STEWARD_ARMED_SCOPE = '__steward_armed__';

function hasSentinel(scope: string): boolean {
  const d = openDb();
  return !!d.query('SELECT 1 FROM supervisor_pause WHERE scope = ? LIMIT 1').get(scope);
}

/**
 * The single ARM gate for steward routing — folded into the one UI switch.
 *  - explicit OFF (disabled sentinel) → disarmed;
 *  - explicit ON (armed sentinel) → armed;
 *  - no explicit choice yet → fall back to the MERMAID_STEWARD_AUTO env default.
 * When disarmed, every escalation fails open to the human. The env var is now
 * only the initial default; the switch (setStewardMode) persists the real state.
 */
export function isStewardArmed(): boolean {
  if (hasSentinel(STEWARD_DISABLED_SCOPE)) return false;
  if (hasSentinel(STEWARD_ARMED_SCOPE)) return true;
  return stewardAutoEnabled();
}

/** Back-compat alias: "enabled" == armed (drives the identity `switchedOn`). */
export function isStewardEnabled(): boolean {
  return isStewardArmed();
}

/** Runtime ON/OFF switch for the steward's escalation auto-answer (the A3 kill-switch).
 *  Sets the persistent arm sentinels directly so the choice survives restart
 *  and overrides the MERMAID_STEWARD_AUTO env default. */
export function setStewardEnabled(enabled: boolean): void {
  setSupervisorPause(STEWARD_DISABLED_SCOPE, !enabled);
  setSupervisorPause(STEWARD_ARMED_SCOPE, enabled);
}

/** True iff a steward is registered AND its heartbeat is fresh (not stale/dead).
 *  Drives fail-open-to-human: a dead steward must not silently swallow escalations. */
export function isStewardLive(now: number = Date.now()): boolean {
  const id = getSupervisorIdentity('steward');
  return id != null && now - id.updatedAt < SUPERVISOR_STALE_AFTER_MS;
}

/**
 * Create-time routing — Phase 1 (decision f0ec0b06): the ex-Steward triage now
 * runs in the Orchestrator daemon (Grok), not a session. Until Phase 2 wires it,
 * EVERY escalation goes to the human unconditionally.
 *
 * routeOf / isStewardArmed / isStewardPaused / isStewardLive / verbs / proof-gate
 * are all retained DORMANT below — they are reused unchanged in Phase 2.
 */
export function routeEscalation(_kind: string, _operatorGated: boolean, _now: number = Date.now()): EscalationRoute {
  return 'human';
}

/** Sentinel session for the single fail-open summary escalation (keeps it deduped). */
export const STEWARD_FAILOPEN_SESSION = '__steward_failopen__';

/**
 * Fail-open-to-human (design §4/§5): when a steward IS registered but its
 * heartbeat is stale/dead, surface EXACTLY ONE human escalation summarising the
 * backlog ("steward dead, N queued") — never spawn a replacement LLM. Deduped via
 * the sentinel session, so repeated scans don't pile up. Returns the state so the
 * watchdog/UI can flip the StewardPanel to "crashed". A no-op when the steward is
 * disabled, unregistered, or live.
 */
export function stewardFailOpenScan(now: number = Date.now()): { stale: boolean; queued: number; escalationId: string | null } {
  if (!isStewardArmed()) return { stale: false, queued: 0, escalationId: null };
  const id = getSupervisorIdentity('steward');
  if (!id || isStewardLive(now)) return { stale: false, queued: 0, escalationId: null };
  const d = openDb();
  const queued = (d.query("SELECT COUNT(*) AS n FROM escalation WHERE status = 'open' AND routedTo = 'steward'").get() as { n: number }).n;
  // Single summary escalation — reuse the open one if it already exists.
  const existing = d
    .query("SELECT id FROM escalation WHERE session = ? AND status = 'open' LIMIT 1")
    .get(STEWARD_FAILOPEN_SESSION) as { id: string } | null;
  if (existing) return { stale: true, queued, escalationId: existing.id };
  // operatorGated forces the human floor regardless of kind/liveness routing.
  const { escalation } = createEscalation({
    project: id.project,
    session: STEWARD_FAILOPEN_SESSION,
    kind: 'operator-gated',
    questionText: `Steward offline (heartbeat stale) — ${queued} steward-routed escalation(s) now need a human. Re-register a steward or triage them directly.`,
    operatorGated: true,
  });
  return { stale: true, queued, escalationId: escalation.id };
}

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
  /** Marks an irreversible/outward action gate → always routes to the human. */
  operatorGated?: boolean;
}): { escalation: Escalation; isNew: boolean } {
  const d = openDb();
  // Normalize the worktree cwd → tracking repo root. Under worker isolation a
  // worker's cwd is a worktree at <repo>/.collab/agent-sessions/worktrees/<lane>;
  // storing that raw path orphans the escalation from the repo-root inbox (the
  // human never sees it, the card stays yellow, await_human_decision times out).
  // Mirrors the todo-store fix. Same-repo (non-isolated) callers pass the root
  // already, so trackingProjectRoot is an identity no-op for them.
  const project = trackingProjectRoot(input.project);
  const existing = d
    .query("SELECT * FROM escalation WHERE project = ? AND session = ? AND questionText = ? AND status = 'open'")
    .get(project, input.session, input.questionText) as EscalationRow | null;
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
  // Deterministic server-side routing at create-time (design §3) WITH the
  // pause/liveness fail-open overlay (§4/§5): a paused or stale/dead steward
  // routes everything to the human.
  const operatorGated = input.operatorGated ? 1 : 0;
  const routedTo = routeEscalation(input.kind, operatorGated === 1);
  d.prepare(
    'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId, todoId, optionsJson, recommended, uiJson, routedTo, operatorGated, proof, stewardAttempts, suggestedActionJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, project, input.session, input.kind, input.questionText, 'open', createdAt, null, serverId, todoId, optionsJson, recommended, uiJson, routedTo, operatorGated, null, 0, null);
  return {
    escalation: {
      id,
      project,
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
      routedTo,
      operatorGated,
      proof: null,
      stewardAttempts: 0,
      suggestedAction: null,
      triageInFlight: false,
      resolvedBy: null,
      briefingMd: null,
      briefingModel: null,
      briefingAt: null,
    },
    isNew: true,
  };
}

/**
 * Orch P2: attach (or clear, with null) a Grok-suggested inline action on an open
 * escalation. Idempotent overwrite — the triage pass writes the latest suggestion;
 * confirm/dismiss clears it (null). Stored as JSON in suggestedActionJson.
 */
export function setEscalationSuggestion(id: string, suggestion: SuggestedAction | null): void {
  const d = openDb();
  d.prepare('UPDATE escalation SET suggestedActionJson = ? WHERE id = ?').run(
    suggestion ? JSON.stringify(suggestion) : null,
    id,
  );
}

/** Triage lifecycle (fd934fb7): flip the in-flight flag while a Grok triage consult
 *  runs for this escalation. The caller broadcasts the updated escalation so the
 *  card shows / clears the "Grok is triaging…" spinner live. */
export function setEscalationTriageInFlight(id: string, inFlight: boolean): void {
  const d = openDb();
  d.prepare('UPDATE escalation SET triageInFlight = ? WHERE id = ?').run(inFlight ? 1 : 0, id);
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

export function resolveEscalation(id: string, status: string, resolvedBy?: 'ai' | 'human'): void {
  const d = openDb();
  // Stamp who resolved it (fd934fb7) so the UI can show an AI-resolved outcome
  // briefly instead of letting it silently vanish. Also clear any in-flight flag.
  d.prepare('UPDATE escalation SET status = ?, resolvedAt = ?, resolvedBy = COALESCE(?, resolvedBy), triageInFlight = 0 WHERE id = ?').run(
    status,
    Date.now(),
    resolvedBy ?? null,
    id
  );
}

/**
 * Reopen a previously-resolved escalation — the server reconcile for the
 * optimistic-clear UNDO when the undo lands after the 5s clear already committed.
 * Restores status='open' and clears resolvedAt/resolvedBy so the card re-surfaces
 * in the triage stack exactly as before. Idempotent and SAFE: only a currently
 * non-open row is reopened (a row a human/steward already re-decided is left
 * alone — guarded by `status != 'open'`), so a stale undo can't clobber a fresh
 * resolution. Returns the updated escalation (mapped) for broadcast, or null when
 * id is unknown or the row was already open (nothing to undo).
 */
export function reopenEscalation(id: string): Escalation | null {
  const d = openDb();
  const info = d
    .prepare("UPDATE escalation SET status = 'open', resolvedAt = NULL, resolvedBy = NULL WHERE id = ? AND status != 'open'")
    .run(id);
  if (info.changes === 0) return null;
  return getEscalation(id);
}

/**
 * Re-route an open escalation (the steward proof gate flips routedTo='human' when
 * an auto-act lacks valid proof — design §3 "No-proof → flip routedTo='human'").
 * Records the proof string that was cited (for the loud audit panel) when given.
 */
export function setEscalationRoute(id: string, routedTo: string, proof?: string | null): void {
  const d = openDb();
  if (proof !== undefined) {
    d.prepare('UPDATE escalation SET routedTo = ?, proof = ? WHERE id = ?').run(routedTo, proof, id);
  } else {
    d.prepare('UPDATE escalation SET routedTo = ? WHERE id = ?').run(routedTo, id);
  }
}

/**
 * Operator-gate ('only you') an escalation — the human marking it as theirs alone.
 * Sets/clears the operatorGated column. When SETTING it, force routedTo='human'
 * (the irreversible/outward floor — operator-gated never routes to the steward),
 * matching routeOf()'s create-time invariant. Clearing leaves routedTo untouched
 * (a later re-route is the steward proof gate's job, not an un-mark's). Idempotent;
 * returns the updated escalation (mapped) for broadcast, or null if id is unknown.
 */
export function setEscalationOperatorGated(id: string, operatorGated: boolean): Escalation | null {
  const d = openDb();
  if (operatorGated) {
    d.prepare("UPDATE escalation SET operatorGated = 1, routedTo = 'human' WHERE id = ?").run(id);
  } else {
    d.prepare('UPDATE escalation SET operatorGated = 0 WHERE id = ?').run(id);
  }
  return getEscalation(id);
}

/**
 * Thrash guard (design §7 rail 5): bump an escalation's stewardAttempts and return
 * the new count. The handler escalates as systemic once it exceeds a cap K so the
 * steward can't loop forever on an un-actionable escalation.
 */
export function incrementStewardAttempts(id: string): number {
  const d = openDb();
  d.prepare('UPDATE escalation SET stewardAttempts = COALESCE(stewardAttempts, 0) + 1 WHERE id = ?').run(id);
  const row = d.query('SELECT stewardAttempts FROM escalation WHERE id = ?').get(id) as { stewardAttempts: number } | null;
  return row?.stewardAttempts ?? 0;
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

/** Cache a generated briefing markdown on an escalation (+ provenance). Idempotent
 *  overwrite — a refresh replaces the prior briefing. No-op if the escalation is gone. */
export function setEscalationBriefing(id: string, md: string, model: string, at: number = Date.now()): void {
  openDb().prepare(
    'UPDATE escalation SET briefingMd = ?, briefingModel = ?, briefingAt = ? WHERE id = ?',
  ).run(md, model, at, id);
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
    /** Which role's fence rejected the caller ('supervisor' | 'steward'). */
    readonly role: string = 'supervisor',
  ) {
    super(
      `superseded: caller epoch ${callerEpoch ?? '(none)'} is not the current ${role} epoch ` +
        `${currentEpoch ?? `(no ${role} registered)`}`,
    );
    this.name = 'SupersededError';
  }
}

/**
 * Register which collab session IS the supervisor (singleton, id=1) and bump the
 * ownership epoch. Returns the NEW epoch — the caller must carry it on subsequent
 * mutating supervisor calls so the server can fence a superseded predecessor.
 */
export function setSupervisorIdentity(project: string, session: string, serverId = '', role = 'supervisor'): number {
  const d = openDb();
  const prev = d.query('SELECT epoch FROM supervisor_identity WHERE role = ?').get(role) as { epoch: number } | null;
  const epoch = (prev?.epoch ?? 0) + 1;
  d.prepare(
    'INSERT OR REPLACE INTO supervisor_identity (role, project, session, updatedAt, serverId, epoch) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(role, project, session, Date.now(), serverId, epoch);
  return epoch;
}

/**
 * Server-enforced single-writer fence (PCS invariant b9c4c5d applied to the
 * supervisor role). Throws SupersededError — performing NO write — when `epoch`
 * is not the current ownership epoch. A caller that omits its epoch is treated as
 * superseded too (it cannot prove ownership). This is the authoritative fence;
 * the supervisor skill self-exiting on `superseded` is only the politeness layer.
 */
export function assertSupervisorOwner(epoch: number | undefined, role = 'supervisor'): void {
  const id = getSupervisorIdentity(role);
  if (id == null || epoch == null || epoch !== id.epoch) {
    throw new SupersededError(epoch, id?.epoch ?? null, id?.session ?? null, role);
  }
}

/**
 * Heartbeat: refresh ONLY supervisor_identity.updatedAt to "now". No-op if no
 * supervisor is registered (id=1 row absent). Returns true if a row was
 * touched. This is what lets the UI distinguish a live supervisor from a
 * crashed/stale one — setSupervisorIdentity writes updatedAt once; this keeps
 * it advancing while the supervisor is alive.
 */
export function touchSupervisorIdentity(epoch?: number, role = 'supervisor'): boolean {
  const d = openDb();
  // Fenced touch: when an epoch is supplied, only the current owner may advance
  // liveness — a superseded supervisor cannot resurrect ownership by heartbeating.
  // Omitting the epoch is the server's own best-effort heartbeat (it keeps whoever
  // currently owns the row alive, which is always correct). Per-role fence.
  if (epoch != null) {
    const info = d.prepare('UPDATE supervisor_identity SET updatedAt = ? WHERE role = ? AND epoch = ?').run(Date.now(), role, epoch);
    return info.changes > 0;
  }
  const info = d.prepare('UPDATE supervisor_identity SET updatedAt = ? WHERE role = ?').run(Date.now(), role);
  return info.changes > 0;
}

/** Heartbeat cadence (ms) the server refreshes supervisor liveness at. */
export const SUPERVISOR_HEARTBEAT_INTERVAL_MS = 30_000;
/** A supervisor is considered stale once updatedAt is older than this (2x heartbeat). */
export const SUPERVISOR_STALE_AFTER_MS = SUPERVISOR_HEARTBEAT_INTERVAL_MS * 2;

/**
 * Stop-and-forget a role: delete its supervisor_identity row so liveness reports
 * the role as not-running immediately (the Bridge role switch reads this to flip
 * to OFF without waiting out the stale grace). The caller is responsible for
 * killing the role's tmux session; this only clears the durable identity.
 */
export function clearSupervisorIdentity(role = 'supervisor'): void {
  const d = openDb();
  d.prepare('DELETE FROM supervisor_identity WHERE role = ?').run(role);
}

export function getSupervisorIdentity(role = 'supervisor'): SupervisorIdentity | null {
  const d = openDb();
  const row = d.query('SELECT project, session, updatedAt, serverId, epoch FROM supervisor_identity WHERE role = ?').get(role) as
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

// No `token` field by design (P1 §2): a bearer token is structurally
// unrepresentable on a peer, so it can never be broadcast on the wire. Direct
// server-to-server calls go tokenless and degrade to desktop-brokered routing
// (invokeOnServer) when a peer enforces auth.
export interface PeerInfo { serverId: string; baseUrl: string }
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
