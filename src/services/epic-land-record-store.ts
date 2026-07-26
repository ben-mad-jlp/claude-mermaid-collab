import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { trackingProjectRoot } from './project-registry.js';

/**
 * Per-PROJECT durable epic-land record store. Mirrors the bun:sqlite-per-project
 * pattern used by session-status-store.ts: one DB file per project under
 * `.collab`, WAL journal mode, and a Map-based connection cache keyed on the
 * TRACKING repo root (never a worker worktree's `.collab`, which is torn down
 * on merge-back).
 *
 * This is the durable proof that an epic actually landed onto master, keyed on
 * the epic-branch tip sha at the moment of a successful `landEpicToMaster`
 * call — the reaper's catch-up GC path (leaf-worktree-reaper.ts) reads this
 * record to verify a leftover epic worktree is safe to reclaim WITHOUT relying
 * on branch existence or `git branch --merged`, which are not proof of a land.
 */

export interface EpicLandRecord {
  project: string;
  epicId: string;
  epicTipSha: string;
  landedMergeSha: string;
  landedAt: number;
}

const DDL = `
CREATE TABLE IF NOT EXISTS epic_land_record (
  project TEXT NOT NULL,
  epicId TEXT NOT NULL,
  epicTipSha TEXT NOT NULL,
  landedMergeSha TEXT NOT NULL,
  landedAt INTEGER NOT NULL,
  PRIMARY KEY (project, epicId)
);
`;

const dbCache = new Map<string, Database>();

function openDb(project: string): Database {
  const root = trackingProjectRoot(project);
  const cached = dbCache.get(root);
  if (cached) return cached;
  const path = join(root, '.collab', 'epic-land-record.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  dbCache.set(root, db);
  return db;
}

/** Persist (or replace) the land record for an epic. Idempotent — a re-land of
 *  the same epic always reflects the MOST RECENT successful land. */
export function recordEpicLand(project: string, rec: Omit<EpicLandRecord, 'project'>): void {
  const db = openDb(project);
  db.query(
    `INSERT INTO epic_land_record (project, epicId, epicTipSha, landedMergeSha, landedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project, epicId) DO UPDATE SET
       epicTipSha = excluded.epicTipSha,
       landedMergeSha = excluded.landedMergeSha,
       landedAt = excluded.landedAt`,
  ).run(project, rec.epicId, rec.epicTipSha, rec.landedMergeSha, rec.landedAt);
}

/** Read the land record for an epic, or null on no-row or any DB error
 *  (advisory read — never throws). */
export function getEpicLandRecord(project: string, epicId: string): EpicLandRecord | null {
  try {
    const db = openDb(project);
    const row = db.query(
      `SELECT project, epicId, epicTipSha, landedMergeSha, landedAt
       FROM epic_land_record
       WHERE project = ? AND epicId = ?`,
    ).get(project, epicId) as EpicLandRecord | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export type LandCycleSource = 'escalation-land' | 'reconcile-land';

export interface LandCycleInput {
  epicId: string;
  epicTipSha: string | null;
  landedMergeSha: string;
  landedAt?: number;
  source: LandCycleSource;
  session?: string;
}

export interface LandCycleResult {
  recorded: boolean;
  usedFallback: boolean;
  reason?: string;
}

/** Shared land-cycle recorder for both epic→master paths (escalation-land and reconcile-land).
 *  Records a durable land proof with an explicit fallback: when the epic tip is unavailable
 *  (branch torn down / rev-parse failure), the land merge sha stands in, ensuring a completed
 *  land always yields a record. On any skip or failure, emits observable signals to friction
 *  and supervisor-audit stores (each individually caught so the recorder never throws into a
 *  completed land). Never throws. */
export async function recordLandCycle(project: string, input: LandCycleInput): Promise<LandCycleResult> {
  try {
    // Resolve the stored sha with explicit fallback: epic tip first, then merge sha.
    const sha = (input.epicTipSha ?? '').trim() || input.landedMergeSha.trim();
    const usedFallback = !input.epicTipSha?.trim();

    if (!sha) {
      const reason = 'no-sha';
      // Emit observable signals on skip.
      try {
        const { recordFriction } = await import('./friction-store.js');
        await recordFriction(project, {
          layer: 'operational',
          retryReason: 'land-record-drop',
          todoId: input.epicId,
          detail: `land-record drop epic=${input.epicId} source=${input.source} reason=${reason}`,
        }).catch(() => {});
      } catch { /* advisory */ }

      try {
        const { recordSupervisorAudit } = await import('./supervisor-store.js');
        recordSupervisorAudit({
          kind: 'land-record-drop',
          project,
          session: input.session ?? 'daemon',
          detail: JSON.stringify({ epicId: input.epicId, source: input.source, reason, usedFallback }),
        });
      } catch { /* advisory */ }

      return { recorded: false, usedFallback, reason };
    }

    // Attempt to record the land.
    let reason: string | undefined;
    try {
      recordEpicLand(project, {
        epicId: input.epicId,
        epicTipSha: sha,
        landedMergeSha: input.landedMergeSha,
        landedAt: input.landedAt ?? Date.now(),
      });
      return { recorded: true, usedFallback };
    } catch (err) {
      reason = `record-throw:${err instanceof Error ? err.message : String(err)}`;
      // Emit observable signals on throw.
      try {
        const { recordFriction } = await import('./friction-store.js');
        await recordFriction(project, {
          layer: 'operational',
          retryReason: 'land-record-drop',
          todoId: input.epicId,
          detail: `land-record drop epic=${input.epicId} source=${input.source} reason=${reason}`,
        }).catch(() => {});
      } catch { /* advisory */ }

      try {
        const { recordSupervisorAudit } = await import('./supervisor-store.js');
        recordSupervisorAudit({
          kind: 'land-record-drop',
          project,
          session: input.session ?? 'daemon',
          detail: JSON.stringify({ epicId: input.epicId, source: input.source, reason, usedFallback }),
        });
      } catch { /* advisory */ }

      return { recorded: false, usedFallback, reason };
    }
  } catch {
    // Outermost catch: graceful fallback, never throws.
    return { recorded: false, usedFallback: false, reason: 'unexpected-error' };
  }
}
