/**
 * conductor_pass journal — a durable per-pass record of what a conductor pass did:
 * which fingerprints it saw, which arm it took, which criteria it acted on, what it
 * filed/declined, and how it ended. Lives beside worker-ledger.db under
 * MERMAID_SUPERVISOR_DIR. Modeled on criterion-approach-store.ts's connection and
 * fail-open discipline. Standalone module — nothing wires into it yet.
 */
import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type ConductorPassArm = 'infra' | 'redecompose' | 'verify-panel' | 'test-only-close' | 'land' | 'node' | 'none';

export interface ConductorPassJournalRow {
  id: string;
  project: string;
  missionId: string | null;
  startedAt: number;
  endedAt: number | null;
  serveFp: string | null;
  passFp: string | null;
  selfFp: string | null;
  arm: ConductorPassArm | null;
  criteriaActed: Array<{ criterionId: string; action: string }>;
  filed: unknown;
  declined: Array<{ what: string; why: string }>;
  outcome: string | null;
  ran: boolean | null;
  /** Whether a 'node-failed' outcome on this row is a genuine, countable attempt (a real node
   *  ran and made no progress) vs a transient fault (rateLimited/startFailure/timedOut) that
   *  must never consume the bounded retry counter. null on rows where the distinction doesn't
   *  apply (debounced/productive/etc.). */
  failCounted: boolean | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS conductor_pass (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  missionId TEXT,
  startedAt INTEGER NOT NULL,
  endedAt INTEGER,
  serveFp TEXT,
  passFp TEXT,
  selfFp TEXT,
  arm TEXT,
  criteriaActed TEXT,
  filed TEXT,
  declined TEXT,
  outcome TEXT,
  ran INTEGER,
  failCounted INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conductor_pass_lookup ON conductor_pass (project, missionId, startedAt);
`;

let db: Database | null = null;

function openDb(): Database {
  if (db) return db;
  const dir = process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  db = new Database(join(dir, 'worker-ledger.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeConductorJournalDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** Open an in-flight pass row. Returns the new id, or null on throw. */
export function openPassRow(project: string, missionId: string | null, startedAt: number): string | null {
  try {
    const id = crypto.randomUUID();
    const d = openDb();
    d.prepare(
      `INSERT INTO conductor_pass (id, project, missionId, startedAt, endedAt, serveFp, passFp, selfFp, arm, criteriaActed, filed, declined, outcome, ran, failCounted)
       VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,?,NULL,?,NULL,NULL,NULL)`,
    ).run(id, project, missionId, startedAt, JSON.stringify([]), JSON.stringify([]));
    return id;
  } catch {
    return null;
  }
}

type JsonPatchKey = 'criteriaActed' | 'filed' | 'declined';
const JSON_PATCH_KEYS: JsonPatchKey[] = ['criteriaActed', 'filed', 'declined'];
type ScalarPatchKey = 'missionId' | 'serveFp' | 'passFp' | 'selfFp' | 'arm';
const SCALAR_PATCH_KEYS: ScalarPatchKey[] = ['missionId', 'serveFp', 'passFp', 'selfFp', 'arm'];
type BoolPatchKey = 'failCounted';
const BOOL_PATCH_KEYS: BoolPatchKey[] = ['failCounted'];

function buildProgressSet(patch: Partial<Pick<ConductorPassJournalRow, ScalarPatchKey | JsonPatchKey | BoolPatchKey>>): {
  clauses: string[];
  values: (string | number | null)[];
} {
  const clauses: string[] = [];
  const values: (string | number | null)[] = [];
  for (const key of SCALAR_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      values.push(patch[key] ?? null);
    }
  }
  for (const key of BOOL_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      const v = patch[key];
      values.push(v == null ? null : v ? 1 : 0);
    }
  }
  for (const key of JSON_PATCH_KEYS) {
    if (patch[key] !== undefined) {
      clauses.push(`${key}=?`);
      values.push(JSON.stringify(patch[key] ?? null));
    }
  }
  return { clauses, values };
}

/** Update partial mid-pass fields without touching endedAt/outcome/ran, so a killed pass
 *  still shows its partial progress. Returns whether a row was updated, false on throw. */
export function appendPassProgress(
  id: string,
  patch: Partial<Pick<ConductorPassJournalRow, ScalarPatchKey | JsonPatchKey | BoolPatchKey>>,
): boolean {
  try {
    const { clauses, values } = buildProgressSet(patch);
    if (clauses.length === 0) return false;
    const d = openDb();
    const result = d.prepare(`UPDATE conductor_pass SET ${clauses.join(', ')} WHERE id=?`).run(...values, id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

/** Stamp endedAt/outcome/ran and any other patched fields. Returns whether a row was
 *  updated, false on throw. */
export function finalizePassRow(
  id: string,
  patch: Partial<Omit<ConductorPassJournalRow, 'id' | 'project' | 'startedAt'>>,
): boolean {
  try {
    const { clauses, values } = buildProgressSet(patch);
    clauses.push('endedAt=?');
    values.push(patch.endedAt ?? Date.now());
    clauses.push('outcome=?');
    values.push(patch.outcome ?? null);
    clauses.push('ran=?');
    values.push(patch.ran == null ? null : patch.ran ? 1 : 0);
    const d = openDb();
    const result = d.prepare(`UPDATE conductor_pass SET ${clauses.join(', ')} WHERE id=?`).run(...values, id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

function parseJsonArray(text: string | null, fallback: unknown[]): any {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function parseJsonValue(text: string | null): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function rowFromRaw(r: any): ConductorPassJournalRow {
  return {
    id: r.id,
    project: r.project,
    missionId: r.missionId ?? null,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
    serveFp: r.serveFp ?? null,
    passFp: r.passFp ?? null,
    selfFp: r.selfFp ?? null,
    arm: r.arm ?? null,
    criteriaActed: parseJsonArray(r.criteriaActed, []),
    filed: parseJsonValue(r.filed),
    declined: parseJsonArray(r.declined, []),
    outcome: r.outcome ?? null,
    ran: r.ran == null ? null : r.ran === 1,
    failCounted: r.failCounted == null ? null : r.failCounted === 1,
  };
}

/** List conductor passes for a project, newest-first. Returns [] on throw. */
export function listConductorPasses(project: string, opts?: { missionId?: string; limit?: number }): ConductorPassJournalRow[] {
  try {
    const d = openDb();
    let sql = `SELECT * FROM conductor_pass WHERE project=?`;
    const params: (string | number)[] = [project];
    if (opts?.missionId !== undefined) {
      sql += ` AND missionId=?`;
      params.push(opts.missionId);
    }
    sql += ` ORDER BY startedAt DESC`;
    if (opts?.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(opts.limit);
    }
    const rows = d.query(sql).all(...params) as Array<any>;
    return rows.map(rowFromRaw);
  } catch {
    return [];
  }
}

/** Derive the contiguous run of node-failed passes for (project, missionId, serveFp),
 *  walking newest-first and stopping at the first non-matching row. Returns 0 on throw. */
export function countConsecutiveFailedPasses(
  project: string,
  missionId: string,
  serveFp: string,
  excludeId?: string | null,
): number {
  try {
    const rows = listConductorPasses(project, { missionId });
    let count = 0;
    for (const row of rows) {
      if (row.id === excludeId) continue;
      if (row.endedAt === null) break;
      if (row.serveFp !== serveFp) break;
      // A row with ran!==true represents no real attempt this tick (e.g. a debounced early
      // return, or a fail-open cap arm) — it carries the serveFp it saw but never spent a node,
      // so it is transparent to the walk: skip it without breaking the contiguous run.
      if (row.ran !== true) continue;
      if (row.outcome !== 'node-failed') break;
      if (row.failCounted === false) continue;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/** Return the most recent finalized, productive (outcome:'conducted', ran:true) pass's
 *  fingerprints, walking newest-first and skipping any other row. Returns null on throw
 *  or if no such row exists. */
export function latestProductivePassFp(
  project: string,
  missionId: string,
): { passFp: string | null; selfFp: string | null } | null {
  try {
    const rows = listConductorPasses(project, { missionId });
    for (const row of rows) {
      if (row.endedAt !== null && row.outcome === 'conducted' && row.ran === true) {
        return { passFp: row.passFp, selfFp: row.selfFp };
      }
    }
    return null;
  } catch {
    return null;
  }
}
