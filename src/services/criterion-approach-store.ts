/**
 * criterion_approach store — the durable per-criterion ladder state recording which
 * rung of the "unstick a stalled criterion" ladder has already been attempted.
 * One row per (criterionId, rung, epicId) with an ON CONFLICT UPDATE semantic for
 * idempotence (a conductor pass re-running each tick must not grow the ladder).
 * Lives beside worker-ledger.db under MERMAID_SUPERVISOR_DIR.
 *
 * The ladderExhausted() function is a PURE derivation (no DB access, deterministic)
 * that answers whether the ladder is exhausted — callable from hot paths and unit-testable.
 */
import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CRITERION_SERVE_CAP } from './harness-caps';

export type ApproachRung = 'fresh-blueprint' | 'tier-bump' | 're-decompose';

export type ApproachOutcome = 'attempted' | 'not-applicable' | 'failed';

export interface ApproachAttempt {
  id: string;
  criterionId: string;
  missionId: string;
  project: string;
  rung: ApproachRung;
  epicId: string | null;
  outcome: ApproachOutcome;
  detail: string | null;
  attemptedAt: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS criterion_approach (
  id TEXT PRIMARY KEY,
  criterionId TEXT NOT NULL,
  missionId TEXT NOT NULL,
  project TEXT NOT NULL,
  rung TEXT NOT NULL,
  epicId TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  detail TEXT,
  attemptedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_criterion_approach_criterion ON criterion_approach (criterionId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_criterion_approach_rung ON criterion_approach (criterionId, rung, epicId);
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
export function _closeApproachDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** Record an approach attempt for a criterion. INSERT ... ON CONFLICT UPDATE semantic
 *  ensures idempotence — re-recording the same (criterionId, rung, epicId) updates
 *  outcome/detail/attemptedAt instead of appending. Returns false on throw. */
export function recordApproachAttempt(row: Omit<ApproachAttempt, 'id'> & { id?: string }): boolean {
  try {
    const id = row.id ?? crypto.randomUUID();
    const epicId = row.epicId ?? '';
    const d = openDb();
    d.prepare(
      `INSERT INTO criterion_approach (id, criterionId, missionId, project, rung, epicId, outcome, detail, attemptedAt)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(criterionId, rung, epicId) DO UPDATE SET
         outcome=excluded.outcome, detail=excluded.detail, attemptedAt=excluded.attemptedAt`,
    ).run(id, row.criterionId, row.missionId, row.project, row.rung, epicId, row.outcome, row.detail ?? null, row.attemptedAt);
    return true;
  } catch {
    return false;
  }
}

/** List approach attempts for a criterion, newest-first. Returns [] on throw. */
export function listApproachAttempts(project: string, criterionId: string): ApproachAttempt[] {
  try {
    const rows = openDb()
      .query(
        `SELECT id, criterionId, missionId, project, rung, epicId, outcome, detail, attemptedAt
         FROM criterion_approach WHERE project=? AND criterionId=? ORDER BY attemptedAt DESC`,
      )
      .all(project, criterionId) as Array<any>;
    return rows.map((r) => ({
      ...r,
      epicId: r.epicId === '' ? null : r.epicId,
    }));
  } catch {
    return [];
  }
}

/** Check if a rung has been attempted for a criterion. Returns false on throw. */
export function hasAttemptedRung(project: string, criterionId: string, rung: ApproachRung): boolean {
  try {
    const row = openDb()
      .query(
        `SELECT 1 FROM criterion_approach WHERE project=? AND criterionId=? AND rung=? LIMIT 1`,
      )
      .get(project, criterionId, rung);
    return row != null;
  } catch {
    return false;
  }
}

/** PURE derivation: no DB access, deterministic. Answers whether the ladder is exhausted.
 *  tried = the union of rungs present in attempts + inferredRungs, deduped, in ladder order.
 *  missing = the rungs not in tried.
 *  exhausted = true if 're-decompose' has been attempted (any outcome counts) OR
 *              if servedEpicCount >= CRITERION_SERVE_CAP + 1 (backstop for criteria 1-2
 *              where rungs may never write a row). */
export function ladderExhausted(input: {
  attempts: ApproachAttempt[];
  servedEpicCount: number;
  inferredRungs?: ApproachRung[];
}): { exhausted: boolean; tried: ApproachRung[]; missing: ApproachRung[] } {
  const ladderOrder: ApproachRung[] = ['fresh-blueprint', 'tier-bump', 're-decompose'];
  const attemptedRungs = input.attempts.map((a) => a.rung);
  const inferredRungs = input.inferredRungs ?? [];
  const allRungsSet = new Set<ApproachRung>([...attemptedRungs, ...inferredRungs]);
  const tried = ladderOrder.filter((r) => allRungsSet.has(r));
  const missing = ladderOrder.filter((r) => !allRungsSet.has(r));

  const reDecomposeAttempted = tried.includes('re-decompose');
  const serveCapExhausted = input.servedEpicCount >= CRITERION_SERVE_CAP + 1;
  const exhausted = reDecomposeAttempted || serveCapExhausted;

  return { exhausted, tried, missing };
}
