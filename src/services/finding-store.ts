import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Per-PROJECT finding store (SEAM·collab — quarantine repro finding persistence).
 *
 * Quarantine specs commit reproducible failures on purpose (see services/quarantine.ts).
 * This store persists typed findings from those specs: which claim is violated,
 * what paths are implicated, what test output reproduced it, and a dedup identity
 * for the failure across re-runs (for recurrence tracking and dedup).
 */

export interface Finding {
  id: string;
  todoId: string;
  violatedClaim: string;
  implicatedFiles: string[];
  ruledOut: string[];
  reproPath: string;
  failureIdentity: string | null;
  surface: string | null;
  sourceLeafId: string | null;
  recurrenceCount: number;
  createdAt: string;
  lastSeenAt: string;
}

export interface RecordFindingInput {
  todoId: string;
  violatedClaim: string;
  implicatedFiles?: string[];
  ruledOut?: string[];
  reproPath: string;
  failureIdentity?: string | null;
  surface?: string | null;
  sourceLeafId?: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS finding (
  id TEXT PRIMARY KEY,
  todoId TEXT NOT NULL,
  violatedClaim TEXT NOT NULL,
  implicatedFiles TEXT,
  ruledOut TEXT,
  reproPath TEXT NOT NULL,
  failureIdentity TEXT,
  surface TEXT,
  sourceLeafId TEXT,
  recurrenceCount INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  lastSeenAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finding_todo ON finding(todoId);
CREATE INDEX IF NOT EXISTS idx_finding_failureIdentity ON finding(failureIdentity);
`;

const dbCache = new Map<string, Database>();

function addColumnIfMissing(db: Database, table: string, col: string, ddl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

function openDb(project: string): Database {
  const cached = dbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'findings.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  addColumnIfMissing(db, 'finding', 'sourceLeafId', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_finding_sourceLeaf ON finding(sourceLeafId)');

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

// Per-project serialized write lock (mirrors friction-store.ts).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  locks.set(project, next.catch(() => {}));
  return next;
}

const nowIso = () => new Date().toISOString();

/** Convert a database row to a Finding, parsing JSON array columns. */
function rowToFinding(row: any): Finding {
  return {
    id: row.id,
    todoId: row.todoId,
    violatedClaim: row.violatedClaim,
    implicatedFiles: JSON.parse(row.implicatedFiles ?? '[]') as string[],
    ruledOut: JSON.parse(row.ruledOut ?? '[]') as string[],
    reproPath: row.reproPath,
    failureIdentity: row.failureIdentity ?? null,
    surface: row.surface ?? null,
    sourceLeafId: row.sourceLeafId ?? null,
    recurrenceCount: row.recurrenceCount,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/** Persist a typed finding row. Validates required fields. Returns the stored finding. */
export function recordFinding(project: string, input: RecordFindingInput): Promise<Finding> {
  return withLock(project, () => {
    if (!input.todoId?.trim()) throw new Error('recordFinding: todoId is required');
    if (!input.violatedClaim?.trim()) throw new Error('recordFinding: violatedClaim is required');
    if (!input.reproPath?.trim()) throw new Error('recordFinding: reproPath is required');

    const db = openDb(project);
    const id = crypto.randomUUID();
    const ts = nowIso();

    db.prepare(
      `INSERT INTO finding (id, todoId, violatedClaim, implicatedFiles, ruledOut, reproPath, failureIdentity, surface, sourceLeafId, createdAt, lastSeenAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      input.todoId,
      input.violatedClaim,
      JSON.stringify(input.implicatedFiles ?? []),
      JSON.stringify(input.ruledOut ?? []),
      input.reproPath,
      input.failureIdentity ?? null,
      input.surface ?? null,
      input.sourceLeafId ?? null,
      ts,
      ts,
    );

    return rowToFinding(db.prepare('SELECT * FROM finding WHERE id = ?').get(id));
  });
}

/** Retrieve a finding by id, or null if not found. */
export function getFinding(project: string, id: string): Promise<Finding | null> {
  const db = openDb(project);
  const row = db.prepare('SELECT * FROM finding WHERE id = ?').get(id) as any;
  return Promise.resolve(row ? rowToFinding(row) : null);
}

/** Retrieve a finding by todoId, or null if not found. */
export function getFindingByTodoId(project: string, todoId: string): Promise<Finding | null> {
  const db = openDb(project);
  const row = db.prepare('SELECT * FROM finding WHERE todoId = ?').get(todoId) as any;
  return Promise.resolve(row ? rowToFinding(row) : null);
}

/** List all findings in the project. */
export function listFindings(project: string): Promise<Finding[]> {
  const db = openDb(project);
  const rows = db.prepare('SELECT * FROM finding ORDER BY createdAt DESC, rowid DESC').all() as any[];
  return Promise.resolve(rows.map(rowToFinding));
}

/** Find all findings by failure identity. Returns array because recurrence dedup is the
 *  caller's job — more than one row can share an identity before a caller collapses them. */
export function findByFailureIdentity(project: string, identity: string): Promise<Finding[]> {
  const db = openDb(project);
  const rows = db.prepare('SELECT * FROM finding WHERE failureIdentity = ? ORDER BY createdAt DESC, rowid DESC').all(identity) as any[];
  return Promise.resolve(rows.map(rowToFinding));
}

/** Find all findings by source leaf id. Returns array ordered by recency. */
export function findBySourceLeafId(project: string, leafId: string): Promise<Finding[]> {
  const db = openDb(project);
  const rows = db.prepare('SELECT * FROM finding WHERE sourceLeafId = ? ORDER BY createdAt DESC, rowid DESC').all(leafId) as any[];
  return Promise.resolve(rows.map(rowToFinding));
}

/** Increment the recurrence count for an existing finding. Throws if no row matched. */
export function bumpRecurrence(project: string, id: string, now: string): Promise<Finding> {
  return withLock(project, () => {
    const db = openDb(project);
    const result = db.prepare('UPDATE finding SET recurrenceCount = recurrenceCount + 1, lastSeenAt = ? WHERE id = ?').run(now, id);
    if (result.changes === 0) {
      throw new Error(`bumpRecurrence: no finding with id ${id} (nothing was written)`);
    }
    const row = db.prepare('SELECT * FROM finding WHERE id = ?').get(id) as any;
    return rowToFinding(row);
  });
}
