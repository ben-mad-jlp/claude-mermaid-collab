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
  /** ISO timestamp a retraction was recorded, or null while the note stands. A retracted
   *  note is WRONG, not merely handled — see retractFriction. */
  retractedAt: string | null;
  /** Why the note is invalid. Required at retraction time. */
  retractedReason: string | null;
  /** Optional id of the note (or record) that supersedes this one. */
  supersededBy: string | null;
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
  /** Include RETRACTED notes. Default false — a note whose analysis was proven wrong must not
   *  keep surfacing as evidence. friction is a primary input to mission-forge's survey step, so
   *  an un-excluded wrong note silently biases every future survey that touches it. */
  includeRetracted?: boolean;
  /** Filter by retryReason (exact match). */
  retryReason?: string;
  /** Inclusive lower bound on createdAt. Compared lexicographically as ISO-8601 UTC text
   *  (≥) because createdAt is written by nowIso() as fixed-width UTC. */
  since?: string;
  /** Maximum number of rows to return. Ignored by countFriction. */
  limit?: number;
  /** Offset into the result set; requires limit. If offset is set without limit,
   *  SQL will use LIMIT -1 (sqlite's "no bound" sentinel). */
  offset?: number;
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
  createdAt TEXT NOT NULL,
  retractedAt TEXT,
  retractedReason TEXT,
  supersededBy TEXT
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

  // Migration: retraction columns are additive — add them to any pre-existing table.
  const have = new Set((db.prepare(`PRAGMA table_info(friction_notes)`).all() as Array<{ name: string }>).map((c) => c.name));
  for (const [col, ddl] of [['retractedAt', 'TEXT'], ['retractedReason', 'TEXT'], ['supersededBy', 'TEXT']] as const) {
    if (!have.has(col)) db.exec(`ALTER TABLE friction_notes ADD COLUMN ${col} ${ddl}`);
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
    retractedAt: row.retractedAt ?? null,
    retractedReason: row.retractedReason ?? null,
    supersededBy: row.supersededBy ?? null,
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

/** Atomic record-if-absent: collapses hasFrictionNote's check + recordFriction's insert into
 *  ONE SQL statement (INSERT ... SELECT ... WHERE NOT EXISTS), so two callers racing on the
 *  same (layer, retryReason, detail) — same process or two separate daemon processes sharing
 *  this sqlite file — can never both win. Requires an EXACT `detail` (not a substring probe
 *  like hasFrictionNote's detailIncludes) because the caller's dedup key must be fully
 *  reproducible SQL-side. Returns true iff this call inserted a NEW row. */
export function recordFrictionOnce(
  project: string,
  input: RecordFrictionInput & { detail: string },
): Promise<boolean> {
  return withLock(project, () => {
    if (!input.retryReason) throw new Error('recordFrictionOnce: retryReason is required');
    if (!VALID_LAYERS.includes(input.layer)) {
      throw new Error(`recordFrictionOnce: layer must be one of ${VALID_LAYERS.join(' | ')} (got ${String(input.layer)})`);
    }
    const db = openDb(project);
    const id = crypto.randomUUID();
    const ts = nowIso();
    const attempt = input.attempt ?? 1;
    const result = db.prepare(
      `INSERT INTO friction_notes (id, todoId, session, attempt, layer, retryReason, detail, createdAt)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM friction_notes WHERE layer = ? AND retryReason = ? AND detail = ?
       )`
    ).run(
      id, input.todoId ?? null, input.session ?? null, attempt, input.layer, input.retryReason, input.detail, ts,
      input.layer, input.retryReason, input.detail,
    );
    return result.changes > 0;
  });
}

/** Build the WHERE clause and params for a FrictionFilter. Returns an object with
 *  `where` (either '' or ' WHERE ...') and `params` ((string | number)[] to accommodate
 *  numbers from LIMIT/OFFSET, though this helper returns only strings). Used by both
 *  listFriction and countFriction. */
function buildFrictionWhere(filter: FrictionFilter): { where: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.todoId) { where.push('todoId = ?'); params.push(filter.todoId); }
  if (filter.session) { where.push('session = ?'); params.push(filter.session); }
  if (filter.layer) { where.push('layer = ?'); params.push(filter.layer); }
  if (filter.retryReason) { where.push('retryReason = ?'); params.push(filter.retryReason); }
  if (filter.since) { where.push('createdAt >= ?'); params.push(filter.since); }
  if (!filter.includeRetracted) where.push('retractedAt IS NULL');
  return {
    where: where.length ? ' WHERE ' + where.join(' AND ') : '',
    params,
  };
}

