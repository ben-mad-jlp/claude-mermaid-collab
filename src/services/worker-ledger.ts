/**
 * Persistent worker model-call ledger (north-star §6) — the durable, queryable,
 * replayable record of every fabric phase: which (provider, model) ran which phase
 * of which todo, at what token cost, with what result. The live transcript is
 * ephemeral (in-memory per lane, lost on restart); THIS is the append-only audit
 * trail a human (or a tuning pass on the tier matrix) queries after the fact.
 *
 * One row per worker-core phase, written from the adapter's phase-end event. Stored
 * in its own SQLite DB (append-heavy log, kept off the supervisor state DB). Reads
 * are aggregate-friendly (per-run / per-project summaries) so the tier matrix can be
 * tuned on cost-per-correct-completion instead of guesses.
 */
import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseDiffContract, renderContract, type DiffContract, type DiffRequirement } from './diff-contract';

export interface LedgerEntry {
  project: string;
  todoId: string;
  /** The epic this todo rolls up to (for per-epic cost rollup / budget bars). Null = none. */
  epicId?: string | null;
  /** Worker session/lane that ran the phase (the executor). */
  session: string;
  phase: string;
  provider: string;
  model: string;
  /** Why this route was chosen: 'default' tier vs a config 'override'. */
  source: string;
  inputTokens: number;
  outputTokens: number;
  /** Cache READ input tokens (prompt-cache hits, billed ~0.1x). On the Max plan the
   *  bulk of a node's input lands here — `inputTokens` is only the uncached delta, so
   *  these two fields are what actually reveal plan-quota throughput. Optional →
   *  legacy callers backfill 0. */
  cacheReadTokens?: number;
  /** Cache CREATION input tokens (prompt-cache writes, billed ~1.25x). A fresh per-node
   *  process spawn pays a cache-write for its prefix → this is where the cross-node
   *  "no caching across spawns" cost shows up. Optional → legacy callers backfill 0. */
  cacheCreationTokens?: number;
  costUsd: number;
  /** False when the model had no known price (so costUsd=0 means unknown, not free). */
  knownPrice: boolean;
  steps: number;
  /** Set when the phase's structured verdict failed to parse (a quality signal). */
  parseError?: string | null;
  // --- node-level fields (PAW P1 headless node primitive; all optional → existing
  //     callers compile + insert unchanged, backfilling NULL) ---
  /** Node kind discriminator for a headless `claude -p` node row (else undefined). */
  nodeKind?: string | null;
  /** How many nodes this row's work spent (node-cost rollup). */
  nodesSpent?: number | null;
  /** Auth mode in effect ('subscription' | 'api' | 'unknown'). */
  authMode?: string | null;
  /** Process exit code of the node. */
  exitCode?: number | null;
  /** Wall-clock duration of the node (ms). */
  durationMs?: number | null;
  /** Whether the node was rate-limited (stored 0/1 like knownPrice). */
  rateLimited?: boolean | null;
  /** Leaf correlation id (the executor leaf this node ran for). */
  leafId?: string | null;
  /** REVIEW node's parsed PASS/FAIL verdict ('pass'|'fail'|null). Written by the
   *  leaf-executor on the review node row (P4a R1 — the read-side needs it). */
  verdict?: string | null;
  /** Terminal leaf outcome ('accepted'|'blocked'|'rejected'|'paused'|null),
   *  stamped by the leaf-executor on the row of the node it returned from. */
  leafOutcome?: string | null;
  /** The node's final output text (the model's last message — the verify tsc error,
   *  the review verdict+reason, the research findings, the implement summary). The
   *  durable record of WHAT each node actually said, so a stuck/rejected leaf can be
   *  diagnosed (and surfaced in the UI) without re-running it. Capped on write. */
  outputText?: string | null;
  /** ATOMIC TERMINAL RECORD (only on the leaf's `outcome` marker row): a JSON blob
   *  capturing the full, single-source acceptance decision — effectiveOutcome,
   *  reviewVerdict, pathTaken (floor/waves), reason, pendingReason, gateReasons,
   *  attempts, nodesSpent. Written ONCE so the outcome is never re-derived from
   *  scattered sources (the bug that made 'pending' read as 'rejected'). */
  outcomeDetail?: string | null;
  /** JSON-encoded RecordedCommand[] from the node's stream-json transcript.
   *  Extracted at the spawn boundary (not self-reported by the node). Used to gate
   *  on cwd escapes and verify reviewer claims (C2). */
  commands?: string | null;
}

/** Defensive cap on persisted node output — a node's final message is normally small,
 *  but never let a pathological one bloat the ledger row. */
const MAX_OUTPUT_CHARS = 200_000;

