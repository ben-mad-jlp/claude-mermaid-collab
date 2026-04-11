/**
 * Pseudo FTS5 Wiring
 *
 * Populate & query helpers for the `pseudo_fts` virtual table in pseudo-schema.ts.
 * Uses an auxiliary `pseudo_fts_rowid` table to map rowids to file paths.
 */

import type { Database } from 'bun:sqlite';

const initialized = new WeakSet<Database>();

export function ensureFtsMapTable(db: Database): void {
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS pseudo_fts_rowid (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pseudo_fts_rowid_path ON pseudo_fts_rowid(file_path);
  `);
  initialized.add(db);
}

function resolveRowid(db: Database, file_path: string, createIfMissing: boolean): number | null {
  const row = db.query(`SELECT rowid FROM pseudo_fts_rowid WHERE file_path = ?`).get(file_path) as { rowid?: number } | undefined;
  if (row?.rowid != null) return row.rowid;
  if (!createIfMissing) return null;
  const result = db.run(`INSERT INTO pseudo_fts_rowid(file_path) VALUES (?)`, [file_path]);
  const lid = (result as any).lastInsertRowid;
  return typeof lid === 'bigint' ? Number(lid) : Number(lid);
}

export function upsertFileFts(
  db: Database,
  row: {
    file_path: string;
    title: string;
    purpose: string;
    step_content: string;
    method_names: string;
  },
): void {
  ensureFtsMapTable(db);
  const txn = db.transaction(() => {
    const rowid = resolveRowid(db, row.file_path, true);
    db.run(`DELETE FROM pseudo_fts WHERE rowid = ?`, [rowid]);
    db.run(
      `INSERT INTO pseudo_fts(rowid, title, purpose, step_content, method_names) VALUES (?, ?, ?, ?, ?)`,
      [rowid, row.title, row.purpose, row.step_content, row.method_names],
    );
  });
  txn();
}

export function deleteFileFts(db: Database, file_path: string): void {
  ensureFtsMapTable(db);
  const txn = db.transaction(() => {
    const rowid = resolveRowid(db, file_path, false);
    if (rowid == null) return;
    db.run(`DELETE FROM pseudo_fts WHERE rowid = ?`, [rowid]);
    db.run(`DELETE FROM pseudo_fts_rowid WHERE rowid = ?`, [rowid]);
  });
  txn();
}

export function clearFts(db: Database): void {
  ensureFtsMapTable(db);
  const txn = db.transaction(() => {
    db.run(`DELETE FROM pseudo_fts`);
    db.run(`DELETE FROM pseudo_fts_rowid`);
  });
  txn();
}

export interface FtsSearchResult {
  file_path: string;
  rank: number;
  snippet_title: string;
  snippet_purpose: string;
}

function sanitizeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';
  if (/[:()*]/.test(trimmed)) return trimmed;
  return '"' + trimmed.replace(/"/g, '""') + '"';
}

function runFtsSelect(db: Database, matchExpr: string, limit: number): FtsSearchResult[] {
  try {
    const rows = db.query(
      `SELECT
         m.file_path AS file_path,
         bm25(pseudo_fts) AS rank,
         snippet(pseudo_fts, 0, '<b>', '</b>', '…', 10) AS snippet_title,
         snippet(pseudo_fts, 1, '<b>', '</b>', '…', 20) AS snippet_purpose
       FROM pseudo_fts
       JOIN pseudo_fts_rowid m ON m.rowid = pseudo_fts.rowid
       WHERE pseudo_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    ).all(matchExpr, limit) as Array<{ file_path: string; rank: number; snippet_title: string; snippet_purpose: string }>;
    return rows.map((r) => ({
      file_path: r.file_path,
      rank: r.rank,
      snippet_title: r.snippet_title,
      snippet_purpose: r.snippet_purpose,
    }));
  } catch (err) {
    console.warn('[pseudo-fts] search failed:', err);
    return [];
  }
}

export function searchFts(db: Database, query: string, limit = 50): FtsSearchResult[] {
  ensureFtsMapTable(db);
  const q = sanitizeFtsQuery(query);
  if (q.length === 0) return [];
  return runFtsSelect(db, q, limit);
}

export function findFunctionFts(db: Database, name: string, limit = 20): FtsSearchResult[] {
  ensureFtsMapTable(db);
  const trimmed = name.trim();
  if (trimmed.length === 0) return [];
  const escaped = trimmed.replace(/"/g, '""');
  const matchExpr = `method_names: "${escaped}"`;
  return runFtsSelect(db, matchExpr, limit);
}
