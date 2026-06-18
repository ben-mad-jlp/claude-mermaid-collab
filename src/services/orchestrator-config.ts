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
import { POOL_CONFIG, poolConfigForSize, clampPoolSize, type PoolConfig } from './worker-pool';
import type { EffortLevel } from '../agent/contracts';

/** Valid reasoning-effort levels (mirrors the CLI --effort scale). */
export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** How autonomously the Orchestrator acts for a project (epic 4b81ca59 — collapsed
 *  from the legacy 5-rung ladder off·build·nudge·propose·drive).
 *
 *  off  — daemon does nothing; coordinator not started.
 *  on   — supervised: build todos + reconcile (stale-close + land-surface) +
 *         always-on triage SUGGEST (write-only; a human confirms). Works and
 *         annotates, never acts unattended. (folds legacy build|nudge|propose)
 *  auto — on + auto-land + auto-resolve confident suggestions + the bp1/OI-1
 *         reachability gates. "act for me." (folds legacy drive)
 */
export type OrchestratorLevel = 'off' | 'on' | 'auto';

/** Legacy 5-rung values still readable from storage until backfilled. */
export type LegacyOrchestratorLevel = 'build' | 'nudge' | 'propose' | 'drive';

export const ORCH_LEVELS: OrchestratorLevel[] = ['off', 'on', 'auto'];

const LEVEL_RANK: Record<OrchestratorLevel, number> = {
  off: 0,
  on: 1,
  auto: 2,
};

/** Numeric rank for a level (off=0, on=1, auto=2). Higher = more autonomous. */
export function levelRank(l: OrchestratorLevel): number {
  return LEVEL_RANK[l];
}

/** Map ANY stored level string (legacy 5-rung OR canonical) to the canonical
 *  off/on/auto. The single read seam: build|nudge|propose→on, drive→auto, and
 *  off/on/auto pass through. Unknown → 'on' (the safe supervised default). */
export function coalesceLevel(raw: unknown): OrchestratorLevel {
  switch (raw) {
    case 'off': return 'off';
    case 'on': return 'on';
    case 'auto': return 'auto';
    case 'build': return 'on';
    case 'nudge': return 'on';
    case 'propose': return 'on';
    case 'drive': return 'auto';
    default: return 'on';
  }
}

// --- Persistence (reuses the supervisor.db SQLite store) -------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS orchestrator_config (
  project TEXT PRIMARY KEY,
  level   TEXT NOT NULL DEFAULT 'on',
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
  // Additive migration: per-project pool size (slots-per-type). NULL = use the
  // global POOL_CONFIG default. ALTER throws "duplicate column" once added — guard.
  try { db.exec('ALTER TABLE orchestrator_config ADD COLUMN poolSize INTEGER'); } catch { /* already present */ }
  // Additive migration: per-project reasoning-effort override for daemon-spawned
  // claude worker nodes. NULL = 'auto' (use the per-node-kind NODE_PROFILE defaults).
  try { db.exec('ALTER TABLE orchestrator_config ADD COLUMN effortOverride TEXT'); } catch { /* already present */ }
  // One-shot guarded backfill (epic 4b81ca59): collapse any legacy 5-rung rows to
  // the canonical off/on/auto. Idempotent — once migrated, rows are on/auto and no
  // longer match, so re-running is a no-op (cheap; only legacy rows are touched).
  db.exec(
    `UPDATE orchestrator_config SET level='on'   WHERE level IN ('build','nudge','propose');
     UPDATE orchestrator_config SET level='auto' WHERE level='drive';`,
  );
  return db;
}

/** For tests: drop the cached handle so a fresh DB opens on next use. */
export function _closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/** Coerce an arbitrary stored string to the canonical off/on/auto (legacy values
 *  collapse via coalesceLevel). Unset/unknown → 'on' (supervised default). */
function coerce(raw: unknown): OrchestratorLevel {
  return coalesceLevel(raw);
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

// --- Per-project pool size (slots per worker type) -------------------------------

/** The persisted per-project pool size, or null when unset (→ global default).
 *  A single number that the daemon expands to a uniform PoolConfig (all types = N). */
export function getProjectPoolSize(project: string): number | null {
  const d = openDb();
  const row = d
    .query('SELECT poolSize FROM orchestrator_config WHERE project = ?')
    .get(project) as { poolSize: number | null } | undefined;
  return row?.poolSize == null ? null : clampPoolSize(row.poolSize);
}

/** Persist a per-project pool size. Pass null to clear (revert to the global
 *  default). Stored clamped to [1, MAX_POOL_SIZE]. */
export function setProjectPoolSize(project: string, size: number | null): void {
  const d = openDb();
  const value = size == null ? null : clampPoolSize(size);
  // Upsert: keep the existing level (or its 'on' default) when inserting a fresh row.
  d.prepare(
    `INSERT INTO orchestrator_config (project, level, poolSize, updatedAt) VALUES (?, 'on', ?, ?)
     ON CONFLICT(project) DO UPDATE SET poolSize = excluded.poolSize, updatedAt = excluded.updatedAt`,
  ).run(project, value, Date.now());
}

/** The effective PoolConfig the daemon should use for a project: the per-project
 *  uniform override when set, else the global POOL_CONFIG default. */
export function getProjectPoolConfig(project: string): PoolConfig {
  const size = getProjectPoolSize(project);
  return size == null ? POOL_CONFIG : poolConfigForSize(size);
}

// --- Per-project reasoning-effort override (daemon-spawned claude worker nodes) ---

/** The persisted per-project effort override, or null = 'auto' (per-node-kind
 *  NODE_PROFILE defaults). Invalid stored values coerce to null. */
export function getProjectEffort(project: string): EffortLevel | null {
  const d = openDb();
  const row = d
    .query('SELECT effortOverride FROM orchestrator_config WHERE project = ?')
    .get(project) as { effortOverride: string | null } | undefined;
  const v = row?.effortOverride;
  return v != null && (EFFORT_LEVELS as string[]).includes(v) ? (v as EffortLevel) : null;
}

/** Persist a per-project effort override. Pass null to clear (→ 'auto'/defaults).
 *  An invalid level is treated as null. */
export function setProjectEffort(project: string, effort: EffortLevel | null): void {
  const d = openDb();
  const value = effort != null && (EFFORT_LEVELS as string[]).includes(effort) ? effort : null;
  d.prepare(
    `INSERT INTO orchestrator_config (project, level, effortOverride, updatedAt) VALUES (?, 'on', ?, ?)
     ON CONFLICT(project) DO UPDATE SET effortOverride = excluded.effortOverride, updatedAt = excluded.updatedAt`,
  ).run(project, value, Date.now());
}

/** Steward kill-switch (one-way): force a project's level to 'off' and return the
 *  resulting level. Brake-only — there is deliberately no raise-level counterpart
 *  for the steward (decision 3bf1292b). */
export function orchestratorOff(project: string): OrchestratorLevel {
  setOrchestratorLevel(project, 'off');
  return getOrchestratorLevel(project);
}