interface LedgerRow extends LedgerEntry {
  id: number;
  ts: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS worker_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  todoId TEXT NOT NULL,
  session TEXT NOT NULL,
  phase TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source TEXT NOT NULL,
  inputTokens INTEGER NOT NULL DEFAULT 0,
  outputTokens INTEGER NOT NULL DEFAULT 0,
  costUsd REAL NOT NULL DEFAULT 0,
  knownPrice INTEGER NOT NULL DEFAULT 1,
  steps INTEGER NOT NULL DEFAULT 0,
  parseError TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_project ON worker_ledger(project);
CREATE INDEX IF NOT EXISTS idx_ledger_todo ON worker_ledger(todoId);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON worker_ledger(ts);
CREATE INDEX IF NOT EXISTS idx_ledger_epic_ts ON worker_ledger(epicId, ts DESC);
`;

let db: Database | null = null;

/** This process's epoch — minted once at module load, stamped onto every
 *  leaf_inflight row this process writes. A row carrying a different (or NULL,
 *  legacy) epoch was written by a now-dead daemon whose in-process executor was
 *  killed before it could clear the row; `reapStaleInflight` deletes those. */
const LEDGER_EPOCH = crypto.randomUUID();

function openDb(): Database {
  if (db) return db;
  const dir = process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  db = new Database(join(dir, 'worker-ledger.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  // Additive migration: epicId column for per-epic cost rollup (idempotent).
  const cols = db.query('PRAGMA table_info(worker_ledger)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'epicId')) db.exec('ALTER TABLE worker_ledger ADD COLUMN epicId TEXT');
  // Additive migration: node-level columns (PAW P1). Same idempotent ALTER idiom.
  const add = (name: string, decl: string) => {
    if (!cols.some((c) => c.name === name)) db!.exec(`ALTER TABLE worker_ledger ADD COLUMN ${name} ${decl}`);
  };
  add('nodeKind', 'TEXT');
  add('nodesSpent', 'INTEGER');
  add('authMode', 'TEXT');
  add('exitCode', 'INTEGER');
  add('durationMs', 'INTEGER');
  add('rateLimited', 'INTEGER'); // 0/1 like knownPrice
  add('leafId', 'TEXT');
  // Additive migration: prompt-cache token visibility (Max-plan quota is paid in input
  // incl. cache; the bare inputTokens column is only the uncached delta). Nullable → 0.
  add('cacheReadTokens', 'INTEGER');
  add('cacheCreationTokens', 'INTEGER');
  // Additive migration: P4a R1 verdict/outcome write-back (idempotent, nullable).
  add('verdict', 'TEXT'); // 'pass'|'fail'|null (review node)
  add('leafOutcome', 'TEXT'); // 'accepted'|'blocked'|'rejected'|'paused'|null (terminal)
  add('outputText', 'TEXT'); // node's final output text (diagnostic + UI source)
  add('outcomeDetail', 'TEXT'); // atomic terminal record (JSON) on the outcome marker row
  // Additive migration: C2 command evidence (idempotent, nullable).
  add('commands', 'TEXT'); // JSON-encoded RecordedCommand[] from stream-json
  // LIVE in-flight signal: the append-only ledger only gets a row when a node COMPLETES,
  // so a running node is invisible (the "3 minutes of silence" blind spot). This tiny
  // table holds exactly one row per CURRENTLY-running leaf (cross-process via SQLite, so
  // the UI/MCP — separate processes from the executor — can see it), set at node start and
  // cleared the instant the node finishes. Stale rows (hard crash) are aged out by readers.
  db.exec(`CREATE TABLE IF NOT EXISTS leaf_inflight (
    leafId TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    epicId TEXT,
    nodeKind TEXT,
    model TEXT,
    attempt INTEGER,
    startedAt INTEGER NOT NULL,
    epoch TEXT
  )`);
  // Additive migration: `epoch` stamps the owning daemon process so a record left
  // by a now-dead process (sidecar restart killed the executor before its finally
  // cleared the row) can be reaped on sight. Guarded ALTER for pre-existing tables.
  try {
    const lic = db.query('PRAGMA table_info(leaf_inflight)').all() as Array<{ name: string }>;
    if (!lic.some((c) => c.name === 'epoch')) db.exec('ALTER TABLE leaf_inflight ADD COLUMN epoch TEXT');
  } catch { /* best-effort migration */ }
  // DURABLE resume state (slice 1b) — survives process death (NOT epoch-reaped).
  db.exec(`CREATE TABLE IF NOT EXISTS leaf_resume (
    leafId TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    nodesSpent INTEGER NOT NULL DEFAULT 0,
    phase TEXT,
    attempt INTEGER,
    epicBaseSha TEXT,
    merged INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL
  )`);
  // G2 once-per-epic base gate cache. Keyed on epicId ALONE (not the moving epic tip) —
  // the acceptance criterion "one base-gate execution total, not one per leaf" forbids
  // keying on the tip, which would re-run after every leaf merge.
  db.exec(`CREATE TABLE IF NOT EXISTS epic_base_gate (
    epicId TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    baseSha TEXT,
    status TEXT NOT NULL,
    command TEXT,
    output TEXT,
    checkedAt INTEGER NOT NULL
  )`);
  // G10 land gate cache. Keyed on epicId + both shas (tip and base) — both must match
  // for a cache hit. Tip changes after every leaf merge, base changes after every master
  // merge. A stale pass would silently greenlight an unexamined tree (G10 failure).
  // Unlike epic_base_gate, status='error' is NEVER cached — an incident is not a fact.
  db.exec(`CREATE TABLE IF NOT EXISTS epic_land_gate (
    epicId TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    epicTipSha TEXT,
    baseSha TEXT,
    status TEXT NOT NULL,
    result TEXT,
    checkedAt INTEGER NOT NULL
  )`);
  // G8 durable blueprint base SHA — survives terminal outcomes, independent of leaf_resume.
  // The blueprint's reusability is a leaf fact that must outlive run checkpoints.
  // Cleared only when the leaf is genuinely done (accepted/merged).
  db.exec(`CREATE TABLE IF NOT EXISTS leaf_blueprint (
    leafId TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    epicBaseSha TEXT,
    recordedAt INTEGER NOT NULL
  )`);
  {
    const lbc = db.query('PRAGMA table_info(leaf_blueprint)').all() as Array<{ name: string }>;
    if (!lbc.some((c) => c.name === 'specJson')) db.exec('ALTER TABLE leaf_blueprint ADD COLUMN specJson TEXT');
    if (!lbc.some((c) => c.name === 'specRev')) db.exec('ALTER TABLE leaf_blueprint ADD COLUMN specRev INTEGER');
    if (!lbc.some((c) => c.name === 'specSig')) db.exec('ALTER TABLE leaf_blueprint ADD COLUMN specSig TEXT');
  }
  // G8 resume decision audit trail — records the per-claim resume verdict (mode/reason),
  // anomaly detection (blueprint discarded), and inputs used in the decision.
  // Append-only; never cleared except for database reset.
  db.exec(`CREATE TABLE IF NOT EXISTS leaf_resume_decision (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    leafId TEXT NOT NULL,
    project TEXT NOT NULL,
    mode TEXT NOT NULL,
    reason TEXT NOT NULL,
    hadResumeRow INTEGER NOT NULL,
    hasBlueprintOutput INTEGER NOT NULL,
    resumeBaseSha TEXT,
    currentEpicSha TEXT,
    anomaly INTEGER NOT NULL DEFAULT 0,
    decidedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lrd_leaf ON leaf_resume_decision(leafId, decidedAt)`);
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeLedgerDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** Append one phase's model-call record. Best-effort: a ledger write must NEVER break
 *  a worker run, so failures are swallowed (the run is the product, the ledger is
 *  telemetry). Returns the inserted row id, or null on failure. */
export function recordPhase(entry: LedgerEntry, now: number = Date.now()): number | null {
  try {
    const d = openDb();
    const res = d
      .prepare(
        `INSERT INTO worker_ledger
          (project, todoId, epicId, session, phase, provider, model, source, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd, knownPrice, steps, parseError,
           nodeKind, nodesSpent, authMode, exitCode, durationMs, rateLimited, leafId, verdict, leafOutcome, outputText, outcomeDetail, commands, ts)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?, ?)`,
      )
      .run(
        entry.project, entry.todoId, entry.epicId ?? null, entry.session, entry.phase, entry.provider, entry.model, entry.source,
        entry.inputTokens, entry.outputTokens, entry.cacheReadTokens ?? null, entry.cacheCreationTokens ?? null, entry.costUsd, entry.knownPrice ? 1 : 0, entry.steps,
        entry.parseError ?? null,
        entry.nodeKind ?? null, entry.nodesSpent ?? null, entry.authMode ?? null, entry.exitCode ?? null,
        entry.durationMs ?? null, entry.rateLimited == null ? null : entry.rateLimited ? 1 : 0, entry.leafId ?? null,
        entry.verdict ?? null, entry.leafOutcome ?? null,
        entry.outputText == null ? null : entry.outputText.slice(0, MAX_OUTPUT_CHARS),
        entry.outcomeDetail ?? null,
        entry.commands ?? null,
        now,
      );
    return Number(res.lastInsertRowid);
  } catch {
    return null;
  }
}

export interface LedgerQuery {
  project?: string;
  todoId?: string;
  /** Roll up only rows for this epic (per-epic cost / budget bar). */
  epicId?: string;
  /** Only rows for this executor leaf (per-leaf run view — P4a). Unindexed at
   *  current volume (scanned under the 2000 cap); add idx_ledger_leaf if it grows. */
  leafId?: string;
  /** Only rows at/after this epoch-ms. */
  since?: number;
  /** Cap rows returned (default 200, max 2000), newest first. */
  limit?: number;
}

function rowToEntry(r: LedgerRow): LedgerRow {
  return {
    ...r,
    knownPrice: Boolean(r.knownPrice),
    // Coerce the 0/1 column to a Boolean like knownPrice — but preserve NULL
    // (no node info) as null so non-node rows aren't misreported as `false`.
    rateLimited: r.rateLimited == null ? null : Boolean(r.rateLimited),
  };
}

/**
 * Record one headless-node row (PAW P1). Thin wrapper over `recordPhase` that
 * fills the node-shaped defaults (phase='node', provider='claude', source='node')
 * so a node executor only supplies the correlation + node telemetry. Best-effort
 * like recordPhase. Returns the inserted row id, or null on failure.
 */
export function recordNode(
  entry: Pick<LedgerEntry, 'project' | 'todoId' | 'session'> &
    Partial<LedgerEntry> & {
      authMode?: string | null;
      exitCode?: number | null;
      durationMs?: number | null;
      rateLimited?: boolean | null;
    },
  now: number = Date.now(),
): number | null {
  return recordPhase(
    {
      project: entry.project,
      todoId: entry.todoId,
      epicId: entry.epicId ?? null,
      session: entry.session,
      phase: entry.phase ?? 'node',
      provider: entry.provider ?? 'claude',
      model: entry.model ?? '',
      source: entry.source ?? 'node',
      inputTokens: entry.inputTokens ?? 0,
      outputTokens: entry.outputTokens ?? 0,
      cacheReadTokens: entry.cacheReadTokens ?? 0,
      cacheCreationTokens: entry.cacheCreationTokens ?? 0,
      costUsd: entry.costUsd ?? 0,
      knownPrice: entry.knownPrice ?? false,
      steps: entry.steps ?? 0,
      parseError: entry.parseError ?? null,
      nodeKind: entry.nodeKind ?? 'node',
      nodesSpent: entry.nodesSpent ?? 1,
      authMode: entry.authMode ?? null,
      exitCode: entry.exitCode ?? null,
      durationMs: entry.durationMs ?? null,
      rateLimited: entry.rateLimited ?? null,
      leafId: entry.leafId ?? null,
      verdict: entry.verdict ?? null,
      leafOutcome: entry.leafOutcome ?? null,
      outputText: entry.outputText ?? null,
      outcomeDetail: entry.outcomeDetail ?? null,
      commands: entry.commands ?? null,
    },
    now,
  );
}

// --- LIVE in-flight signal (leaf_inflight) ------------------------------------
export interface InflightEntry {
  leafId: string;
  project: string;
  epicId?: string | null;
  nodeKind?: string | null;
  model?: string | null;
  attempt?: number | null;
}
export interface InflightRow extends InflightEntry { startedAt: number }

/** Mark a leaf as RUNNING a node (upsert — one row per leaf). Best-effort. */
export function setLeafInflight(e: InflightEntry, now: number = Date.now()): void {
  try {
    openDb().prepare(
      `INSERT INTO leaf_inflight (leafId, project, epicId, nodeKind, model, attempt, startedAt, epoch)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(leafId) DO UPDATE SET
         project=excluded.project, epicId=excluded.epicId, nodeKind=excluded.nodeKind,
         model=excluded.model, attempt=excluded.attempt, startedAt=excluded.startedAt, epoch=excluded.epoch`,
    ).run(e.leafId, e.project, e.epicId ?? null, e.nodeKind ?? null, e.model ?? null, e.attempt ?? null, now, LEDGER_EPOCH);
  } catch { /* telemetry — never break the run */ }
}

/** Clear a leaf's in-flight row (node finished / leaf terminal). Best-effort. */
export function clearLeafInflight(leafId: string): void {
  try { openDb().prepare('DELETE FROM leaf_inflight WHERE leafId = ?').run(leafId); } catch { /* best-effort */ }
}

/** TRUE iff a leaf has a LIVE in-flight row written by THIS process (epoch ===
 *  LEDGER_EPOCH). A stale/foreign-epoch row (a phantom from a dead daemon awaiting
 *  reap) reads false. Pure read; best-effort (false on any error). The claim guard
 *  uses this to keep a still-running leaf out of the claimable set. */
export function isLeafInflightLive(leafId: string): boolean {
  try {
    const row = openDb()
      .prepare('SELECT epoch FROM leaf_inflight WHERE leafId = ?')
      .get(leafId) as { epoch?: string | null } | undefined;
    return !!row && row.epoch === LEDGER_EPOCH;
  } catch {
    return false;
  }
}

/**
 * Reap stranded in-flight rows: delete every row NOT written by THIS process
 * (epoch != LEDGER_EPOCH, or NULL/legacy). Such a row's executor died with its
 * daemon (e.g. a sidecar hot-swap) before its finally could clear it, so it would
 * otherwise show as a phantom running leaf forever. Safe to call every tick —
 * idempotent (once swept, only this process's live rows remain). Returns the
 * count deleted. Best-effort.
 */
export function reapStaleInflight(): number {
  try {
    const res = openDb().prepare('DELETE FROM leaf_inflight WHERE epoch IS NULL OR epoch != ?').run(LEDGER_EPOCH);
    return res.changes ?? 0;
  } catch { return 0; }
}

/**
 * E4 (epic e5acda93): drop a SAME-epoch in-flight row whose run is no longer live in
 * THIS process. `reapStaleInflight` only deletes OTHER-epoch (dead-daemon) rows; this
 * closes the within-epoch gap — an aborted (E1 kill) or errored run that ended without
 * its finally clearing the row would otherwise leave a CURRENT-epoch phantom that
 * inflates daemon_status' in-flight count AND (post lease-fix 0f1df3d2) permanently
 * blocks the leaf from being reclaimed (isLeafInflightLive stays true). `isLive` is the
 * run-level liveness predicate (leaf-subprocess-registry.isRunLive). Returns count
 * deleted. Idempotent + best-effort.
 */
export function reapSameEpochOrphanInflight(isLive: (leafId: string) => boolean): number {
  try {
    const rows = openDb().prepare('SELECT leafId FROM leaf_inflight WHERE epoch = ?').all(LEDGER_EPOCH) as Array<{ leafId: string }>;
    let n = 0;
    for (const r of rows) {
      if (isLive(r.leafId)) continue; // a genuinely-running leaf (incl. between its nodes)
      openDb().prepare('DELETE FROM leaf_inflight WHERE leafId = ?').run(r.leafId);
      n++;
    }
    return n;
  } catch { return 0; }
}

// --- DURABLE resume state (leaf-phase-checkpoint-design, slice 1b) ------------
// Unlike leaf_inflight (cleared on node-finish, epoch-reaped on process death),
// THIS table must SURVIVE a process death — it's how a hard kill (daemon crash /
// hot-swap) recovers the budget already spent so a re-claim doesn't reset to 20
// and re-run blueprint+implement from scratch. Written continuously (each node)
// and cleared only on a terminal outcome. `merged`/`epicBaseSha` are recorded now
// for the slice-2 reattach-on-resume (skip-to-gate after a post-merge kill); the
// behavior change in slice 1b is the nodesSpent recovery alone.
export interface LeafResumeEntry {
  leafId: string;
  project: string;
  nodesSpent: number;
  phase?: string | null;
  attempt?: number | null;
  /** Epic tip SHA at blueprint time — slice-2 guard so we never resume against a
   *  moved base. Preserved across per-node writes (COALESCE). */
  epicBaseSha?: string | null;
}
export interface LeafResumeRow extends LeafResumeEntry { merged: boolean; updatedAt: number }

/** Upsert a leaf's durable resume state. Preserves an existing `merged` flag and a
 *  previously-recorded `epicBaseSha`. Best-effort (telemetry must never break a run). */
export function recordLeafResume(e: LeafResumeEntry, now: number = Date.now()): void {
  try {
    openDb().prepare(
      `INSERT INTO leaf_resume (leafId, project, nodesSpent, phase, attempt, epicBaseSha, merged, updatedAt)
       VALUES (?,?,?,?,?,?,0,?)
       ON CONFLICT(leafId) DO UPDATE SET
         project=excluded.project, nodesSpent=excluded.nodesSpent, phase=excluded.phase,
         attempt=excluded.attempt,
         epicBaseSha=COALESCE(excluded.epicBaseSha, leaf_resume.epicBaseSha),
         updatedAt=excluded.updatedAt`,
    ).run(e.leafId, e.project, e.nodesSpent, e.phase ?? null, e.attempt ?? null, e.epicBaseSha ?? null, now);
  } catch { /* best-effort */ }
}

/** Flag a leaf as merged-to-epic (so a post-merge kill can skip straight to the
 *  gate on resume — consumed in slice 2). No-op if no resume row exists yet. */
export function markLeafMerged(leafId: string, now: number = Date.now()): void {
  try {
    openDb().prepare('UPDATE leaf_resume SET merged=1, updatedAt=? WHERE leafId=?').run(now, leafId);
  } catch { /* best-effort */ }
}

/** Read a leaf's durable resume state (null if none). */
export function getLeafResume(project: string, leafId: string): LeafResumeRow | null {
  try {
    const r = openDb().prepare('SELECT * FROM leaf_resume WHERE leafId=? AND project=?').get(leafId, project) as
      | (LeafResumeEntry & { merged: number; updatedAt: number })
      | undefined;
    return r ? { ...r, merged: Boolean(r.merged) } : null;
  } catch { return null; }
}

/** Clear a leaf's durable resume state — call on any TERMINAL outcome (the run is
 *  done; a future claim is effectively fresh). Best-effort. */
export function clearLeafResume(leafId: string): void {
  try { openDb().prepare('DELETE FROM leaf_resume WHERE leafId=?').run(leafId); } catch { /* best-effort */ }
}

// --- G8 durable blueprint base SHA (leaf_blueprint) ---
/** Durable blueprint base SHA — survives terminal outcomes. Keyed by leafId.
 *  Written once per successful blueprint and cleared only when the leaf is genuinely done
 *  (accepted/merged). Used to reattach a blueprint when the run checkpoint was cleared
 *  by a terminal outcome but the blueprint itself is still valid. */
export interface LeafBlueprintRow {
  leafId: string;
  project: string;
  epicBaseSha: string | null;
  recordedAt: number;
  specJson: string | null;
  specRev: number | null;
  specSig: string | null;
}

/** Compute a stable signature (sha256 hash) of the leaf's specification: title, description,
 *  and sorted inheritedFiles. Used to detect when the spec has NOT changed despite an
 *  epic-base move, enabling reuse of the durable blueprint instead of re-authoring. */
export function leafSpecSignature(leaf: { title: string | null; description: string | null; inheritedFiles?: string[] | null }): string {
  const files = leaf.inheritedFiles ? [...leaf.inheritedFiles].sort() : [];
  const material = [leaf.title ?? '', leaf.description ?? '', ...files].join('\x00');
  return createHash('sha256').update(material).digest('hex');
}

/** Record or update the durable blueprint base SHA for a leaf. Upserts so a genuinely
 *  fresh re-blueprint against a new base overwrites the old base, never COALESCE.
 *  `specJson`/`specRev`/`specSig` are the exception: only overwritten when explicitly provided
 *  (undefined preserves the existing row); this lets non-editing callers
 *  (e.g. a re-blueprint on a new base SHA) keep passing only leafId/project/epicBaseSha
 *  without clobbering a human edit or prior signature. Best-effort. */
export function recordLeafBlueprint(
  e: { leafId: string; project: string; epicBaseSha?: string | null; specJson?: string | null; specRev?: number | null; specSig?: string | null },
  now: number = Date.now(),
): void {
  try {
    openDb().prepare(
      `INSERT INTO leaf_blueprint (leafId, project, epicBaseSha, recordedAt, specJson, specRev, specSig)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(leafId) DO UPDATE SET
         epicBaseSha=excluded.epicBaseSha, recordedAt=excluded.recordedAt,
         specJson=CASE WHEN ? THEN excluded.specJson ELSE leaf_blueprint.specJson END,
         specRev=CASE WHEN ? THEN excluded.specRev ELSE leaf_blueprint.specRev END,
         specSig=CASE WHEN ? THEN excluded.specSig ELSE leaf_blueprint.specSig END`,
    ).run(
      e.leafId, e.project, e.epicBaseSha ?? null, now,
      e.specJson ?? null, e.specRev ?? null, e.specSig ?? null,
      e.specJson !== undefined ? 1 : 0,
      e.specRev !== undefined ? 1 : 0,
      e.specSig !== undefined ? 1 : 0,
    );
  } catch { /* best-effort */ }
}

/** Read a leaf's durable blueprint base SHA (null if none). */
export function getLeafBlueprint(leafId: string): LeafBlueprintRow | null {
  try {
    const r = openDb().prepare('SELECT * FROM leaf_blueprint WHERE leafId=?').get(leafId) as LeafBlueprintRow | undefined;
    return r ?? null;
  } catch { return null; }
}

/** Clear a leaf's durable blueprint row — call when the leaf is genuinely done
 *  (accepted/merged). Best-effort. */
export function clearLeafBlueprint(leafId: string): void {
  try { openDb().prepare('DELETE FROM leaf_blueprint WHERE leafId=?').run(leafId); } catch { /* best-effort */ }
}

/** Reconstruct the blueprint prose a leaf should see: if an edited contract exists
 *  (leaf_blueprint.specJson non-null), splice it back into the base blueprint prose in
 *  place of the base contract's trailing json fence; otherwise (v1 leaves, or no row)
 *  return the raw successful blueprint output verbatim. Best-effort: any parse failure
 *  falls back to the verbatim base output, never throws. */
export function restoreEditableBlueprint(leafId: string): string | null {
  const base = getLatestSuccessfulNodeOutput(leafId, 'blueprint');
  const row = getLeafBlueprint(leafId);
  if (!row?.specJson) return base;
  try {
    const edited = parseDiffContract(row.specJson);
    if (!edited || base == null) return base;
    const fenceRe = /```json\s*[\s\S]*?```/;
    const rendered = renderContract(edited);
    return fenceRe.test(base) ? base.replace(fenceRe, rendered) : `${base}\n\n${rendered}`;
  } catch {
    return base;
  }
}

type ContractFieldMutation =
  | { target: 'filesToEdit'; file: string }
  | { target: 'task'; taskId: string; file: string };

/** Append a file path to a touchpoint array (filesToEdit or a task's files) on the leaf's
 *  editable contract — e.g. to legalize an incidental file the diff already touches.
 *  Seeds specJson from the base blueprint contract if no edit exists yet. Writes back with
 *  specRev bumped by 1. NEVER touches worker_ledger.outputText. Best-effort: returns false
 *  on any failure (no base contract, bad leaf, etc.), never throws. */
export function editContractField(
  leafId: string,
  mutation: ContractFieldMutation,
): boolean {
  try {
    const row = getLeafBlueprint(leafId);
    if (!row) return false;
    const seed = row.specJson
      ? parseDiffContract(row.specJson)
      : parseDiffContract(getLatestSuccessfulNodeOutput(leafId, 'blueprint') ?? undefined);
    if (!seed) return false;

    const contract: DiffContract = { ...seed };
    if (mutation.target === 'filesToEdit') {
      contract.filesToEdit = [...new Set([...contract.filesToEdit, mutation.file])];
    } else {
      const taskIdx = contract.tasks.findIndex((t) => t.id === mutation.taskId);
      if (taskIdx === -1) return false;
      const tasks = [...contract.tasks];
      tasks[taskIdx] = { ...tasks[taskIdx], files: [...new Set([...tasks[taskIdx].files, mutation.file])] };
      contract.tasks = tasks;
    }

    const nextRev = (row.specRev ?? 0) + 1;
    recordLeafBlueprint({ leafId, project: row.project, specJson: renderContract(contract), specRev: nextRev });
    return true;
  } catch {
    return false;
  }
}

/** Replace one entry in the leaf's editable contract's requirements[] (flip/replace a
 *  DiffRequirement cite) at the given index. Seeds from specJson or the base blueprint
 *  contract. Writes back with specRev bumped by 1. NEVER touches worker_ledger.outputText.
 *  Best-effort: returns false on any failure (bad index, no base contract), never throws. */
export function editLeafRequirement(
  leafId: string,
  index: number,
  replacement: DiffRequirement,
): boolean {
  try {
    const row = getLeafBlueprint(leafId);
    if (!row) return false;
    const seed = row.specJson
      ? parseDiffContract(row.specJson)
      : parseDiffContract(getLatestSuccessfulNodeOutput(leafId, 'blueprint') ?? undefined);
    if (!seed || index < 0 || index >= seed.requirements.length) return false;

    const requirements = [...seed.requirements];
    requirements[index] = replacement;
    const contract: DiffContract = { ...seed, requirements };

    const nextRev = (row.specRev ?? 0) + 1;
    recordLeafBlueprint({ leafId, project: row.project, specJson: renderContract(contract), specRev: nextRev });
    return true;
  } catch {
    return false;
  }
}

// --- G8 resume decision audit trail (leaf_resume_decision) ---
/** Resume decision record: mode/reason for the claim, anomaly detection, and inputs used. */
export interface LeafResumeDecisionRow {
  id?: number;
  leafId: string;
  project: string;
  mode: string;
  reason: string;
  hadResumeRow: boolean;
  hasBlueprintOutput: boolean;
  resumeBaseSha: string | null;
  currentEpicSha: string | null;
  anomaly: boolean;
  decidedAt: number;
}

/** Record a resume decision (mode/reason/anomaly). Append-only; one row per claim.
 *  Best-effort. */
export function recordLeafResumeDecision(
  d: Omit<LeafResumeDecisionRow, 'id' | 'decidedAt'>,
  now: number = Date.now(),
): void {
  try {
    openDb().prepare(
      `INSERT INTO leaf_resume_decision
        (leafId, project, mode, reason, hadResumeRow, hasBlueprintOutput, resumeBaseSha, currentEpicSha, anomaly, decidedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      d.leafId, d.project, d.mode, d.reason,
      d.hadResumeRow ? 1 : 0, d.hasBlueprintOutput ? 1 : 0,
      d.resumeBaseSha ?? null, d.currentEpicSha ?? null,
      d.anomaly ? 1 : 0,
      now,
    );
  } catch { /* best-effort */ }
}

