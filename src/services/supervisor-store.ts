import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { storePath } from './store-paths';
import { validateUiSpec, type JsonRenderSpec } from './escalation-ui-schema';
import { trackingProjectRoot, isTransientProjectPath } from './project-registry';

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
  /** Per-project TYPED-CONTRACT gating flag (default OFF). When on AND a valid typed
   *  DiffContract is present, the blueprint citability gate becomes advisory and the
   *  review node grounds per-requirement-id via diffContractReview. */
  typedContractGating?: number | null;
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


export interface WatchedSession {
  project: string;
  session: string;
  addedAt: number;
  serverId: string;
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
  /** LEGACY/READ-ONLY: historical steward-routing destination. No create/update path
   *  writes this anymore — `audience` is the sole visibility decision. Present only
   *  when `mapEscalationRow` surfaces it off an old row. */
  routedTo?: string;
  /** 1 when this escalation gates an irreversible/outward action — a hard server
   *  floor that always routes to the human, never the steward. */
  operatorGated: number;
  /** Human-vs-machine audience for the escalation UI, derived from kind/operatorGated at
   *  create-time: 'human' for human-actionable escalations, 'internal' for machine-hygiene. */
  audience: 'human' | 'internal';
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
  /** Durable condition identity (this leaf): `${kind}:${subject[0]}`, greppable and
   *  stable under tuple growth. Null for callers that don't pass a condition tuple. */
  conditionKey: string | null;
  /** sha256 (truncated) over the full sorted condition tuple — detects tuple *content*
   *  changes while being insensitive to element order. Null when conditionKey is null. */
  conditionHash: string | null;
  /** Wall-clock of the most recent raise of this condition (create or recurrence-update).
   *  Null for rows predating this migration or unkeyed escalations. */
  lastSeenAt: number | null;
  /** How many times this condition has recurred while open/acknowledged. Defaults 0. */
  recurrenceCount: number;
  /** Trailing prose note attached to a resolved escalation, preserving context from
   *  prose-status legacy rows or explicit caller notes. Null while open or before resolution. */
  resolutionNote: string | null;
  /** The deadline this card PROMISED on its face (createdAt + the caller's timeoutMs).
   *  The reconcile stale sweep MUST NOT touch a card whose expiresAt is in the future —
   *  a card that prints "Timeout: 10 minutes" lives at least 10 minutes. Operator-gated or
   *  human-audience cards with no explicit timeout are stamped with OPERATOR_CARD_MIN_TTL_MS
   *  (6 hours) to ensure visibility. Null for non-operator, non-human-audience cards that
   *  promise no timeout (they keep the legacy stale-window heuristic). */
  expiresAt: number | null;
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
  gateShadowMode INTEGER,
  typedContractGating INTEGER
);
CREATE TABLE IF NOT EXISTS watched_session (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
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
  briefingAt INTEGER,
  audience TEXT DEFAULT 'human',
  expiresAt INTEGER
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
  // Canonical path from the store registry (global scope, so no project argument).
  // MERMAID_SUPERVISOR_DIR still isolates the global supervisor.db for tests —
  // store-paths.globalStoreDir() honours it.
  const path = storePath('supervisor');
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // One-shot migration: if supervised_session exists, migrate rows to watched_session.
  const supervisedExists = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='supervised_session'"
  ).get();
  if (supervisedExists) {
    db.exec(
      'INSERT OR IGNORE INTO watched_session (project, session, addedAt, serverId) ' +
      'SELECT project, session, addedAt, serverId FROM supervised_session'
    );
    db.exec('DROP TABLE supervised_session');
  }
  // Idempotent migrations for existing DBs.
  addColumnIfMissing(db, 'escalation', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'supervisor_identity', 'serverId', "serverId TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'supervisor_identity', 'epoch', 'epoch INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'watched_project', 'watchdogThresholdPercent', 'watchdogThresholdPercent INTEGER');
  addColumnIfMissing(db, 'watched_project', 'contextRecycleMode', 'contextRecycleMode TEXT');
  addColumnIfMissing(db, 'watched_project', 'missionLoopMode', 'missionLoopMode TEXT');
  addColumnIfMissing(db, 'watched_project', 'projectDigestEnabled', 'projectDigestEnabled INTEGER');
  addColumnIfMissing(db, 'watched_project', 'conductorEnabled', 'conductorEnabled INTEGER');
  addColumnIfMissing(db, 'watched_project', 'intakeEnabled', 'intakeEnabled INTEGER');
  addColumnIfMissing(db, 'watched_project', 'lastConductorPassMissionId', 'lastConductorPassMissionId TEXT');
  addColumnIfMissing(db, 'watched_project', 'lastConductorPassJson', 'lastConductorPassJson TEXT');
  addColumnIfMissing(db, 'watched_project', 'promptInjectRetryContext', 'promptInjectRetryContext INTEGER');
  addColumnIfMissing(db, 'watched_project', 'promptInjectActiveConstraints', 'promptInjectActiveConstraints INTEGER');
  addColumnIfMissing(db, 'watched_project', 'gateShadowMode', 'gateShadowMode INTEGER');
  addColumnIfMissing(db, 'watched_project', 'typedContractGating', 'typedContractGating INTEGER');
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
  addColumnIfMissing(db, 'escalation', 'audience', "audience TEXT");
  // One-shot backfill: derive audience for existing rows where the column was just added
  // (new rows already get DEFAULT 'human'; only pre-migration rows need derivation).
  db.exec(`UPDATE escalation SET audience = 'human' WHERE audience IS NULL AND (operatorGated = 1 OR kind NOT IN ('epic-sweep-triage','infra-park','leaf-infra-rejected','split-proposal','base-moved'))`);
  db.exec(`UPDATE escalation SET audience = 'internal' WHERE audience IS NULL`);
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
  addColumnIfMissing(db, 'escalation', 'conditionKey', 'conditionKey TEXT');
  addColumnIfMissing(db, 'escalation', 'conditionHash', 'conditionHash TEXT');
  addColumnIfMissing(db, 'escalation', 'lastSeenAt', 'lastSeenAt INTEGER');
  addColumnIfMissing(db, 'escalation', 'recurrenceCount', 'recurrenceCount INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'escalation', 'resolutionNote', 'resolutionNote TEXT');
  // Timeout honesty (feat-card-timeout-honesty): the deadline the card printed.
  // Additive, DEFAULT null so existing rows keep the legacy stale-window sweep.
  addColumnIfMissing(db, 'escalation', 'expiresAt', 'expiresAt INTEGER');
  // One-shot backfill: migrate legacy prose-status rows to canonical status + resolutionNote.
  // Guard with `WHERE resolutionNote IS NULL` so a second run (already backfilled) touches 0 rows.
  // This query handles both `:` and ` - ` delimiters commonly found in prose status strings.
  const unmigratedRows = db.query(
    "SELECT id, status FROM escalation WHERE resolutionNote IS NULL AND status NOT IN ('open','acknowledged','resolved','stale','decided','superseded','obsolete','linear') AND (status LIKE '%:%' OR status LIKE '% - %')"
  ).all() as Array<{ id: string; status: string }>;
  for (const row of unmigratedRows) {
    const status = row.status as string;
    let colonIdx = status.indexOf(':');
    let dashIdx = status.indexOf(' - ');
    let canonical = '';
    let note = '';
    if (colonIdx > 0 && (dashIdx < 0 || colonIdx < dashIdx)) {
      canonical = status.slice(0, colonIdx).trim();
      note = status.slice(colonIdx + 1).trim();
    } else if (dashIdx > 0) {
      canonical = status.slice(0, dashIdx).trim();
      note = status.slice(dashIdx + 3).trim();
    } else {
      canonical = 'resolved';
      note = status;
    }
    const isValidCanonical = ['open','acknowledged','resolved','stale','decided','superseded','obsolete','linear'].includes(canonical);
    const finalCanonical = isValidCanonical ? canonical : 'resolved';
    db.prepare('UPDATE escalation SET status = ?, resolutionNote = ? WHERE id = ?').run(
      finalCanonical,
      note || null,
      row.id,
    );
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_esc_todo ON escalation(project, todoId, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_esc_condition ON escalation(project, conditionKey, status)');
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

/** Per-project AUTONOMOUS CONDUCTOR toggle. Default OFF (opt-in autonomy): the conductor pass only
 *  runs for a project explicitly turned on. UPDATE-only (like the other per-project setters — never
 *  auto-watch a project); a project must be watched first. */
export function getConductorEnabled(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT conductorEnabled FROM watched_project WHERE project = ?')
    .get(project) as { conductorEnabled: number | null } | undefined;
  return !!(row?.conductorEnabled);
}
export function setConductorEnabled(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET conductorEnabled = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

/** Per-project FRICTION→FORGE INTAKE toggle. Default OFF (opt-in autonomy, mirrors conductorEnabled):
 *  the deterministic mission-intake pass only escalates friction clusters into UNAPPROVED forged
 *  missions for a project explicitly turned on. UPDATE-only (like the other per-project setters —
 *  never auto-watch a project); a project must be watched first. */
export function getIntakeEnabled(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT intakeEnabled FROM watched_project WHERE project = ?')
    .get(project) as { intakeEnabled: number | null } | undefined;
  return !!(row?.intakeEnabled);
}
export function setIntakeEnabled(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET intakeEnabled = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

export type ConductorPassReason =
  | 'conductor-disabled' | 'daemon-off' | 'no-actionable-mission' | 'target-not-actionable'
  | 'target-cleared' | 'building-wait' | 'criteria-escalated' | 'debounced' | 'conducted' | 'node-failed'
  // The mission's only actionable criteria are dependency-blocked — quiet, not stalled: the pass
  // returns without spending a node (criterion-blocked-conductor-read).
  | 'criteria-blocked'
  | 'pass-ran' | 'pass-error' | 'infra-leaf-reset'
  // The pass DROPPED a churning epic and re-served its criterion once, smaller (825e4cdd).
  | 'redecomposed'
  // The pass STOPPED on an over-budget mission after raising its re-bet decision card
  // (conductor-pass.ts's final act). Observable, not silent — mission a6ab522b.
  | 'over-budget-rebet'
  // The pass AUTO-SPAWNED the 3-lens verify panel for a stakes-routed criterion (no human
  // verify-skill invocation). Mission 44d8b837.
  | 'verify-paneled'
  // The pass PARKED one or more carded leaves at/over the attempts threshold deterministically,
  // before invoking the node — zero node spend. Card-triage arm.
  | 'card-triaged'
  // The pass LANDED a green land-ready epic deterministically, without consulting the node.
  // Landing arm.
  | 'landed'
  // The pass STOPPED short-circuit before invoking the node: CONDUCTOR_TIMEOUT_RECUR_CAP
  // consecutive timeouts on this MISSION's unchanged serve-state (not a criterion) — a card
  // was raised naming the serve-state; the conductor will not re-invoke until it changes.
  | 'conductor-timeouts-capped'
  // The pass STOPPED short-circuit before invoking the node: CONDUCTOR_EMPTY_CONDUCT_CAP
  // consecutive EMPTY CONDUCTS on this mission's unchanged serve-state (a real node ran, exited
  // ok, and filed/carried NOTHING each time — mission 949dda42). A card was raised naming the
  // mission and what its criteria looked like; the conductor will not re-invoke on this state.
  | 'conductor-empty-conducts-capped'
  // The mission's only actionable criteria are shipped but awaiting live observation — the pass
  // returns without spending a node (nothing to serve until the observation window closes).
  | 'awaiting-observation-wait'
  // The pass STOPPED because the serve target is held on a sibling-collision condition —
  // no node spent, but not quiet: a human/holder must clear it before the conductor resumes.
  | 'held';

export interface ConductorLastPass {
  missionId: string | null;
  reason: ConductorPassReason;
  tickAt: number;
  /** Short (<=60 char) human status for this pass (what it DID), derived from reason + counts and
   *  set at the end of each pass, so the Bridge readout shows WHY, not just when. Persisted in the
   *  same JSON blob — no schema change. */
  status?: string;
  /** Consecutive conductor-node timeouts in a row on the same unchanged serve-state. */
  timeoutKills?: number;
}

/** Per-project OBSERVABLE outcome of the last runConductorPass tick — which mission (if any) it
 *  actually drove, the reason code, and when. This is the pass's OUTPUT, so a live observer can confirm 'drove exactly that
 *  mission' directly instead of inferring it from unchanged debounce timestamps. UPDATE-only
 *  (like the other per-project setters — never auto-watch a project). */
export function getConductorLastPass(project: string): ConductorLastPass | null {
  const d = openDb();
  const row = d.query('SELECT lastConductorPassJson FROM watched_project WHERE project = ?')
    .get(project) as { lastConductorPassJson: string | null } | undefined;
  if (!row?.lastConductorPassJson) return null;
  try {
    return JSON.parse(row.lastConductorPassJson) as ConductorLastPass;
  } catch {
    return null;
  }
}
export function setConductorLastPass(project: string, pass: ConductorLastPass): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET lastConductorPassMissionId = ?, lastConductorPassJson = ? WHERE project = ?')
    .run(pass.missionId, JSON.stringify(pass), project);
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

/** Per-project TYPED-CONTRACT gating flag (default OFF). When on AND a valid typed
 *  DiffContract is present for a leaf, the blueprint citability gate becomes advisory
 *  (record-only, no park) and the review node grounds per-requirement-id via
 *  diffContractReview instead of the prose grounding gate. Unset/NULL reads false, so a
 *  project that never turned it on behaves byte-identically to before. UPDATE-only (like the
 *  other per-project setters — never auto-watch a project). */
export function getTypedContractGating(project: string): boolean {
  const d = openDb();
  const row = d.query('SELECT typedContractGating FROM watched_project WHERE project = ?')
    .get(project) as { typedContractGating: number | null } | undefined;
  return !!row?.typedContractGating;
}
export function setTypedContractGating(project: string, on: boolean): void {
  const d = openDb();
  d.prepare('UPDATE watched_project SET typedContractGating = ? WHERE project = ?')
    .run(on ? 1 : 0, project);
}

// Phase-2b mission-loop driving is no longer a per-project mode. It's governed by
// two things that already exist and already mean something: the project being WATCHED
// (the orchestrator only runs the pass for watched projects) and the mission being
// ACTIVE (one active mission per session). The old off|assist|auto tri-state — with
// 'auto' never implemented — was removed in favor of that. Unattended autonomy, when
// built, will be a single global stance, not a per-project setting. The dormant
// `missionLoopMode` column is left in the table (harmless) for back-compat.

// --- Watched sessions ---

/** Detect ephemeral coordinator-spawned worker sessions by name prefix.
 *  Mirrors ui/src/lib/liveness.ts:113 isWorkerSession — server-side twin
 *  since backend cannot import ui/ code. */
export function isWorkerSessionName(session: string): boolean {
  return (session.split(/[-_]/)[0]?.toLowerCase() ?? '') === 'worker';
}

export function addWatchedSession(
  project: string,
  session: string,
  serverId = ''
): void {
  if (isWorkerSessionName(session)) return;
  const d = openDb();
  d.prepare(
    'INSERT OR IGNORE INTO watched_session (project, session, addedAt, serverId) VALUES (?,?,?,?)'
  ).run(project, session, Date.now(), serverId);
}

export function removeWatchedSession(project: string, session: string): void {
  const d = openDb();
  d.prepare('DELETE FROM watched_session WHERE project = ? AND session = ?').run(
    project,
    session
  );
}

export function listWatchedSessions(): WatchedSession[] {
  const d = openDb();
  return d.query('SELECT * FROM watched_session ORDER BY addedAt').all() as WatchedSession[];
}

export function isWatchedSession(project: string, session: string): boolean {
  const d = openDb();
  const row = d
    .query('SELECT 1 FROM watched_session WHERE project = ? AND session = ?')
    .get(project, session);
  return !!row;
}


// --- Escalations ---

/** Raw DB row shape: structured options live in a JSON column (`optionsJson`),
 *  parsed into `options` by mapEscalationRow before crossing the store boundary. */
type EscalationRow = Omit<Escalation, 'options' | 'ui' | 'suggestedAction'> & { optionsJson: string | null; uiJson: string | null; suggestedActionJson: string | null; resolutionNote: string | null };

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
  const { optionsJson, uiJson, suggestedActionJson, triageInFlight, resolutionNote, ...rest } = row;
  return {
    ...rest,
    options: parseOptions(optionsJson),
    recommended: row.recommended ?? null,
    ui: parseUi(uiJson),
    suggestedAction: parseSuggestedAction(suggestedActionJson),
    // Stored 0/1; surface as a boolean. Coerce defensively (older rows / null).
    triageInFlight: !!triageInFlight,
    resolvedBy: row.resolvedBy ?? null,
    briefingMd: row.briefingMd ?? null,
    briefingModel: row.briefingModel ?? null,
    briefingAt: row.briefingAt ?? null,
    conditionKey: row.conditionKey ?? null,
    conditionHash: row.conditionHash ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
    recurrenceCount: row.recurrenceCount ?? 0,
    resolutionNote: resolutionNote ?? null,
    audience: (row.audience as 'human' | 'internal' | null) ?? 'human',
    expiresAt: row.expiresAt ?? null,
  };
}

/** Hash the FULL condition tuple, sorted (order-insensitive, content-sensitive). Shared
 *  by `conditionIdentity` and `createEscalation` so key and hash can never diverge. */
function hashTuple(subject: string[]): string {
  return createHash('sha256').update([...subject].sort().join('\0')).digest('hex').slice(0, 16);
}

/** Durable condition identity for an escalation: a greppable `key` (`${kind}:${subject[0]}`)
 *  plus a `hash` over the full sorted subject tuple. Element order in `subject` never
 *  changes the hash; tuple content does. */
export function conditionIdentity(kind: string, subject: string[]): { key: string; hash: string } {
  return { key: `${kind}:${subject[0] ?? ''}`, hash: hashTuple(subject) };
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

/**
 * Derive the human-vs-machine audience for an escalation at create-time. operatorGated
 * always wins (→ 'human'); otherwise, certain hygiene kinds default to 'internal';
 * everything else is 'human'.
 */
/**
 * Kinds that genuinely need the OPERATOR: money, or an explicit choice only a person can
 * make. Operator policy 2026-08-21, stated as "spend + explicit decisions".
 */
const HUMAN_ESCALATION_KINDS = new Set([
  'decision',
  'dep-strand-decision',
  'question',
  'human_only',
  'approve-decision',
  'repair-mission-approval',
  'mission-over-budget-rebet',
  'token-burn',
]);

/**
 * Derive the human-vs-machine audience for an escalation at create-time.
 *
 * This used to be an ALLOWLIST OF FIVE machine kinds with everything else defaulting to
 * 'human', and `operatorGated` forcing 'human' outright. Both were wrong in the same
 * direction: the operator was told "N needs you" for work that was the conductor's, and
 * operatorGated is set on 4,412 criterion-serve-cap cards, 975 parentless-leaf, 571
 * mission-stalled — none of which a person can or should action. A badge that cries wolf
 * gets ignored, and then the two cards that DO need a human get ignored with it.
 *
 * Inverted to an allowlist of human kinds. `operatorGated` still marks an irreversible or
 * outward action, but it no longer decides WHO is being asked — the conductor is the actor
 * for most gated kinds. A card carrying structured `options` is a genuine A/B choice by
 * construction, so it counts as human regardless of kind.
 *
 * Machine-audience cards are NOT hidden; they render in their own colour. Nothing
 * disappears, it just stops being counted as the operator's problem.
 */
export function deriveAudience(
  kind: string,
  operatorGated: boolean,
  opts?: { hasOptions?: boolean },
): 'human' | 'internal' {
  if (HUMAN_ESCALATION_KINDS.has(kind)) return 'human';
  if (opts?.hasOptions) return 'human';
  return 'internal';
}

/** Canonical status values for escalations. */
export const ESCALATION_STATUSES = ['open','acknowledged','resolved','stale','decided','superseded','obsolete','linear'] as const;

/** Who settled an escalation: a real decision ('ai' | 'human'), or 'timeout-default' —
 *  nobody answered and the recorded outcome is the card's printed fallthrough. Kept
 *  distinguishable so audits can query for silence-overridden calls
 *  (`resolvedBy='timeout-default'`). */
export type EscalationResolvedBy = 'ai' | 'human' | 'timeout-default';

/**
 * Normalize an escalation status to canonical form + extract trailing prose as resolutionNote.
 *
 * Returns `{ status, note }` where:
 * - If `status` is already canonical, returns it unchanged (note defaults to explicit param or null).
 * - If `status` starts with `${canonical}: ` or `${canonical} - `, splits into canonical+prose.
 * - Else falls back to `{ status: 'resolved', note: <original status string> }`.
 *
 * When explicit `note` param is passed, it is appended after any split prose (separated by ' | '),
 * so explicit notes always appear second and callers can distinguish original text from additions.
 * Never throws; always returns a canonical status + a note (or null).
 */
export function normalizeEscalationStatus(status: string, note?: string | null): { status: string; note: string | null } {
  // If already canonical, return with explicit note or null.
  if ((ESCALATION_STATUSES as unknown as string[]).includes(status)) {
    return { status, note: note ?? null };
  }
  // Try to split on ':' or ' - ' delimiter.
  let colonIdx = status.indexOf(':');
  let dashIdx = status.indexOf(' - ');
  let canonical = '';
  let splitNote = '';
  if (colonIdx > 0 && (dashIdx < 0 || colonIdx < dashIdx)) {
    canonical = status.slice(0, colonIdx).trim();
    splitNote = status.slice(colonIdx + 1).trim();
  } else if (dashIdx > 0) {
    canonical = status.slice(0, dashIdx).trim();
    splitNote = status.slice(dashIdx + 3).trim();
  }
  // Validate the extracted canonical token.
  if (canonical && (ESCALATION_STATUSES as unknown as string[]).includes(canonical)) {
    const combined = splitNote && note ? `${splitNote} | ${note}` : (splitNote || note);
    return { status: canonical, note: combined || null };
  }
  // Fallback: treat the entire input as a note and return 'resolved'.
  const fallbackNote = note ? `${status} | ${note}` : status;
  return { status: 'resolved', note: fallbackNote };
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
  /** Durable condition identity (this leaf): when present, replaces the questionText
   *  dedup with keyed lookup (open-recurrence update, resolved-suppression). */
  conditionKey?: string | null;
  /** The full subject tuple this key was derived from — hashed (sorted) so a resolved
   *  condition whose inputs are unchanged stays suppressed. A key with no tuple hashes
   *  to null, so it never matches a resolved row (always re-raises). */
  conditionTuple?: string[] | null;
  /** Required: who must act on this escalation. 'human' if a person needs to clear it,
   *  'internal' if it's daemon/conductor self-talk nothing human-facing consumes. */
  audience: 'human' | 'internal';
  /** The timeout this card PRINTS on its face. Stamps expiresAt = createdAt + timeoutMs;
   *  the reconcile stale sweep will not reap the card before that deadline. Callers that
   *  print a timeout MUST pass the SAME value here — one field, printed and enforced.
   *  Omitting timeoutMs on an operator-gated or human-audience card yields the
   *  OPERATOR_CARD_MIN_TTL_MS floor (6 hours); supplying an explicit timeoutMs is honoured
   *  exactly (never raised to the floor). */
  timeoutMs?: number | null;
}): { escalation: Escalation; isNew: boolean } {
  const d = openDb();
  // Normalize the worktree cwd → tracking repo root. Under worker isolation a
  // worker's cwd is a worktree at <repo>/.collab/agent-sessions/worktrees/<lane>;
  // storing that raw path orphans the escalation from the repo-root inbox (the
  // human never sees it, the card stays yellow, await_human_decision times out).
  // Mirrors the todo-store fix. Same-repo (non-isolated) callers pass the root
  // already, so trackingProjectRoot is an identity no-op for them.
  const project = trackingProjectRoot(input.project);
  if (isTransientProjectPath(project)) {
    throw new Error(`createEscalation: refusing transient project path ${project}`);
  }
  const conditionKey = input.conditionKey ?? null;
  const conditionHash = conditionKey != null && input.conditionTuple ? hashTuple(input.conditionTuple) : null;

  if (conditionKey != null) {
    // Keyed lookup REPLACES the questionText dedup for this call.
    const openRow = d
      .query("SELECT * FROM escalation WHERE project = ? AND conditionKey = ? AND status IN ('open','acknowledged') ORDER BY createdAt DESC LIMIT 1")
      .get(project, conditionKey) as EscalationRow | null;
    if (openRow) {
      const now = Date.now();
      // A recurrence RE-PROMISES the printed timeout from the latest raise: refresh
      // expiresAt to now + timeoutMs (a live re-raised card never expires mid-promise).
      // Callers without a timeoutMs leave the stored deadline untouched.
      const refreshedExpiresAt = input.timeoutMs != null && input.timeoutMs > 0 ? now + input.timeoutMs : null;
      d.prepare('UPDATE escalation SET lastSeenAt = ?, recurrenceCount = recurrenceCount + 1, questionText = ?, conditionHash = ?, expiresAt = COALESCE(?, expiresAt) WHERE id = ?')
        .run(now, input.questionText, conditionHash, refreshedExpiresAt, openRow.id);
      const refreshed = d.query('SELECT * FROM escalation WHERE id = ?').get(openRow.id) as EscalationRow;
      return { escalation: mapEscalationRow(refreshed), isNew: false };
    }
    const resolvedRow = d
      .query("SELECT * FROM escalation WHERE project = ? AND conditionKey = ? AND (status = 'resolved' OR status LIKE 'resolved:%' OR status LIKE 'resolved - %') ORDER BY createdAt DESC LIMIT 1")
      .get(project, conditionKey) as EscalationRow | null;
    // A null incoming hash must not equal a null stored hash — a missing hash on
    // either side means "differs", so unhashable callers always re-raise.
    if (resolvedRow && resolvedRow.conditionHash != null && conditionHash != null && resolvedRow.conditionHash === conditionHash) {
      return { escalation: mapEscalationRow(resolvedRow), isNew: false };
    }
  } else {
    const existing = d
      .query("SELECT * FROM escalation WHERE project = ? AND session = ? AND questionText = ? AND status IN ('open','acknowledged')")
      .get(project, input.session, input.questionText) as EscalationRow | null;
    if (existing) return { escalation: mapEscalationRow(existing), isNew: false };
  }

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
  const operatorGated = input.operatorGated ? 1 : 0;
  // Validate audience. The caller's choice is FINAL: operatorGated used to override it to
  // 'human', which silently re-stamped cards their author had deliberately marked
  // 'internal' and badged the conductor's own gated work (criterion-serve-cap,
  // parentless-leaf, mission-stalled) as the operator's problem. Gating marks an
  // irreversible or outward action; it says nothing about WHO is being asked.
  if (input.audience == null) {
    throw new Error(`createEscalation: audience is required`);
  }
  if (input.audience !== 'human' && input.audience !== 'internal') {
    throw new Error(`createEscalation: invalid audience "${input.audience}"`);
  }
  const audience = input.audience;
  // Timeout honesty: the deadline the card prints is the deadline the store enforces.
  // Explicit timeoutMs is honoured verbatim (no Math.max). Operator-gated or human-audience
  // cards with no explicit timeout floor to OPERATOR_CARD_MIN_TTL_MS to ensure visibility.
  // Non-operator, non-human cards with no timeout remain null (legacy heuristic-sweep behaviour).
  const expiresAt = input.timeoutMs != null && input.timeoutMs > 0
    ? createdAt + input.timeoutMs
    : operatorGated === 1 || audience === 'human'
    ? createdAt + OPERATOR_CARD_MIN_TTL_MS
    : null;
  d.prepare(
    'INSERT INTO escalation (id, project, session, kind, questionText, status, createdAt, resolvedAt, serverId, todoId, optionsJson, recommended, uiJson, operatorGated, proof, stewardAttempts, suggestedActionJson, conditionKey, conditionHash, lastSeenAt, recurrenceCount, resolutionNote, audience, expiresAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(id, project, input.session, input.kind, input.questionText, 'open', createdAt, null, serverId, todoId, optionsJson, recommended, uiJson, operatorGated, null, 0, null, conditionKey, conditionHash, createdAt, 0, null, audience, expiresAt);
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
      operatorGated,
      audience,
      proof: null,
      stewardAttempts: 0,
      suggestedAction: null,
      triageInFlight: false,
      resolvedBy: null,
      briefingMd: null,
      briefingModel: null,
      briefingAt: null,
      conditionKey,
      conditionHash,
      lastSeenAt: createdAt,
      recurrenceCount: 0,
      resolutionNote: null,
      expiresAt,
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
  const fullId = resolveFullEscalationId(id);
  const d = openDb();
  const info = d.prepare('UPDATE escalation SET suggestedActionJson = ? WHERE id = ?').run(
    suggestion ? JSON.stringify(suggestion) : null,
    fullId,
  );
  if (info.changes === 0) throw new Error(`escalation suggestion set matched no row: ${id}`);
}

/** Triage lifecycle (fd934fb7): flip the in-flight flag while a Grok triage consult
 *  runs for this escalation. The caller broadcasts the updated escalation so the
 *  card shows / clears the "Grok is triaging…" spinner live. */
export function setEscalationTriageInFlight(id: string, inFlight: boolean): void {
  const fullId = resolveFullEscalationId(id);
  const d = openDb();
  const info = d.prepare('UPDATE escalation SET triageInFlight = ? WHERE id = ?').run(inFlight ? 1 : 0, fullId);
  if (info.changes === 0) throw new Error(`escalation triage-in-flight set matched no row: ${id}`);
}

export function listEscalations(status?: string): Escalation[] {
  const d = openDb();
  const rows = status !== undefined
    ? d.query("SELECT * FROM escalation WHERE status = ? ORDER BY createdAt DESC").all(status) as EscalationRow[]
    : d.query("SELECT * FROM escalation ORDER BY createdAt DESC").all() as EscalationRow[];
  return rows.map(mapEscalationRow);
}

export function listOpenEscalations(filter?: { project?: string; kind?: string; limit?: number }): Escalation[] {
  const d = openDb();
  let query = "SELECT * FROM escalation WHERE status = 'open'";
  const params: any[] = [];

  if (filter?.project != null) {
    const normalizedProject = trackingProjectRoot(filter.project);
    query += " AND project = ?";
    params.push(normalizedProject);
  }

  if (filter?.kind != null) {
    query += " AND kind = ?";
    params.push(filter.kind);
  }

  query += " ORDER BY createdAt";

  if (filter?.limit != null) {
    query += " LIMIT ?";
    params.push(filter.limit);
  }

  return (d.query(query).all(...params) as EscalationRow[]).map(mapEscalationRow);
}

/** Escalations RESOLVED (or dismissed) for one project since `sinceMs`. A resolution is a real
 *  wake cause for the conductor — it moves the debounce fingerprint and means a human answered
 *  something — so the conductor pass hands these to its node as data (conductor-wake-context.ts).
 *  Filtered in SQL (project + resolvedAt) rather than by scanning every historical card. */
export function listEscalationsResolvedSince(project: string, sinceMs: number): Escalation[] {
  const d = openDb();
  return (d
    .query("SELECT * FROM escalation WHERE project = ? AND resolvedAt IS NOT NULL AND resolvedAt > ? AND status != 'open' ORDER BY resolvedAt")
    .all(project, sinceMs) as EscalationRow[]).map(mapEscalationRow);
}

/** Escalations of one `kind` for `project` with `createdAt` in [sinceMs, untilMs], oldest first.
 *  SQL-filtered (unlike `listEscalations`, which has no project/kind/window filter and maps
 *  every historical row) — for windowed reporting over a specific escalation kind. Normalizes
 *  `project` through `trackingProjectRoot` so the read boundary matches `createEscalation`'s
 *  write boundary. */
export function listEscalationsByKindInWindow(project: string, kind: string, sinceMs: number, untilMs: number): Escalation[] {
  const d = openDb();
  const normalizedProject = trackingProjectRoot(project);
  return (d
    .query("SELECT * FROM escalation WHERE project = ? AND kind = ? AND createdAt >= ? AND createdAt <= ? ORDER BY createdAt")
    .all(normalizedProject, kind, sinceMs, untilMs) as EscalationRow[]).map(mapEscalationRow);
}

export function getEscalation(id: string): Escalation | null {
  const d = openDb();
  const row = d.query('SELECT * FROM escalation WHERE id = ?').get(id) as EscalationRow | null;
  return row ? mapEscalationRow(row) : null;
}

export function resolveEscalationShortId(prefix: string): string | null {
  const d = openDb();
  const escaped = prefix.replace(/[%_\\]/g, '\\$&');
  const rows = d.query("SELECT id FROM escalation WHERE id LIKE ? ESCAPE '\\'").all(`${escaped}%`) as { id: string }[];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(`ambiguous escalation short id "${prefix}": matches ${rows.length} escalations (${rows.map(r => r.id).join(', ')})`);
  }
  return rows[0].id;
}

export function resolveFullEscalationId(id: string): string {
  const d = openDb();
  if (d.query('SELECT 1 FROM escalation WHERE id = ?').get(id)) return id;
  const resolved = resolveEscalationShortId(id);
  if (resolved === null) throw new Error(`escalation not found: ${id}`);
  return resolved;
}

export function applyEscalationResolveWrite(fullId: string, status: string, resolvedBy?: EscalationResolvedBy, note?: string | null): { status: string; note: string | null } {
  const d = openDb();
  const { status: normalizedStatus, note: normalizedNote } = normalizeEscalationStatus(status, note);
  // Honesty guard: once a row is labeled resolvedBy='timeout-default' (nobody answered;
  // the outcome was a fallthrough), a later mechanical close (e.g. the executor's
  // best-effort 'ai' resolve after its await returns 'timeout') must NOT relabel it as
  // a real decision. A genuine re-decision goes through reopenEscalation, which clears
  // resolvedBy to NULL first — so this never hides a real human answer.
  const info = d.prepare("UPDATE escalation SET status = ?, resolutionNote = COALESCE(?, resolutionNote), resolvedAt = ?, resolvedBy = CASE WHEN resolvedBy = 'timeout-default' THEN resolvedBy ELSE COALESCE(?, resolvedBy) END, triageInFlight = 0 WHERE id = ?").run(
    normalizedStatus,
    normalizedNote,
    Date.now(),
    resolvedBy ?? null,
    fullId
  );
  if (info.changes === 0) throw new Error(`escalation resolve matched no row: ${fullId}`);
  return { status: normalizedStatus, note: normalizedNote };
}

export function applyEscalationAcknowledgeWrite(fullId: string, acknowledgedBy?: 'ai' | 'human'): void {
  const d = openDb();
  const info = d
    .prepare('UPDATE escalation SET status = ?, resolvedBy = COALESCE(?, resolvedBy), triageInFlight = 0 WHERE id = ?')
    .run(ESCALATION_STATUSES[1], acknowledgedBy ?? null, fullId);
  if (info.changes === 0) throw new Error(`escalation acknowledge matched no row: ${fullId}`);
}

export function resolveEscalation(id: string, status: string, resolvedBy?: EscalationResolvedBy, note?: string | null): void {
  const fullId = resolveFullEscalationId(id);
  applyEscalationResolveWrite(fullId, status, resolvedBy, note);
}

/**
 * Acknowledge an escalation without marking it resolved: transition status='open'
 * to status='acknowledged' and clear triageInFlight. The card exits the human's
 * "open" floor (intentionally excluded from listOpenEscalations) but blocks re-raise
 * via the dedup query in createEscalation (acknowledged rows are still deduplicated).
 * This is the middle state for "a human has seen this, don't re-raise it" without
 * also marking it "handled" (resolvedAt stays NULL). When acknowledgedBy is supplied
 * ('ai' | 'human'), stamps the escalation's resolvedBy column for provenance tracking.
 * Returns the updated escalation (mapped) for broadcast, or null if id is unknown.
 */
export function acknowledgeEscalation(id: string, acknowledgedBy?: 'ai' | 'human'): Escalation | null {
  const fullId = resolveFullEscalationId(id);
  applyEscalationAcknowledgeWrite(fullId, acknowledgedBy);
  return getEscalation(fullId);
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
  const fullId = resolveFullEscalationId(id);
  const d = openDb();
  const info = d
    .prepare("UPDATE escalation SET status = 'open', resolvedAt = NULL, resolvedBy = NULL WHERE id = ? AND status != 'open'")
    .run(fullId);
  // Zero-row here means "already open" (nothing to undo), not a missing row — the
  // resolution step above already proved the row exists at all.
  if (info.changes === 0) return null;
  return getEscalation(fullId);
}

/**
 * Reopen the latest RESOLVED escalation for a `(project, conditionKey)` pair —
 * for a condition that recurs after being marked resolved. No-op (returns the
 * live row untouched) when an open/acknowledged row for that key already
 * exists; returns null when the key has never been used in that project.
 */
export function reopenResolvedEscalationByConditionKey(input: {
  project: string;
  conditionKey: string;
  questionText?: string;
}): { escalation: Escalation; reopened: boolean } | null {
  const d = openDb();
  const project = trackingProjectRoot(input.project);
  const openRow = d
    .query("SELECT * FROM escalation WHERE project = ? AND conditionKey = ? AND status IN ('open','acknowledged') ORDER BY createdAt DESC LIMIT 1")
    .get(project, input.conditionKey) as EscalationRow | null;
  if (openRow) {
    return { escalation: mapEscalationRow(openRow), reopened: false };
  }
  const resolvedRow = d
    .query("SELECT * FROM escalation WHERE project = ? AND conditionKey = ? AND (status = 'resolved' OR status LIKE 'resolved:%' OR status LIKE 'resolved - %') ORDER BY createdAt DESC LIMIT 1")
    .get(project, input.conditionKey) as EscalationRow | null;
  if (!resolvedRow) return null;
  const now = Date.now();
  d.prepare(
    'UPDATE escalation SET status = ?, resolvedAt = NULL, resolvedBy = NULL, lastSeenAt = ?, recurrenceCount = recurrenceCount + 1, questionText = COALESCE(?, questionText) WHERE id = ?'
  ).run('open', now, input.questionText ?? null, resolvedRow.id);
  const refreshed = d.query('SELECT * FROM escalation WHERE id = ?').get(resolvedRow.id) as EscalationRow;
  return { escalation: mapEscalationRow(refreshed), reopened: true };
}

/**
 * Operator-gate ('only you') an escalation — the human marking it as theirs alone.
 * Sets/clears the operatorGated column. When SETTING it, forces audience='human'
 * (the irreversible/outward floor — operator-gated is always human-visible).
 * Idempotent; returns the updated escalation (mapped) for broadcast, or null if
 * id is unknown.
 */
export function setEscalationOperatorGated(id: string, operatorGated: boolean): Escalation | null {
  const fullId = resolveFullEscalationId(id);
  const d = openDb();
  let info;
  if (operatorGated) {
    info = d.prepare("UPDATE escalation SET operatorGated = 1, audience = 'human' WHERE id = ?").run(fullId);
  } else {
    info = d.prepare('UPDATE escalation SET operatorGated = 0 WHERE id = ?').run(fullId);
  }
  if (info.changes === 0) throw new Error(`escalation operator-gate set matched no row: ${id}`);
  return getEscalation(fullId);
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
  const fullId = resolveFullEscalationId(id);
  const d = openDb();
  const info = d.prepare(
    'UPDATE escalation SET briefingMd = ?, briefingModel = ?, briefingAt = ? WHERE id = ?',
  ).run(md, model, at, fullId);
  if (info.changes === 0) throw new Error(`escalation briefing set matched no row: ${id}`);
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
  // Normalize status to canonical form + extract trailing prose into resolutionNote.
  const { status: normalizedStatus, note: normalizedNote } = normalizeEscalationStatus(status);
  const stmt = d.prepare('UPDATE escalation SET status = ?, resolutionNote = COALESCE(?, resolutionNote), resolvedAt = ? WHERE id = ?');
  for (const e of matched) stmt.run(normalizedStatus, normalizedNote, resolvedAt, e.id);
  return matched.map((e) => ({ ...e, status: normalizedStatus, resolutionNote: normalizedNote || e.resolutionNote, resolvedAt }));
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
/** Minimum TTL for operator-gated cards. Incident ef5a06b8: an over-budget re-bet card
 *  was raised and reaped `stale` within the ~60s reconcile window (159s/129s/129s lifetimes),
 *  so the operator tie-breaker never existed. Operator-gated cards that supply no explicit
 *  timeout are stamped with this 6-hour floor to ensure the human sees them. */
export const OPERATOR_CARD_MIN_TTL_MS = 6 * 60 * 60_000;

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
