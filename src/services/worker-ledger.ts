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
}

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
          (project, todoId, epicId, session, phase, provider, model, source, inputTokens, outputTokens, costUsd, knownPrice, steps, parseError, ts)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        entry.project, entry.todoId, entry.epicId ?? null, entry.session, entry.phase, entry.provider, entry.model, entry.source,
        entry.inputTokens, entry.outputTokens, entry.costUsd, entry.knownPrice ? 1 : 0, entry.steps,
        entry.parseError ?? null, now,
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
  /** Only rows at/after this epoch-ms. */
  since?: number;
  /** Cap rows returned (default 200, max 2000), newest first. */
  limit?: number;
}

function rowToEntry(r: LedgerRow): LedgerRow {
  return { ...r, knownPrice: Boolean(r.knownPrice) };
}

/** Query raw ledger rows (newest first), filtered by project/todo/time. */
export function queryLedger(q: LedgerQuery = {}): LedgerRow[] {
  const d = openDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.project) { where.push('project = ?'); params.push(q.project); }
  if (q.todoId) { where.push('todoId = ?'); params.push(q.todoId); }
  if (q.epicId) { where.push('epicId = ?'); params.push(q.epicId); }
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
