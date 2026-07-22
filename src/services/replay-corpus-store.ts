import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT gate-evaluation replay corpus (SEAM·collab — crit-5 citability).
 *
 * Siblings in crit-5 need to replay G3 / citability gate decisions across attempts.
 * This store persists gate-evaluation records so reviewers can cite prior verdicts
 * and reconstruct why a leaf was accepted or parked.
 */

export type ReplayGate = 'g3' | 'citability' | 'blueprint-budget';

export interface GateEval {
  id: string;
  leafId: string;
  project: string;
  gate: ReplayGate;
  inputText: string;
  changeSet: string[];
  verdict: string;
  reasons: string;
  override: string | null;
  createdAt: number;
}

export interface RecordGateEvalInput {
  leafId: string;
  gate: ReplayGate;
  inputText: string;
  changeSet: string[];
  verdict: string;
  reasons: string;
}

export interface GateEvalFilter {
  leafId?: string;
  gate?: ReplayGate;
}

const DDL = `
CREATE TABLE IF NOT EXISTS replay_gate_eval (
  id TEXT PRIMARY KEY,
  leafId TEXT NOT NULL,
  project TEXT NOT NULL,
  gate TEXT NOT NULL,
  inputText TEXT NOT NULL,
  changeSet TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reasons TEXT NOT NULL,
  override TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replay_leaf ON replay_gate_eval(leafId);
CREATE INDEX IF NOT EXISTS idx_replay_gate ON replay_gate_eval(gate);
`;

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'replay-corpus.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);

  // Migration: add override column if missing (idempotent once present).
  const cols = db.prepare(`PRAGMA table_info(replay_gate_eval)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'override')) {
    db.exec(`ALTER TABLE replay_gate_eval ADD COLUMN override TEXT`);
  }
  db.exec(DDL); // ensure indexes after any migration

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

/** For tests: expose cache identity. */
export function _openDbForTest(project: string): Database {
  return openDb(project);
}

// Per-project serialized write lock (mirrors todo-store.ts).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

function rowToEval(row: any): GateEval {
  return {
    id: row.id,
    leafId: row.leafId,
    project: row.project,
    gate: row.gate as ReplayGate,
    inputText: row.inputText,
    changeSet: JSON.parse(row.changeSet) as string[],
    verdict: row.verdict,
    reasons: row.reasons,
    override: row.override ?? null,
    createdAt: row.createdAt,
  };
}

export function recordGateEval(project: string, input: RecordGateEvalInput): Promise<GateEval> {
  return withLock(project, () => {
    const db = openDb(project);
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO replay_gate_eval (id, leafId, project, gate, inputText, changeSet, verdict, reasons, override, createdAt)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      input.leafId,
      project,
      input.gate,
      input.inputText,
      JSON.stringify(input.changeSet ?? []),
      input.verdict,
      input.reasons,
      null,
      createdAt,
    );
    return rowToEval(db.prepare('SELECT * FROM replay_gate_eval WHERE id = ?').get(id));
  });
}

export function listGateEvals(project: string, filter: GateEvalFilter = {}): GateEval[] {
  const db = openDb(project);
  const where: string[] = [];
  const params: string[] = [];
  if (filter.leafId) { where.push('leafId = ?'); params.push(filter.leafId); }
  if (filter.gate) { where.push('gate = ?'); params.push(filter.gate); }
  const sql = `SELECT * FROM replay_gate_eval${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt DESC, rowid DESC`;
  return (db.prepare(sql).all(...params) as any[]).map(rowToEval);
}

export function setOverride(project: string, leafId: string, override: string): Promise<void> {
  return withLock(project, () => {
    const db = openDb(project);
    db.prepare('UPDATE replay_gate_eval SET override = ? WHERE leafId = ?').run(override, leafId);
  });
}