/** Fetch all resume decisions for a leaf, ASC by decidedAt (oldest first). */
export function getLeafResumeDecisions(leafId: string): LeafResumeDecisionRow[] {
  try {
    const rows = openDb()
      .prepare('SELECT * FROM leaf_resume_decision WHERE leafId=? ORDER BY decidedAt ASC')
      .all(leafId) as Array<
      Omit<LeafResumeDecisionRow, 'hadResumeRow' | 'hasBlueprintOutput' | 'anomaly'> & {
        hadResumeRow: number;
        hasBlueprintOutput: number;
        anomaly: number;
      }
    >;
    return rows.map((r) => ({
      ...r,
      hadResumeRow: Boolean(r.hadResumeRow),
      hasBlueprintOutput: Boolean(r.hasBlueprintOutput),
      anomaly: Boolean(r.anomaly),
    }));
  } catch { return []; }
}

/** Most recent persisted output text for a leaf's node of the given kind (newest
 *  first), REGARDLESS of whether that node succeeded. FORENSICS ONLY — a timed-out /
 *  start-failed node's partial stdout is persisted here so a stuck leaf stays diagnosable.
 *  Do NOT use this to decide whether a reusable ARTIFACT exists (that is
 *  {@link getLatestSuccessfulNodeOutput}): a node can leave bytes without having produced a
 *  valid result (bug a8935a16 — a SessionStart-hook-hung blueprint persisted its raw stdout,
 *  which then falsely enabled reattach-blueprint of a plan that was never authored).
 *  Unlike getLeafRun this ignores run-gap scoping — the kill→re-claim gap (~lease) far exceeds
 *  the 2-min run gap. null if no such row. */
