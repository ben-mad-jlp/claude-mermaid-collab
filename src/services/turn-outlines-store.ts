/**
 * Turn outlines — a durable ring buffer of turn-structure snapshots for a (project, session),
 * used for bridging and plan reconstruction. New outlines are appended; the ring keeps the
 * newest TURN_OUTLINE_RING_CAP entries and discards the oldest by (ts, rowid).
 *
 * Design S6 (docs/design-turn-outline.md): file-backed at ~/.mermaid-collab/turn-outlines.db
 * with WAL, survives restart.
 */

import { Database } from 'bun:sqlite';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

export const TURN_OUTLINE_RING_CAP = 20;

export interface TurnOutlineRecord {
  project: string;
  session: string;
  turn: string;
  outline: unknown;
  ts: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS turn_outline (
  project TEXT NOT NULL,
  session TEXT NOT NULL,
  turn TEXT NOT NULL,
  outline TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turn_outline_session ON turn_outline(project, session, ts);
`;

let db: Database | null = null;

function openDb(): Database {
  if (db) return db;
  // MERMAID_DATA_DIR lets tests isolate the store off the real ~/.mermaid-collab.
  const dir = process.env.MERMAID_DATA_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  const d = new Database(join(dir, 'turn-outlines.db'));
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(DDL);
  db = d;
  return db;
}

/** Test seam: close + drop the cached handle so the next call re-opens at the current dir. */
export function __resetForTest(): void {
  try { db?.close(); } catch { /* already closed */ }
  db = null;
}

/**
 * Insert a turn outline, then evict oldest rows past the ring cap for that (project, session).
 * The post-condition of any call is countTurnOutlines(project, session) ===
 * Math.min(insertedSoFar, TURN_OUTLINE_RING_CAP). `ts` defaults to Date.now();
 * `outline` is stored via JSON.stringify.
 */
export function putTurnOutline(rec: { project: string; session: string; turn: string; outline: unknown; ts?: number }): void {
  const ts = rec.ts ?? Date.now();
  const outline = JSON.stringify(rec.outline);
  const d = openDb();

  // Insert the new outline.
  d.prepare(
    `INSERT INTO turn_outline (project, session, turn, outline, ts) VALUES (?,?,?,?,?)`,
  ).run(rec.project, rec.session, rec.turn, outline, ts);

  // Evict oldest rows past the cap, scoped to the same (project, session).
  // LIMIT -1 OFFSET n is sqlite's "everything past the newest n".
  d.prepare(
    `DELETE FROM turn_outline
     WHERE rowid IN (SELECT rowid FROM turn_outline WHERE project=? AND session=?
                     ORDER BY ts DESC, rowid DESC LIMIT -1 OFFSET ?)`,
  ).run(rec.project, rec.session, TURN_OUTLINE_RING_CAP);
}

/**
 * List turn outlines for a (project, session), newest-first by (ts, rowid).
 * Each row's outline is JSON-parsed back to the posted tree.
 */
export function listTurnOutlines(project: string, session: string): TurnOutlineRecord[] {
  const rows = openDb()
    .query(`SELECT project, session, turn, outline, ts FROM turn_outline WHERE project=? AND session=? ORDER BY ts DESC, rowid DESC`)
    .all(project, session) as any[];
  return rows.map((r) => ({
    project: r.project,
    session: r.session,
    turn: r.turn,
    outline: JSON.parse(r.outline),
    ts: r.ts,
  }));
}

/**
 * Count turn outlines for a (project, session).
 */
export function countTurnOutlines(project: string, session: string): number {
  const r = openDb().query(`SELECT COUNT(*) AS c FROM turn_outline WHERE project=? AND session=?`).get(project, session) as { c: number };
  return r.c;
}
