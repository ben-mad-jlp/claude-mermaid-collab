/**
 * tier_override store (design-worker-fabric-ui §3.3) — the durable per-scope
 * provider/model overrides that extend the worker-core tier matrix beyond the global
 * config keys. One row per (scope, scopeId, phase). Scopes: 'project' | 'epic' |
 * 'level'. Lives beside worker-ledger.db. The resolution WALK (epic > project > level
 * > global > default) reads these; an empty table = today's global/default behavior
 * (byte-identical), so this is purely additive.
 *
 * Structured table — NOT mangled config.json keys — so the GUI can LIST overrides to
 * render the matrix and the hot resolveTierRoute path can index a single lookup.
 */
import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type TierScope = 'project' | 'epic' | 'level';

export interface TierOverride {
  scope: TierScope;
  scopeId: string;
  phase: string;
  provider: string;
  model?: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS tier_override (
  scope    TEXT NOT NULL,
  scopeId  TEXT NOT NULL,
  phase    TEXT NOT NULL,
  provider TEXT NOT NULL,
  model    TEXT,
  PRIMARY KEY (scope, scopeId, phase)
);
`;

let db: Database | null = null;

function openDb(): Database {
  if (db) return db;
  const dir = process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  db = new Database(join(dir, 'worker-ledger.db')); // co-located with the ledger (worker-fabric data)
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeTierDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** The override for one (scope, scopeId, phase), or null. Best-effort (never throws
 *  into the hot resolveTierRoute path). */
export function getTierOverride(scope: TierScope, scopeId: string, phase: string): TierOverride | null {
  try {
    const row = openDb()
      .query('SELECT scope, scopeId, phase, provider, model FROM tier_override WHERE scope=? AND scopeId=? AND phase=?')
      .get(scope, scopeId, phase) as TierOverride | null;
    return row ?? null;
  } catch {
    return null;
  }
}

/** Set (or replace) an override. An empty/falsy provider CLEARS the row (so the phase
 *  falls through the walk again). Returns true on success. */
export function setTierOverride(scope: TierScope, scopeId: string, phase: string, provider: string, model?: string | null): boolean {
  try {
    const d = openDb();
    if (!provider) {
      d.prepare('DELETE FROM tier_override WHERE scope=? AND scopeId=? AND phase=?').run(scope, scopeId, phase);
      return true;
    }
    d.prepare(
      `INSERT INTO tier_override (scope, scopeId, phase, provider, model) VALUES (?,?,?,?,?)
       ON CONFLICT(scope, scopeId, phase) DO UPDATE SET provider=excluded.provider, model=excluded.model`,
    ).run(scope, scopeId, phase, provider, model ?? null);
    return true;
  } catch {
    return false;
  }
}

/** List overrides for a scope/scopeId (for the matrix). */
export function listTierOverrides(scope: TierScope, scopeId: string): TierOverride[] {
  try {
    return openDb()
      .query('SELECT scope, scopeId, phase, provider, model FROM tier_override WHERE scope=? AND scopeId=? ORDER BY phase')
      .all(scope, scopeId) as TierOverride[];
  } catch {
    return [];
  }
}
