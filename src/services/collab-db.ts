/**
 * collab-db.ts — the single opener for a project's consolidated work-graph database.
 *
 * Every machine that pulls this code meets its OWN old data (databases are gitignored and never
 * travel with the repo), so the move from the todos.db + mission.db pair to collab.db has to
 * happen wherever the code lands, unattended, exactly once, without anybody running a command.
 * This opener is where that happens:
 *
 *   1. resolve the canonical path (store-paths owns that, and enforces scope);
 *   2. if collab.db does not exist and a legacy todos.db does, IMPORT the pair into it;
 *   3. apply the schema migrations;
 *   4. turn foreign keys ON — they are per-connection in SQLite and default OFF, so every
 *      constraint in the schema is inert without this.
 *
 * The legacy files are left in place. They are the rollback, and deleting them is a separate,
 * explicit act once the consolidated database has been trusted for a while.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalProjectRoot, canonicalProjectRootLoose, storePath } from './store-paths';
import { COLLAB_DB_MIGRATIONS, enforceForeignKeys } from './collab-db-schema';
import { applyMigrations } from './schema-migrate';
import { importProjectWorkGraph, type ImportReport } from './collab-db-import';

const cache = new Map<string, Database>();

/** Import reports, kept per project so a caller (or an operator) can see what the move did. */
const lastImport = new Map<string, ImportReport>();

export interface OpenCollabOpts {
  /** Live inflight rows for this project, supplied by the caller that can still read the global
   *  ledger. They import as ALREADY-EXPIRED claims; see collab-db-import. */
  inflight?: Array<{ leafId: string; epicId?: string | null; holder?: string | null }>;
  now?: () => number;
}

/**
 * Open (creating and migrating on first use) the consolidated database for a project.
 * Cached per canonical project root, so two spellings of one repo share a handle.
 */
export function openCollabDb(project: string, opts: OpenCollabOpts = {}): Database {
  const root = canonicalProjectRoot(project);
  const cached = cache.get(root);
  if (cached) return cached;

  const dest = storePath('collab', root);
  mkdirSync(dirname(dest), { recursive: true });

  // The one-time move. Guarded on the DESTINATION not existing rather than on a flag, so an
  // interrupted first run simply retries: the import is idempotent (INSERT OR IGNORE on primary
  // keys) and a half-written collab.db is completed on the next open rather than skipped.
  const legacyTodos = storePath('todos', root);
  if (!existsSync(dest) && existsSync(legacyTodos)) {
    const report = importProjectWorkGraph({
      todosPath: legacyTodos,
      missionPath: storePath('mission', root),
      destPath: dest,
      inflight: opts.inflight,
      now: opts.now,
    });
    lastImport.set(root, report);
    // A violation means the copy did not reproduce the source faithfully. Surfacing it here — at
    // the moment of the move, naming the project — beats discovering it later from missing rows.
    if (report.violations.length > 0) {
      console.warn(
        `[collab-db] import of ${root} reported ${report.violations.length} violation(s): ` +
        report.violations.join('; '),
      );
    }
  }

  const db = new Database(dest, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  enforceForeignKeys(db);
  applyMigrations(db, COLLAB_DB_MIGRATIONS, { storeName: 'collab', now: opts.now });
  cache.set(root, db);
  return db;
}

/** What the one-time import did for this project, if it ran in this process. */
export function lastImportReport(project: string): ImportReport | undefined {
  return lastImport.get(canonicalProjectRootLoose(project));
}

/**
 * Drop a cached handle. LOOSE canonicalisation: teardown runs against projects that may not exist
 * any more and must never throw — and it must key exactly as the opener did, or it evicts nothing
 * and the caller keeps a stale handle.
 */
export function closeCollabDb(project: string): void {
  const key = canonicalProjectRootLoose(project);
  const db = cache.get(key);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    cache.delete(key);
  }
}

/** Test-only: drop every cached handle. */
export function _closeAllCollabDbs(): void {
  for (const db of cache.values()) { try { db.close(); } catch { /* ignore */ } }
  cache.clear();
  lastImport.clear();
}
