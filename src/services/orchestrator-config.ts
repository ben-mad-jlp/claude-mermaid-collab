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
  // Additive migration: per-project in-flight CAP (fire-and-track concurrency). NULL =
  // use the global per-project default (MERMAID_MAX_INFLIGHT_PROJECT). This is the
  // canonical "how many leaves run at once for this project" knob post-fire-and-track;
  // the daemon keeps poolSize in lockstep so worker slots never bottleneck below it.
  try { db.exec('ALTER TABLE orchestrator_config ADD COLUMN inflightCap INTEGER'); } catch { /* already present */ }
  // Per-(project, node-kind) model + effort overrides for the leaf-executor's claude
  // nodes. A row's NULL model/effort = inherit that node kind's NODE_PROFILE default.
  db.exec(`CREATE TABLE IF NOT EXISTS node_profile_override (
    project   TEXT NOT NULL,
    kind      TEXT NOT NULL,
    model     TEXT,
    effort    TEXT,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (project, kind)
  )`);
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

// --- Per-project in-flight CAP (fire-and-track concurrency) ----------------------

/** Clamp an in-flight cap to a sane range [1, 32]; non-finite → 1. */
function clampInflightCap(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(32, Math.floor(n)));
}

/** The persisted per-project in-flight cap, or null when unset (→ global default). */
export function getProjectInflightCap(project: string): number | null {
  const d = openDb();
  const row = d
    .query('SELECT inflightCap FROM orchestrator_config WHERE project = ?')
    .get(project) as { inflightCap: number | null } | undefined;
  return row?.inflightCap == null ? null : clampInflightCap(row.inflightCap);
}

/** Persist a per-project in-flight cap. Pass null to clear (revert to global default).
 *  Kept in LOCKSTEP with poolSize by the caller so the worker pool never bottlenecks
 *  below the concurrency cap. Stored clamped to [1, 32]. */
export function setProjectInflightCap(project: string, cap: number | null): void {
  const d = openDb();
  const value = cap == null ? null : clampInflightCap(cap);
  d.prepare(
    `INSERT INTO orchestrator_config (project, level, inflightCap, updatedAt) VALUES (?, 'on', ?, ?)
     ON CONFLICT(project) DO UPDATE SET inflightCap = excluded.inflightCap, updatedAt = excluded.updatedAt`,
  ).run(project, value, Date.now());
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

// --- Per-(project, node-kind) model + effort overrides (leaf-executor claude nodes) ---

export interface NodeProfileOverride {
  /** Model alias/id override, or null to inherit the node kind's default. */
  model: string | null;
  /** Effort override, or null to inherit (then the per-project / env / default chain). */
  effort: EffortLevel | null;
}

/** Every per-node-kind override for a project, keyed by kind. Kinds with no row
 *  are absent (→ inherit defaults). Used by the daemon at run time and the editor. */
export function listNodeProfileOverrides(project: string): Record<string, NodeProfileOverride> {
  const d = openDb();
  const rows = d
    .query('SELECT kind, model, effort FROM node_profile_override WHERE project = ?')
    .all(project) as Array<{ kind: string; model: string | null; effort: string | null }>;
  const out: Record<string, NodeProfileOverride> = {};
  for (const r of rows) {
    out[r.kind] = {
      model: r.model && r.model.trim() ? r.model : null,
      effort: r.effort != null && (EFFORT_LEVELS as string[]).includes(r.effort) ? (r.effort as EffortLevel) : null,
    };
  }
  return out;
}

/** Set (or clear) a single node kind's model/effort override for a project. A
 *  null model or effort clears that field (inherit); when BOTH are null the row is
 *  deleted so the kind reads as a clean inherit. An invalid effort coerces to null. */
export function setNodeProfileOverride(
  project: string,
  kind: string,
  model: string | null,
  effort: EffortLevel | null,
): void {
  const d = openDb();
  const m = model && model.trim() ? model.trim() : null;
  const e = effort != null && (EFFORT_LEVELS as string[]).includes(effort) ? effort : null;
  if (m == null && e == null) {
    d.prepare('DELETE FROM node_profile_override WHERE project = ? AND kind = ?').run(project, kind);
    return;
  }
  d.prepare(
    `INSERT INTO node_profile_override (project, kind, model, effort, updatedAt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project, kind) DO UPDATE SET model = excluded.model, effort = excluded.effort, updatedAt = excluded.updatedAt`,
  ).run(project, kind, m, e, Date.now());
}

/** Copy a source project's ENTIRE node-profile override set to each target project,
 *  replacing whatever the target had (so every target ends up matching the source —
 *  including "no override" kinds, which are cleared). Skips the source itself.
 *  Returns the number of projects updated. */
export function copyNodeProfilesTo(sourceProject: string, targetProjects: string[]): number {
  const d = openDb();
  const rows = d
    .query('SELECT kind, model, effort FROM node_profile_override WHERE project = ?')
    .all(sourceProject) as Array<{ kind: string; model: string | null; effort: string | null }>;
  const now = Date.now();
  let count = 0;
  const apply = d.transaction((targets: string[]) => {
    for (const t of targets) {
      if (t === sourceProject) continue;
      d.prepare('DELETE FROM node_profile_override WHERE project = ?').run(t);
      for (const r of rows) {
        d.prepare(
          'INSERT INTO node_profile_override (project, kind, model, effort, updatedAt) VALUES (?, ?, ?, ?, ?)',
        ).run(t, r.kind, r.model, r.effort, now);
      }
      count++;
    }
  });
  apply(targetProjects);
  return count;
}

/** Steward kill-switch (one-way): force a project's level to 'off' and return the
 *  resulting level. Brake-only — there is deliberately no raise-level counterpart
 *  for the steward (decision 3bf1292b). */
export function orchestratorOff(project: string): OrchestratorLevel {
  setOrchestratorLevel(project, 'off');
  return getOrchestratorLevel(project);
}
