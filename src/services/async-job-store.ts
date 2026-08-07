import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { trackingProjectRoot } from './project-registry.js';

/**
 * Per-PROJECT durable async-job store. Tracks background work (forge-mission, land-epic)
 * with boot-id-based crash recovery. A CURRENT_BOOT_ID is generated once at import time;
 * on server restart, a new id is minted and stale jobs (from a prior boot) are swept and
 * failed with an escalation.
 *
 * Mirrors the bun:sqlite-per-project pattern used by epic-land-record-store.ts: one DB
 * file per project under `.collab`, WAL journal mode, and a Map-based connection cache
 * keyed on the TRACKING repo root.
 */

export interface AsyncJobRow {
  id: string;
  project: string;
  kind: 'forge-mission' | 'land-epic';
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  targetId: string | null;
  error: string | null;
  bootId: string;
  pid: number;
  createdAt: number;
  updatedAt: number;
  resultJson: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS async_job (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  targetId TEXT,
  error TEXT,
  bootId TEXT NOT NULL,
  pid INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  resultJson TEXT
);
`;

const dbCache = new Map<string, Database>();

export function addColumnIfMissing(db: Database, table: string, col: string, ddl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

function openDb(project: string): Database {
  const root = trackingProjectRoot(project);
  const cached = dbCache.get(root);
  if (cached) return cached;
  const path = join(root, '.collab', 'async-job.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  dbCache.set(root, db);
  return db;
}

/** Boot-id set exactly once at import time. Every server instance gets a unique id;
 *  on restart, jobs from a prior boot are identified by a different bootId and can be
 *  swept as stale. */
export const CURRENT_BOOT_ID = randomUUID();

export function createJob(
  project: string,
  opts: {
    kind: 'forge-mission' | 'land-epic';
    targetId?: string | null;
  },
): AsyncJobRow {
  const db = openDb(project);
  const id = randomUUID();
  const now = Date.now();
  const targetId = opts.targetId ?? null;

  db.prepare(
    `INSERT INTO async_job (id, project, kind, status, targetId, error, bootId, pid, createdAt, updatedAt, resultJson)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, project, opts.kind, 'pending', targetId, null, CURRENT_BOOT_ID, process.pid, now, now, null);

  return {
    id,
    project,
    kind: opts.kind,
    status: 'pending',
    targetId,
    error: null,
    bootId: CURRENT_BOOT_ID,
    pid: process.pid,
    createdAt: now,
    updatedAt: now,
    resultJson: null,
  };
}

export function markJobRunning(project: string, id: string): AsyncJobRow | null {
  const db = openDb(project);
  const now = Date.now();
  db.prepare(`UPDATE async_job SET status = ?, updatedAt = ? WHERE id = ?`).run('running', now, id);
  return (db.query('SELECT * FROM async_job WHERE id = ?').get(id) as AsyncJobRow) ?? null;
}

export function markJobSucceeded(project: string, id: string, resultJson?: string | null): AsyncJobRow | null {
  const db = openDb(project);
  const now = Date.now();
  db.prepare(`UPDATE async_job SET status = ?, updatedAt = ?, resultJson = ? WHERE id = ?`).run(
    'succeeded',
    now,
    resultJson ?? null,
    id,
  );
  return (db.query('SELECT * FROM async_job WHERE id = ?').get(id) as AsyncJobRow) ?? null;
}

export function markJobFailed(project: string, id: string, error: string): AsyncJobRow | null {
  const db = openDb(project);
  const now = Date.now();
  db.prepare(`UPDATE async_job SET status = ?, updatedAt = ?, error = ? WHERE id = ?`).run('failed', now, error, id);
  return (db.query('SELECT * FROM async_job WHERE id = ?').get(id) as AsyncJobRow) ?? null;
}

export function getJob(project: string, id: string): AsyncJobRow | null {
  const db = openDb(project);
  return (db.query('SELECT * FROM async_job WHERE id = ?').get(id) as AsyncJobRow) ?? null;
}

export function listJobs(
  project: string,
  filter?: {
    status?: 'pending' | 'running' | 'succeeded' | 'failed';
    kind?: 'forge-mission' | 'land-epic';
  },
): AsyncJobRow[] {
  const db = openDb(project);
  if (!filter || (!filter.status && !filter.kind)) {
    return db.query('SELECT * FROM async_job').all() as AsyncJobRow[];
  }

  if (filter.status && filter.kind) {
    return (db.query('SELECT * FROM async_job WHERE status = ? AND kind = ?').all(filter.status, filter.kind) as AsyncJobRow[]);
  }
  if (filter.status) {
    return (db.query('SELECT * FROM async_job WHERE status = ?').all(filter.status) as AsyncJobRow[]);
  }
  return (db.query('SELECT * FROM async_job WHERE kind = ?').all(filter.kind!) as AsyncJobRow[]);
}

/** Drop a possibly-stale cached handle (test isolation / after a rebuild). */
export function _resetAsyncJobDbCache(project?: string): void {
  if (project) {
    dbCache.get(project)?.close();
    dbCache.delete(project);
  } else {
    for (const db of dbCache.values()) db.close();
    dbCache.clear();
  }
}

/**
 * Sweep stale async jobs from a prior boot and transition them to failed status,
 * raising a conditionKey-deduped escalation for each. Only jobs whose bootId differs
 * from CURRENT_BOOT_ID (i.e., from a previous server instance) are touched.
 *
 * Returns the list of rows that were transitioned.
 */
export async function recoverStaleJobs(project: string): Promise<{ recovered: AsyncJobRow[] }> {
  const db = openDb(project);

  // Find all pending/running jobs from a stale boot (not the current one).
  const staleRows = db
    .query(
      `SELECT * FROM async_job
       WHERE status IN ('pending', 'running') AND bootId != ?`,
    )
    .all(CURRENT_BOOT_ID) as AsyncJobRow[];

  const recovered: AsyncJobRow[] = [];

  for (const row of staleRows) {
    const now = Date.now();
    const error = 'interrupted by server restart';

    // Transition to failed.
    db.prepare(`UPDATE async_job SET status = ?, updatedAt = ?, error = ? WHERE id = ?`).run('failed', now, error, row.id);

    const updated = db.query('SELECT * FROM async_job WHERE id = ?').get(row.id) as AsyncJobRow;
    if (updated) recovered.push(updated);

    // Raise an escalation with conditionKey dedup.
    try {
      const { createEscalation } = await import('./supervisor-store.js');
      const questionText = `Async job ${row.kind}${row.targetId ? ` (target ${row.targetId})` : ''} was interrupted by a server restart.`;
      createEscalation({
        project,
        session: 'daemon',
        kind: 'async-job-interrupted',
        questionText,
        audience: 'human',
        conditionKey: `async-job:${row.id}`,
        todoId: row.targetId ?? null,
      });
    } catch (err) {
      console.error(
        `mermaid-collab: async-job recovery escalation failed for ${row.id} —`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { recovered };
}
