/**
 * schema-migrate.ts — versioned, machine-safe schema migration for every store.
 *
 * WHY A FRAMEWORK RATHER THAN AD-HOC BACKFILLS (audit 2026-08-10):
 *
 * Databases do NOT travel with the repo (`.gitignore` ignores `/.collab/*.db`, and the global
 * store lives under ~/.mermaid-collab). So a machine that pulls new code meets NEW CODE against
 * ITS OWN OLD DATA. Migration is therefore a permanent capability that must run correctly
 * wherever the code lands — not a one-off performed on the machine where it was written.
 *
 * The existing convention (`PRAGMA user_version` compared against hand-numbered constants, with
 * the backfill inline in each store's open path) cannot carry that weight:
 *   - user_version is one integer with no record of WHAT ran, WHEN, or under which build, so a
 *     partially-applied upgrade is indistinguishable from a fresh database;
 *   - nothing stops an OLDER build opening a NEWER database and writing old-shaped rows into it,
 *     which corrupts silently and is only discovered on a later read;
 *   - a backfill interrupted midway — and this daemon is SIGKILLed regularly by its liveness
 *     watchdog — can leave a database between versions with no way to tell.
 *
 * This module fixes those three properties and nothing else. It does not know about any
 * particular schema; callers supply an ordered list of migrations.
 */
import type { Database } from 'bun:sqlite';

export interface Migration {
  /** Strictly increasing, unique, and NEVER reused or renumbered once shipped. */
  version: number;
  /** Short human name recorded in schema_meta so an applied history is readable. */
  name: string;
  /** Performs the change. Runs INSIDE a transaction; must not open its own. */
  up: (db: Database) => void;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: Array<{ version: number; name: string }>;
}

const SCHEMA_META_DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version   INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  appliedAt INTEGER NOT NULL,
  appliedBy TEXT
)`;

/** Ensure the bookkeeping table exists. Safe to call on every open. */
export function ensureSchemaMeta(db: Database): void {
  db.exec(SCHEMA_META_DDL);
}

/**
 * The highest version fully applied to this database, or 0 for a database that has never been
 * migrated. Reads schema_meta rather than PRAGMA user_version: a row per applied migration is
 * what makes a partial upgrade legible after the fact.
 */
export function currentSchemaVersion(db: Database): number {
  ensureSchemaMeta(db);
  const row = db.query('SELECT MAX(version) AS v FROM schema_meta').get() as { v: number | null };
  return row?.v ?? 0;
}

/** The full applied history, oldest first — for diagnostics and the verification pass. */
export function schemaHistory(db: Database): Array<{ version: number; name: string; appliedAt: number }> {
  ensureSchemaMeta(db);
  return db.query('SELECT version, name, appliedAt FROM schema_meta ORDER BY version ASC')
    .all() as Array<{ version: number; name: string; appliedAt: number }>;
}

export class SchemaTooNewError extends Error {
  constructor(readonly storeName: string, readonly dbVersion: number, readonly codeVersion: number) {
    super(
      `store '${storeName}' is at schema version ${dbVersion} but this build only understands ` +
      `${codeVersion}. Refusing to open it. An older build writing to a newer database corrupts ` +
      `it silently — update this build, or restore the backup taken before the upgrade.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

/**
 * Bring `db` up to the newest supplied migration.
 *
 * Guarantees:
 *   - ORDERED and IDEMPOTENT: migrations at or below the current version are skipped, so calling
 *     this on every open is correct and cheap.
 *   - ALL-OR-NOTHING PER MIGRATION: each `up` runs in its own transaction together with the
 *     schema_meta row recording it. A crash (or a watchdog SIGKILL) leaves the database exactly
 *     at version N or N-1, never between.
 *   - REFUSES A FUTURE DATABASE: if the database is newer than the code, throws SchemaTooNewError
 *     instead of writing old-shaped rows into it.
 *
 * Deliberately NOT handled here: taking the pre-migration backup. That needs the file path and a
 * retention policy, so it belongs to the caller that knows both; this module is given an open
 * handle. `migrateStore` in the store layer is the place that pairs the two.
 */
export function applyMigrations(
  db: Database,
  migrations: Migration[],
  opts: { storeName: string; now?: () => number; appliedBy?: string },
): MigrationResult {
  assertMigrationListIsSane(migrations, opts.storeName);
  ensureSchemaMeta(db);

  const now = opts.now ?? Date.now;
  const from = currentSchemaVersion(db);
  const codeVersion = migrations.length ? migrations[migrations.length - 1].version : 0;

  if (from > codeVersion) throw new SchemaTooNewError(opts.storeName, from, codeVersion);

  const applied: Array<{ version: number; name: string }> = [];
  for (const m of migrations) {
    if (m.version <= from) continue;
    // One transaction per migration, including its schema_meta row: the record of having run
    // and the effect of running commit together or not at all.
    const run = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_meta (version, name, appliedAt, appliedBy) VALUES (?,?,?,?)')
        .run(m.version, m.name, now(), opts.appliedBy ?? null);
    });
    run();
    applied.push({ version: m.version, name: m.name });
  }

  return { from, to: currentSchemaVersion(db), applied };
}

/**
 * A malformed migration list is a programming error that must surface at startup, not as a
 * mysterious skipped upgrade months later: versions must be unique, strictly increasing, and
 * positive. Renumbering a shipped migration is how one machine silently skips it.
 */
function assertMigrationListIsSane(migrations: Migration[], storeName: string): void {
  let prev = 0;
  const seen = new Set<number>();
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || m.version < 1) {
      throw new Error(`${storeName}: migration '${m.name}' has a non-positive version ${m.version}`);
    }
    if (seen.has(m.version)) {
      throw new Error(`${storeName}: duplicate migration version ${m.version} ('${m.name}')`);
    }
    if (m.version <= prev) {
      throw new Error(
        `${storeName}: migration '${m.name}' (v${m.version}) is out of order after v${prev} — ` +
        `the list must be strictly increasing`,
      );
    }
    seen.add(m.version);
    prev = m.version;
  }
}
