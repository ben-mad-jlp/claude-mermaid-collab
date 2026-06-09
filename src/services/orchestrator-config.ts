/**
 * Per-project autonomy level for the unified Orchestrator daemon.
 *
 * The Orchestrator is the single daemon that replaces the ad-hoc
 * "auto-start coordinator on project registration" pattern with a
 * controllable, per-project autonomy knob (design-unified-orchestrator-daemon,
 * decision f0ec0b06). This module owns the level type and its durable store;
 * daemon logic lives in orchestrator-live.ts (a later task).
 */

import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** How autonomously the Orchestrator acts for a project.
 *
 *  off     — daemon does nothing; coordinator not started.
 *  build   — start coordinator and drive todos (today's default behavior).
 *  nudge   — drive todos + surface idle/stalled workers proactively.
 *  propose — nudge + Grok suggests an inline action per escalation (human confirms).
 *  drive   — full autonomy: propose + auto-resolve confident actionable suggestions
 *            (behind the proof gate + rate limits).
 */
export type OrchestratorLevel = 'off' | 'build' | 'nudge' | 'propose' | 'drive';

export const ORCH_LEVELS: OrchestratorLevel[] = ['off', 'build', 'nudge', 'propose', 'drive'];

const LEVEL_RANK: Record<OrchestratorLevel, number> = {
  off: 0,
  build: 1,
  nudge: 2,
  propose: 3,
  drive: 4,
};

/** Numeric rank for a level (off=0 … drive=4). Higher = more autonomous. */
export function levelRank(l: OrchestratorLevel): number {
  return LEVEL_RANK[l];
}

// --- Persistence (reuses the supervisor.db SQLite store) -------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS orchestrator_config (
  project TEXT PRIMARY KEY,
  level   TEXT NOT NULL DEFAULT 'build',
  updatedAt INTEGER NOT NULL
);
`;

let db: Database | null = null;

function openDb(): Database {
  if (db) return db;
  const dir = process.env.MERMAID_SUPERVISOR_DIR ?? join(homedir(), '.mermaid-collab');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'supervisor.db');
  db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** Coerce an arbitrary string to a valid OrchestratorLevel, defaulting to 'build'. */
function coerce(raw: unknown): OrchestratorLevel {
  if (typeof raw === 'string' && (ORCH_LEVELS as string[]).includes(raw)) {
    return raw as OrchestratorLevel;
  }
  return 'build';
}

/** Return the persisted autonomy level for a project. Defaults to 'build' when unset. */
export function getOrchestratorLevel(project: string): OrchestratorLevel {
  const d = openDb();
  const row = d
    .query('SELECT level FROM orchestrator_config WHERE project = ?')
    .get(project) as { level: string } | undefined;
  return coerce(row?.level);
}

/** List every project that has an explicitly-set level (synchronous — for the
 *  daemon health snapshot / UI). Projects with no row use the 'build' default and
 *  are not listed here. */
export function listOrchestratorProjects(): Array<{ project: string; level: OrchestratorLevel }> {
  const d = openDb();
  const rows = d.query('SELECT project, level FROM orchestrator_config').all() as Array<{ project: string; level: string }>;
  return rows.map((r) => ({ project: r.project, level: coerce(r.level) }));
}

/** Persist the autonomy level for a project. Unknown values are clamped to 'build'. */
export function setOrchestratorLevel(project: string, level: OrchestratorLevel): void {
  const safe = coerce(level);
  const d = openDb();
  d.prepare(
    `INSERT INTO orchestrator_config (project, level, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(project) DO UPDATE SET level = excluded.level, updatedAt = excluded.updatedAt`,
  ).run(project, safe, Date.now());
}