/** Query friction notes, newest first. Filter by todoId / session / layer / retryReason / since — e.g.
 *  `listFriction(project, { layer: 'domain' })` answers "which todos hit
 *  domain-layer friction and why" without opening any worker transcript.
 *
 *  NOTE: No default limit is applied at the store layer. Callers that need the full
 *  result set (friction-trends.ts, profile-draft.ts, hasFrictionNote) depend on
 *  receiving every matching row. A default LIMIT here would silently truncate those
 *  callers' results. Pagination bounds belong at the MCP tool layer. */
export function listFriction(project: string, filter: FrictionFilter = {}): FrictionNote[] {
  const db = openDb(project);
  const { where, params } = buildFrictionWhere(filter);
  const sql = `SELECT * FROM friction_notes${where} ORDER BY createdAt DESC, rowid DESC`;
  let sql_with_pagination = sql;
  let params_with_pagination: (string | number)[] = params;

  if (filter.limit !== undefined || filter.offset !== undefined) {
    const offset = filter.offset ?? 0;
    if (filter.limit !== undefined) {
      sql_with_pagination = `${sql} LIMIT ? OFFSET ?`;
      params_with_pagination = [...params, filter.limit, offset];
    } else {
      // offset without limit: use sqlite's "no bound" sentinel LIMIT -1
      sql_with_pagination = `${sql} LIMIT -1 OFFSET ?`;
      params_with_pagination = [...params, offset];
    }
  }

  return (db.prepare(sql_with_pagination).all(...(params_with_pagination as any)) as any[]).map(rowToNote);
}

/** Count the number of friction notes matching a filter, ignoring limit/offset.
 *  Mirrors listFriction's style: unlocked read. Returns the matching row count. */
export function countFriction(project: string, filter: FrictionFilter = {}): number {
  const db = openDb(project);
  const { where, params } = buildFrictionWhere(filter);
  const sql = `SELECT COUNT(*) AS n FROM friction_notes${where}`;
  const result = db.prepare(sql).get(...(params as any)) as { n: number } | undefined;
  return result?.n ?? 0;
}

/**
 * RETRACT a friction note whose analysis was WRONG.
 *
 * friction_notes was append-only, so a confidently-argued but incorrect note stayed in the
 * queryable record indistinguishable from a correct one — counted by friction_trends, and read
 * as prior art by anyone grepping for it. Paid for in a real incident: note 95c5c237 argued at
 * length that no public verb could retire a superseded leaf and asked for a `drop_todo` that
 * would have duplicated `reset_todo` (which already accepts the dropped status). Its only
 * available correction was ANOTHER note, which relies on a reader finding both.
 *
 * Retraction means "this note is wrong", NOT "this was fixed" — a fixed problem is still real
 * evidence and must keep counting. Retracted notes are excluded from listFriction (and therefore
 * from frictionTrends) unless includeRetracted is passed.
 *
 * Throws when the id matches no row: a zero-row write that reports success is the
 * silently-accepted-then-discarded failure this store must not have.
 */
export function retractFriction(
  project: string,
  input: { id: string; reason: string; supersededBy?: string },
): FrictionNote {
  const id = input.id?.trim();
  const reason = input.reason?.trim();
  if (!id) throw new Error('retractFriction: id is required');
  if (!reason) throw new Error('retractFriction: reason is required — a retraction without a stated reason is not reviewable');

  const db = openDb(project);
  const existing = db.prepare('SELECT * FROM friction_notes WHERE id = ?').get(id) as any;
  if (!existing) {
    throw new Error(`retractFriction: no friction note with id ${id} (nothing was written)`);
  }
  if (existing.retractedAt) {
    // Idempotent: re-retracting is a no-op that returns the existing state rather than
    // silently overwriting the original reason.
    return rowToNote(existing);
  }
  db.prepare(
    'UPDATE friction_notes SET retractedAt = ?, retractedReason = ?, supersededBy = ? WHERE id = ?',
  ).run(new Date().toISOString(), reason, input.supersededBy ?? null, id);
  return rowToNote(db.prepare('SELECT * FROM friction_notes WHERE id = ?').get(id));
}

/** True iff a friction note already exists for this retryReason (optionally scoped by
 *  layer) whose detail CONTAINS `detailIncludes`. Durable dedup primitive: it reads
 *  friction.db every call, so the guard survives daemon restarts (an in-memory Set would
 *  not). Used by the worktree reaper to flag each orphan dir at most once. */
