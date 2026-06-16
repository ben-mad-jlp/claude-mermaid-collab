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
`;

let db: Database | null = null;

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
  // Additive migration: P4a R1 verdict/outcome write-back (idempotent, nullable).
  add('verdict', 'TEXT'); // 'pass'|'fail'|null (review node)
  add('leafOutcome', 'TEXT'); // 'accepted'|'blocked'|'rejected'|'paused'|null (terminal)
  add('outputText', 'TEXT'); // node's final output text (diagnostic + UI source)
  add('outcomeDetail', 'TEXT'); // atomic terminal record (JSON) on the outcome marker row
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
    startedAt INTEGER NOT NULL
  )`);
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
          (project, todoId, epicId, session, phase, provider, model, source, inputTokens, outputTokens, costUsd, knownPrice, steps, parseError,
           nodeKind, nodesSpent, authMode, exitCode, durationMs, rateLimited, leafId, verdict, leafOutcome, outputText, outcomeDetail, ts)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?, ?)`,
      )
      .run(
        entry.project, entry.todoId, entry.epicId ?? null, entry.session, entry.phase, entry.provider, entry.model, entry.source,
        entry.inputTokens, entry.outputTokens, entry.costUsd, entry.knownPrice ? 1 : 0, entry.steps,
        entry.parseError ?? null,
        entry.nodeKind ?? null, entry.nodesSpent ?? null, entry.authMode ?? null, entry.exitCode ?? null,
        entry.durationMs ?? null, entry.rateLimited == null ? null : entry.rateLimited ? 1 : 0, entry.leafId ?? null,
        entry.verdict ?? null, entry.leafOutcome ?? null,
        entry.outputText == null ? null : entry.outputText.slice(0, MAX_OUTPUT_CHARS),
        entry.outcomeDetail ?? null,
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
      `INSERT INTO leaf_inflight (leafId, project, epicId, nodeKind, model, attempt, startedAt)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(leafId) DO UPDATE SET
         project=excluded.project, epicId=excluded.epicId, nodeKind=excluded.nodeKind,
         model=excluded.model, attempt=excluded.attempt, startedAt=excluded.startedAt`,
    ).run(e.leafId, e.project, e.epicId ?? null, e.nodeKind ?? null, e.model ?? null, e.attempt ?? null, now);
  } catch { /* telemetry — never break the run */ }
}

/** Clear a leaf's in-flight row (node finished / leaf terminal). Best-effort. */
export function clearLeafInflight(leafId: string): void {
  try { openDb().prepare('DELETE FROM leaf_inflight WHERE leafId = ?').run(leafId); } catch { /* best-effort */ }
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

export interface LedgerSummary {
  rows: number;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  byPhase: Record<string, { rows: number; usd: number; inputTokens: number; outputTokens: number }>;
  byModel: Record<string, { rows: number; usd: number; inputTokens: number; outputTokens: number; unknownPrice?: boolean }>;
}

/** Aggregate summary (per-phase + per-model cost roll-up) for a project and/or todo —
 *  what makes the tier matrix tunable on real cost-per-completion. */
export function summarize(q: LedgerQuery = {}): LedgerSummary {
  const rows = queryLedger({ ...q, limit: 2000 });
  const s: LedgerSummary = { rows: rows.length, totalUsd: 0, inputTokens: 0, outputTokens: 0, byPhase: {}, byModel: {} };
  for (const r of rows) {
    s.totalUsd += r.costUsd;
    s.inputTokens += r.inputTokens;
    s.outputTokens += r.outputTokens;
    const p = (s.byPhase[r.phase] ??= { rows: 0, usd: 0, inputTokens: 0, outputTokens: 0 });
    p.rows += 1; p.usd += r.costUsd; p.inputTokens += r.inputTokens; p.outputTokens += r.outputTokens;
    const m = (s.byModel[r.model] ??= { rows: 0, usd: 0, inputTokens: 0, outputTokens: 0 });
    m.rows += 1; m.usd += r.costUsd; m.inputTokens += r.inputTokens; m.outputTokens += r.outputTokens;
    if (!r.knownPrice) m.unknownPrice = true;
  }
  return s;
}
