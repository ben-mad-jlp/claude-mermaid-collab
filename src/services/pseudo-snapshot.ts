/**
 * Pseudo DB Snapshot — write/validate/load SQLite snapshot of pseudo cache.
 *
 * Snapshot location: <project>/.collab/pseudo/cache/derived.sqlite
 */

import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_VERSION } from './pseudo-schema';

const SNAPSHOT_TABLES = [
  'cache_meta',
  'files',
  'methods',
  'method_steps',
  'method_calls',
  'file_imports',
  'overlay_matches',
  'orphan_prose',
  'scan_runs',
  'scan_errors',
] as const;

const FILE_COUNT_TOLERANCE = 0.05;
const SAMPLE_SIZE = 30;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_REL = '.collab/pseudo/cache/derived.sqlite';
const LEGACY_SNAPSHOT_REL = '.cache/derived.sqlite';

let cleanedLegacy = false;

export interface SnapshotValidation {
  valid: boolean;
  reason?: 'missing' | 'integrity_check' | 'schema_mismatch' | 'file_count' | 'sample_hash' | 'too_old';
}

function snapshotPath(project: string): string {
  return path.join(project, SNAPSHOT_REL);
}

function escapeForAttach(p: string): string {
  return p.replace(/'/g, "''");
}

export async function writeSnapshot(db: Database, project: string): Promise<void> {
  const snapPath = snapshotPath(project);
  fs.mkdirSync(path.dirname(snapPath), { recursive: true });
  if (fs.existsSync(snapPath)) fs.unlinkSync(snapPath);

  // One-time cleanup: remove legacy snapshot at <project>/.cache/derived.sqlite
  // (relocated to .collab/pseudo/cache/derived.sqlite). Best-effort — never fail.
  if (!cleanedLegacy) {
    cleanedLegacy = true;
    try {
      const legacy = path.join(project, LEGACY_SNAPSHOT_REL);
      if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
    } catch {}
  }

  const escaped = escapeForAttach(snapPath);
  db.exec(`ATTACH DATABASE '${escaped}' AS snap`);
  try {
    db.exec('BEGIN');
    for (const table of SNAPSHOT_TABLES) {
      db.exec(`DROP TABLE IF EXISTS snap.${table}`);
      db.exec(`CREATE TABLE snap.${table} AS SELECT * FROM main.${table}`);
    }
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO snap.cache_meta(key,value) VALUES('schema_version',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [String(SCHEMA_VERSION)],
    );
    db.run(
      `INSERT INTO snap.cache_meta(key,value) VALUES('generated_at',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [now],
    );
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  } finally {
    try { db.exec('DETACH DATABASE snap'); } catch {}
  }
}

export async function validateSnapshot(
  snapPath: string,
  gitFileCount: number,
  sampleFiles: Map<string, string>,
): Promise<SnapshotValidation> {
  if (!fs.existsSync(snapPath)) return { valid: false, reason: 'missing' };
  let ro: Database | null = null;
  try {
    ro = new Database(snapPath, { readonly: true });

    const ic = ro.query(`PRAGMA integrity_check`).get() as { integrity_check?: string } | null;
    if (!ic || ic.integrity_check !== 'ok') return { valid: false, reason: 'integrity_check' };

    const sv = ro.query(`SELECT value FROM cache_meta WHERE key='schema_version'`).get() as { value?: string } | undefined;
    if (!sv || Number(sv.value) !== SCHEMA_VERSION) return { valid: false, reason: 'schema_mismatch' };

    const fc = ro.query(`SELECT COUNT(*) AS n FROM files`).get() as { n: number };
    const count = fc?.n ?? 0;
    const lower = Math.floor(gitFileCount * (1 - FILE_COUNT_TOLERANCE));
    const upper = Math.ceil(gitFileCount * (1 + FILE_COUNT_TOLERANCE));
    if (count < lower || count > upper) return { valid: false, reason: 'file_count' };

    const ga = ro.query(`SELECT value FROM cache_meta WHERE key='generated_at'`).get() as { value?: string } | undefined;
    if (!ga?.value) return { valid: false, reason: 'too_old' };
    const ageMs = Date.now() - Date.parse(ga.value);
    if (!Number.isFinite(ageMs) || ageMs > TTL_MS) return { valid: false, reason: 'too_old' };

    const entries = Array.from(sampleFiles.entries());
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    const sample = entries.slice(0, Math.min(SAMPLE_SIZE, entries.length));
    const stmt = ro.query(`SELECT source_hash FROM files WHERE file_path = ?`);
    for (const [filePath, expectedHash] of sample) {
      const row = stmt.get(filePath) as { source_hash?: string } | undefined;
      if (!row || row.source_hash !== expectedHash) return { valid: false, reason: 'sample_hash' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: 'integrity_check' };
  } finally {
    try { ro?.close(); } catch {}
  }
}

export async function loadSnapshot(db: Database, snapPath: string): Promise<void> {
  const escaped = escapeForAttach(snapPath);
  db.exec(`ATTACH DATABASE '${escaped}' AS snap`);
  try {
    db.exec('BEGIN');
    for (const t of SNAPSHOT_TABLES) {
      db.exec(`INSERT INTO main.${t} SELECT * FROM snap.${t}`);
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  } finally {
    try { db.exec('DETACH DATABASE snap'); } catch {}
  }
}