export function hasFrictionNote(
  project: string,
  q: { retryReason: string; detailIncludes?: string; layer?: FrictionLayer },
): boolean {
  const matches = listFriction(project, q.layer ? { layer: q.layer } : {})
    .filter((n) => n.retryReason === q.retryReason);
  if (!q.detailIncludes) return matches.length > 0;
  return matches.some((n) => (n.detail ?? '').includes(q.detailIncludes!));
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

/** Canonical KV key for the DF3 triage "this recurring reason already has a
 *  filed todo" marker. Namespaced under friction_watch_state (no schema change). */
const TRIAGE_ACTIONED_PREFIX = 'triage:actioned:';
const triageActionedKey = (layer: FrictionLayer, retryReason: string) =>
  `${TRIAGE_ACTIONED_PREFIX}${layer}:${retryReason}`;

/** True iff a todo has already been filed for this (layer, reason) — DF3 dedup.
 *  Permanent marker (MVP): once actioned, never re-filed. Future enhancement:
 *  re-arm when the count grows materially after the prior todo is resolved. */
export function isReasonActioned(project: string, layer: FrictionLayer, retryReason: string): boolean {
  return getWatchState(project, triageActionedKey(layer, retryReason)) !== null;
}

/** Mark a (layer, reason) actioned by recording the filed todo id as the state
 *  (the marker doubles as a back-pointer to the todo). Serialized via withLock. */
export function markReasonActioned(
  project: string, layer: FrictionLayer, retryReason: string, todoId: string,
): Promise<void> {
  return setWatchState(project, triageActionedKey(layer, retryReason), todoId);
}

/** Scan durable watch-state for every key under `prefix` (used by the intake pass to
 *  enumerate its per-cluster provenance markers). Unlocked read, mirrors listFriction. */
export function listWatchStateByPrefix(project: string, prefix: string): Array<{ signalKey: string; state: string }> {
  const db = openDb(project);
  return db
    .prepare('SELECT signalKey, state FROM friction_watch_state WHERE signalKey LIKE ? ESCAPE \'\\\'')
    .all(prefix.replace(/[%_\\]/g, (c) => '\\' + c) + '%') as Array<{ signalKey: string; state: string }>;
}

// ─────────────────────────── mission-intake cluster markers (DISJOINT namespace) ───────────────────────────
// A cluster-level anti-spam + provenance marker, namespaced UNDER friction_watch_state but with a
// prefix DISJOINT from triage's (`triage:actioned:`) so neither ladder suppresses the other: a
// friction reason can be BOTH triaged into a 'planned' bug todo AND escalated into a forged mission.
// The stored state is the mission-intake provenance JSON (the marker doubles as the queryable
// "auto-drafted from cluster X, N occ / M sessions" back-pointer, mirroring markReasonActioned).

const INTAKE_ACTIONED_PREFIX = 'intake:actioned:';
const intakeActionedKey = (clusterSig: string) => `${INTAKE_ACTIONED_PREFIX}${clusterSig}`;

/** Provenance stamped on a mission auto-drafted by the intake pass. Persisted in the friction store
 *  (not a mission column) so it is queryable without touching mission-store. */
export interface IntakeProvenance {
  clusterSig: string;
  layer: FrictionLayer;
  reasons: string[];
  /** Occurrence count of the cluster at draft time. */
  count: number;
  /** Distinct sessions that hit the cluster at draft time. */
  sessions: number;
  /** The forged (unapproved) mission's todo id. */
  missionId: string;
  /** Where the synthesized brief was written. */
  briefPath: string;
  /** ISO draft time. */
  at: string;
}

/** True iff this cluster signature has already been escalated to a forged mission (permanent
 *  per-cluster marker — a double-tick drafts exactly one). DISJOINT from isReasonActioned. */
export function isClusterIntakeActioned(project: string, clusterSig: string): boolean {
  return getWatchState(project, intakeActionedKey(clusterSig)) !== null;
}

/** Mark a cluster escalated by storing its provenance JSON as the state. Serialized via withLock. */
export function markClusterIntakeActioned(project: string, prov: IntakeProvenance): Promise<void> {
  return setWatchState(project, intakeActionedKey(prov.clusterSig), JSON.stringify(prov));
}

function parseProvenance(state: string | null): IntakeProvenance | null {
  if (!state) return null;
  try { return JSON.parse(state) as IntakeProvenance; } catch { return null; }
}

/** Read the queryable provenance for one cluster signature, or null if never escalated. */
export function getClusterIntakeProvenance(project: string, clusterSig: string): IntakeProvenance | null {
  return parseProvenance(getWatchState(project, intakeActionedKey(clusterSig)));
}

/** All intake provenance stamps in the project (for `orchestrator_status` / list surfaces). */
export function listClusterIntakeProvenance(project: string): IntakeProvenance[] {
  return listWatchStateByPrefix(project, INTAKE_ACTIONED_PREFIX)
    .map((r) => parseProvenance(r.state))
    .filter((p): p is IntakeProvenance => p !== null);
}