export function getLatestNodeOutput(leafId: string, nodeKind: string): string | null {
  try {
    const r = openDb().query(
      'SELECT outputText FROM worker_ledger WHERE leafId=? AND nodeKind=? AND outputText IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1',
    ).get(leafId, nodeKind) as { outputText?: string } | undefined;
    return r?.outputText ?? null;
  } catch { return null; }
}

/** Most recent output text for a leaf's node of the given kind that ACTUALLY SUCCEEDED —
 *  the artifact predicate (bug a8935a16). A node counts as succeeded only when it exited
 *  clean (exitCode=0) with NO parseError: a timed-out / start-failed / rate-limited node
 *  writes its raw stdout to `outputText` for forensics ({@link getLatestNodeOutput}) but that
 *  is NOT a usable artifact, so it must never enable reattach-blueprint. null if no SUCCEEDED
 *  row exists (caller falls back to re-running the node). */
export function getLatestSuccessfulNodeOutput(leafId: string, nodeKind: string): string | null {
  try {
    const r = openDb().query(
      'SELECT outputText FROM worker_ledger WHERE leafId=? AND nodeKind=? AND outputText IS NOT NULL ' +
      'AND exitCode = 0 AND parseError IS NULL ORDER BY ts DESC, id DESC LIMIT 1',
    ).get(leafId, nodeKind) as { outputText?: string } | undefined;
    return r?.outputText ?? null;
  } catch { return null; }
}

