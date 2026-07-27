import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { trackingProjectRoot } from './project-registry.js';
import type { Todo } from './todo-store.js';
import { isGateTodo } from './epic-land-readiness.js';
import { isEpicTodo, isLandTodo } from './invariant-check.js';
import { criterionEdgesOf } from './criterion-edges.js';

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
  nonTerminalServingLeafIds?: string[] | null;
  nonTerminalServingLeafCount?: number | null;
  postLandStatusClean?: number | null;
  postLandResidue?: string | null;
  landPath?: string | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS epic_land_record (
  project TEXT NOT NULL,
  epicId TEXT NOT NULL,
  epicTipSha TEXT NOT NULL,
  landedMergeSha TEXT NOT NULL,
  landedAt INTEGER NOT NULL,
  nonTerminalServingLeafIds TEXT,
  nonTerminalServingLeafCount INTEGER,
  postLandStatusClean INTEGER,
  postLandResidue TEXT,
  landPath TEXT,
  PRIMARY KEY (project, epicId)
);
`;

const dbCache = new Map<string, Database>();

export function addColumnIfMissing(db: Database, table: string, col: string, ddl: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

function openDb(project: string): Database {
  const root = trackingProjectRoot(project);
  const cached = dbCache.get(root);
  if (cached) return cached;
  const path = join(root, '.collab', 'epic-land-record.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  addColumnIfMissing(db, 'epic_land_record', 'nonTerminalServingLeafIds', 'TEXT');
  addColumnIfMissing(db, 'epic_land_record', 'nonTerminalServingLeafCount', 'INTEGER');
  addColumnIfMissing(db, 'epic_land_record', 'postLandStatusClean', 'INTEGER');
  addColumnIfMissing(db, 'epic_land_record', 'postLandResidue', 'TEXT');
  addColumnIfMissing(db, 'epic_land_record', 'landPath', 'TEXT');
  dbCache.set(root, db);
  return db;
}

/** Persist (or replace) the land record for an epic. Idempotent — a re-land of
 *  the same epic always reflects the MOST RECENT successful land. */
export function recordEpicLand(project: string, rec: Omit<EpicLandRecord, 'project'>): void {
  const db = openDb(project);
  db.query(
    `INSERT INTO epic_land_record (project, epicId, epicTipSha, landedMergeSha, landedAt, nonTerminalServingLeafIds, nonTerminalServingLeafCount, postLandStatusClean, postLandResidue, landPath)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project, epicId) DO UPDATE SET
       epicTipSha = excluded.epicTipSha,
       landedMergeSha = excluded.landedMergeSha,
       landedAt = excluded.landedAt,
       nonTerminalServingLeafIds = excluded.nonTerminalServingLeafIds,
       nonTerminalServingLeafCount = excluded.nonTerminalServingLeafCount,
       postLandStatusClean = excluded.postLandStatusClean,
       postLandResidue = excluded.postLandResidue,
       landPath = excluded.landPath`,
  ).run(
    project,
    rec.epicId,
    rec.epicTipSha,
    rec.landedMergeSha,
    rec.landedAt,
    rec.nonTerminalServingLeafIds ? JSON.stringify(rec.nonTerminalServingLeafIds) : null,
    rec.nonTerminalServingLeafCount ?? null,
    rec.postLandStatusClean ?? null,
    rec.postLandResidue ?? null,
    rec.landPath ?? null,
  );
}

/** Read the land record for an epic, or null on no-row or any DB error
 *  (advisory read — never throws). */
export function getEpicLandRecord(project: string, epicId: string): EpicLandRecord | null {
  try {
    const db = openDb(project);
    const row = db.query(
      `SELECT project, epicId, epicTipSha, landedMergeSha, landedAt, nonTerminalServingLeafIds, nonTerminalServingLeafCount, postLandStatusClean, postLandResidue, landPath
       FROM epic_land_record
       WHERE project = ? AND epicId = ?`,
    ).get(project, epicId) as (Omit<EpicLandRecord, 'nonTerminalServingLeafIds'> & { nonTerminalServingLeafIds: string | null }) | undefined;
    if (!row) return null;
    return {
      ...row,
      nonTerminalServingLeafIds: row.nonTerminalServingLeafIds ? JSON.parse(row.nonTerminalServingLeafIds) : null,
    };
  } catch {
    return null;
  }
}

/** Read all land records for `project` with `landedAt` in [sinceMs, untilMs], oldest first.
 *  Advisory read — never throws; any DB error yields []. `project` is passed through
 *  verbatim (the table stores the raw project string `recordEpicLand` wrote; only
 *  `openDb` normalizes via `trackingProjectRoot`). */
export function listEpicLandRecordsInWindow(project: string, sinceMs: number, untilMs: number): EpicLandRecord[] {
  try {
    const db = openDb(project);
    const rows = db.query(
      `SELECT project, epicId, epicTipSha, landedMergeSha, landedAt
       FROM epic_land_record
       WHERE project = ? AND landedAt >= ? AND landedAt <= ?
       ORDER BY landedAt ASC`,
    ).all(project, sinceMs, untilMs) as EpicLandRecord[];
    return rows;
  } catch {
    return [];
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
  nonTerminalServingLeafIds?: string[] | null;
  postLandClean?: { clean: boolean; residue: string | null } | null;
  landPath?: string;
}

export interface LandCycleResult {
  recorded: boolean;
  usedFallback: boolean;
  reason?: string;
}

/** Derive non-terminal criterion-serving leaf ids from a work-graph.
 *  Pure derivation (no DB, no git) so tests can feed hand-built Todo[].
 *  Returns sorted ids of non-terminal descendants whose criterion set
 *  intersects the epic's own criteria (when epic declares none, any criterion-serving
 *  non-terminal counts). Excludes containers, gates, land leaves, and epics. */
export function nonTerminalServingLeafIds(todos: Todo[], epicId: string): string[] {
  const childrenOf = new Map<string, Todo[]>();
  for (const t of todos) {
    if (t.parentId) {
      const arr = childrenOf.get(t.parentId) ?? [];
      arr.push(t);
      childrenOf.set(t.parentId, arr);
    }
  }

  const descendantsOf = (epic: Todo): Todo[] => {
    const result: Todo[] = [];
    const stack = [...(childrenOf.get(epic.id) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node);
      stack.push(...(childrenOf.get(node.id) ?? []));
    }
    return result;
  };

  const epic = todos.find((t) => t.id === epicId);
  if (!epic) return [];

  const epicCriteria = new Set(criterionEdgesOf(epic));

  const result: string[] = [];
  for (const desc of descendantsOf(epic)) {
    if (desc.status === 'dropped') continue;

    const terminal = desc.acceptanceStatus === 'accepted' || desc.status === 'done';
    if (terminal) continue;

    const nonDroppedChildren = (childrenOf.get(desc.id) ?? []).filter((c) => c.status !== 'dropped');
    if (nonDroppedChildren.length >= 1 || isGateTodo(desc) || isLandTodo(desc) || isEpicTodo(desc)) {
      continue;
    }

    const descCriteria = new Set(criterionEdgesOf(desc));

    if (epicCriteria.size > 0) {
      const hit = new Set<string>([...descCriteria].filter((c) => epicCriteria.has(c)));
      if (hit.size === 0) continue;
    }

    result.push(desc.id);
  }

  result.sort();
  return result;
}

/** Capture post-land tree cleanliness from the main checkout.
 *  Spawns a fresh `git status --porcelain` and returns {clean, residue}
 *  from trimmed stdout, or null on any error (never throws). */
export async function capturePostLandCleanliness(repoRoot: string): Promise<{ clean: boolean; residue: string | null } | null> {
  try {
    const p = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const stdout = await new Response(p.stdout).text();
    const trimmed = stdout.trim();
    return { clean: trimmed === '', residue: trimmed ? trimmed : null };
  } catch {
    return null;
  }
}

/** Capture the land-cycle preamble: epic tip sha, non-terminal serving leaves, post-land
 *  tree cleanliness. Used by both escalation-land and reconcile-land paths. The epic-head-sha
 *  thunk is injected to avoid a worktree-manager import cycle (worktree-manager ← coordinator
 *  → land-record-store). All three captures are wrapped in a total try/catch so the function
 *  never throws; a thrown capture anywhere yields all-null. Order is load-bearing: epic tip
 *  sha captured first (before epicBranch is deleted), then leaves, then cleanliness. */
export async function captureLandCycleFields(opts: {
  epicId: string;
  todos: Todo[];
  repoRoot: string;
  epicHeadSha: () => Promise<string | null>;
}): Promise<{
  epicTipSha: string | null;
  nonTerminalServingLeafIds: string[] | null;
  postLandClean: { clean: boolean; residue: string | null } | null;
}> {
  try {
    // 1. Capture epic tip sha first (before removeEpic deletes the ref).
    const epicTipSha = await opts.epicHeadSha();

    // 2. Derive non-terminal serving leaf ids.
    let derivedNonTerminalLeafIds: string[] | null = null;
    try {
      derivedNonTerminalLeafIds = nonTerminalServingLeafIds(opts.todos, opts.epicId);
    } catch {
      // null on throw (matches today's semantics — null, not [], on error)
    }

    // 3. Capture post-land tree cleanliness.
    const postLandClean = await capturePostLandCleanliness(opts.repoRoot);

    return {
      epicTipSha,
      nonTerminalServingLeafIds: derivedNonTerminalLeafIds,
      postLandClean,
    };
  } catch {
    // Total fallback: any thrown value anywhere yields all-null.
    return {
      epicTipSha: null,
      nonTerminalServingLeafIds: null,
      postLandClean: null,
    };
  }
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
      const landPath = input.landPath ?? (input.source === 'reconcile-land' ? 'oi1-reconcile' : input.source);
      recordEpicLand(project, {
        epicId: input.epicId,
        epicTipSha: sha,
        landedMergeSha: input.landedMergeSha,
        landedAt: input.landedAt ?? Date.now(),
        nonTerminalServingLeafIds: input.nonTerminalServingLeafIds ?? null,
        nonTerminalServingLeafCount: input.nonTerminalServingLeafIds ? input.nonTerminalServingLeafIds.length : null,
        postLandStatusClean: input.postLandClean?.clean ? 1 : (input.postLandClean?.clean === false ? 0 : null),
        postLandResidue: input.postLandClean?.residue ?? null,
        landPath,
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