// --- G2 once-per-epic base gate cache (epic_base_gate) ------------------------
export interface EpicBaseGateRow {
  epicId: string;
  project: string;
  baseSha: string | null;
  status: 'pass' | 'fail' | 'error';
  command: string | null;
  output: string | null;
  checkedAt: number;
}

/** Upsert an epic's cached base-gate verdict. `output` is truncated to
 *  MAX_OUTPUT_CHARS on write. Best-effort: if the write throws, the next leaf simply
 *  re-runs the base gate — extra work, never a skipped gate. */
export function recordEpicBaseGate(e: Omit<EpicBaseGateRow, 'checkedAt'>, now: number = Date.now()): void {
  if (e.status === 'error') return; // an incident is not a base fact — never cached (see leaf-executor ensureBaseGreen)
  try {
    openDb().prepare(
      `INSERT INTO epic_base_gate (epicId, project, baseSha, status, command, output, checkedAt)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(epicId) DO UPDATE SET
         project=excluded.project, baseSha=excluded.baseSha, status=excluded.status,
         command=excluded.command, output=excluded.output, checkedAt=excluded.checkedAt`,
    ).run(
      e.epicId, e.project, e.baseSha ?? null, e.status, e.command ?? null,
      e.output == null ? null : e.output.slice(0, MAX_OUTPUT_CHARS),
      now,
    );
  } catch { /* best-effort */ }
}

/** Read an epic's cached base-gate verdict, valid ONLY for `currentBaseSha`.
 *
 *  The row is keyed on epicId alone (one execution per epic, not per leaf — see the DDL
 *  comment), but the verdict it holds is a fact about ONE base commit. When the epic's
 *  base moves (forward-integration, a master merge), the cached row describes a tree that
 *  no longer exists: a stale 'fail' would block every leaf on a base that may now be green,
 *  and — worse — a stale 'pass' would silently greenlight an UNEXAMINED base, which is the
 *  exact failure the G2 base gate exists to prevent.
 *
 *  So a baseSha mismatch is a cache MISS (null ⇒ caller re-runs the gate), not a verdict.
 *  A null/absent sha on either side is also a MISS: we cannot prove the row describes the
 *  base in hand, and re-running is the safe direction (extra work, never a skipped gate). */
export function getEpicBaseGate(epicId: string, currentBaseSha: string | null | undefined): EpicBaseGateRow | null {
  if (!currentBaseSha) return null;
  try {
    const r = openDb().prepare('SELECT * FROM epic_base_gate WHERE epicId=?').get(epicId) as EpicBaseGateRow | undefined;
    if (!r) return null;
    if (!r.baseSha || r.baseSha !== currentBaseSha) return null; // stale row ⇒ MISS, re-check
    return r;
  } catch { return null; }
}

// --- G10 land gate cache (epic_land_gate) --------------------------------
export interface EpicLandGateRow {
  epicId: string;
  project: string;
  epicTipSha: string | null;
  baseSha: string | null;
  status: 'pass' | 'fail' | 'abstain'; // error is NEVER cached
  result: string | null; // JSON EpicLandGateResult (output tails truncated)
  checkedAt: number;
}

/** Upsert an epic's cached land-gate verdict. `result` (JSON) is truncated to
 *  MAX_OUTPUT_CHARS on write. Never caches status='error' (incidents are not facts).
 *  Best-effort: cache write failure means an extra gate run. */
export function recordEpicLandGate(e: Omit<EpicLandGateRow, 'checkedAt'>, now: number = Date.now()): void {
  // Defensive: error status is never passed by runEpicLandGate (it short-circuits return)
  if ((e.status as any) === 'error') return;
  try {
    openDb().prepare(
      `INSERT INTO epic_land_gate (epicId, project, epicTipSha, baseSha, status, result, checkedAt)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(epicId) DO UPDATE SET
         project=excluded.project, epicTipSha=excluded.epicTipSha, baseSha=excluded.baseSha,
         status=excluded.status, result=excluded.result, checkedAt=excluded.checkedAt`,
    ).run(
      e.epicId, e.project, e.epicTipSha ?? null, e.baseSha ?? null, e.status,
      e.result == null ? null : e.result.slice(0, MAX_OUTPUT_CHARS),
      now,
    );
  } catch { /* best-effort */ }
}

/** Read an epic's cached land-gate verdict. Both shas must match for a hit.
 *  A null/absent sha on either side is a MISS (cannot prove the row describes
 *  the tree in hand; re-running is the safe direction). */
export function getEpicLandGate(epicId: string, epicTipSha: string | null | undefined, baseSha: string | null | undefined): EpicLandGateRow | null {
  if (!epicTipSha || !baseSha) return null;
  try {
    const r = openDb().prepare('SELECT * FROM epic_land_gate WHERE epicId=?').get(epicId) as EpicLandGateRow | undefined;
    if (!r) return null;
    if (!r.epicTipSha || r.epicTipSha !== epicTipSha) return null; // tip changed ⇒ MISS
    if (!r.baseSha || r.baseSha !== baseSha) return null; // base changed ⇒ MISS
    return r;
  } catch { return null; }
}

/** List currently-running leaves (newest-started first). Optional project filter. */
export function listLeafInflight(opts: { project?: string } = {}): InflightRow[] {
  try {
    const d = openDb();
    const sql = `SELECT * FROM leaf_inflight${opts.project ? ' WHERE project = ?' : ''} ORDER BY startedAt DESC`;
    return d.query(sql).all(...((opts.project ? [opts.project] : []) as never[])) as InflightRow[];
  } catch { return []; }
}

/** Query raw ledger rows (newest first), filtered by project/todo/time. */
export function queryLedger(q: LedgerQuery = {}): LedgerRow[] {
  const d = openDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.project) { where.push('project = ?'); params.push(q.project); }
  if (q.todoId) { where.push('todoId = ?'); params.push(q.todoId); }
  if (q.epicId) { where.push('epicId = ?'); params.push(q.epicId); }
  if (q.leafId) { where.push('leafId = ?'); params.push(q.leafId); }
  if (q.since != null) { where.push('ts >= ?'); params.push(q.since); }
  const limit = Math.min(Math.max(1, q.limit ?? 200), 2000);
  const sql = `SELECT * FROM worker_ledger${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC, id DESC LIMIT ${limit}`;
  return (d.query(sql).all(...(params as never[])) as LedgerRow[]).map(rowToEntry);
}

/** One source's aggregated spend over a window — the burn gauge's row shape. Uncapped SQL
 *  GROUP BY (unlike `summarize`, which is limited to the newest 2000 rows), so a busy window is
 *  counted accurately. `source` is the pass/caller tag ('conductor' | 'summary' | 'triage' | … ). */
export interface SourceBurnRow {
  source: string;
  /** Number of ledgered LLM calls from this source in the window (the plan-independent signal —
   *  always meaningful even on the Max plan where costUsd is 0). */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Σ recorded costUsd. On the subscription plan this is ~0 (the CLI omits total_cost_usd) — the
   *  burn gauge estimates a USD figure from tokens × price table on top of this. */
  costUsd: number;
}

/** Aggregate spend GROUPED BY source over an optional project + time window. Uncapped. The single
 *  read behind the burn gauge and the leak alarm. */
export function burnBySource(q: { project?: string; since?: number } = {}): SourceBurnRow[] {
  const d = openDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.project) { where.push('project = ?'); params.push(q.project); }
  if (q.since != null) { where.push('ts >= ?'); params.push(q.since); }
  const sql =
    `SELECT source,
            COUNT(*) AS calls,
            COALESCE(SUM(inputTokens),0) AS inputTokens,
            COALESCE(SUM(outputTokens),0) AS outputTokens,
            COALESCE(SUM(cacheReadTokens),0) AS cacheReadTokens,
            COALESCE(SUM(cacheCreationTokens),0) AS cacheCreationTokens,
            COALESCE(SUM(costUsd),0) AS costUsd
       FROM worker_ledger${where.length ? ' WHERE ' + where.join(' AND ') : ''}
      GROUP BY source
      ORDER BY calls DESC`;
  return d.query(sql).all(...(params as never[])) as SourceBurnRow[];
}

export interface LedgerSummary {
  rows: number;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache READ tokens (hits) — the bulk of real input throughput on the Max plan. */
  cacheReadTokens: number;
  /** Prompt-cache CREATION tokens (writes) — the cross-node-spawn cost surface. */
  cacheCreationTokens: number;
  byPhase: Record<string, { rows: number; usd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }>;
  byModel: Record<string, { rows: number; usd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; unknownPrice?: boolean }>;
}

/** Aggregate summary (per-phase + per-model cost roll-up) for a project and/or todo —
 *  what makes the tier matrix tunable on real cost-per-completion. */
export function summarize(q: LedgerQuery = {}): LedgerSummary {
  const rows = queryLedger({ ...q, limit: 2000 });
  const s: LedgerSummary = { rows: rows.length, totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, byPhase: {}, byModel: {} };
  for (const r of rows) {
    const cr = r.cacheReadTokens ?? 0;
    const cc = r.cacheCreationTokens ?? 0;
    s.totalUsd += r.costUsd;
    s.inputTokens += r.inputTokens;
    s.outputTokens += r.outputTokens;
    s.cacheReadTokens += cr;
    s.cacheCreationTokens += cc;
    const p = (s.byPhase[r.phase] ??= { rows: 0, usd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    p.rows += 1; p.usd += r.costUsd; p.inputTokens += r.inputTokens; p.outputTokens += r.outputTokens; p.cacheReadTokens += cr; p.cacheCreationTokens += cc;
    const m = (s.byModel[r.model] ??= { rows: 0, usd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    m.rows += 1; m.usd += r.costUsd; m.inputTokens += r.inputTokens; m.outputTokens += r.outputTokens; m.cacheReadTokens += cr; m.cacheCreationTokens += cc;
    if (!r.knownPrice) m.unknownPrice = true;
  }
  return s;
}
