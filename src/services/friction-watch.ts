import Database from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getWorktreeManager } from './coordinator-live.ts';
import { recordFriction } from './friction-store.ts';
import { getConfig } from './config-service.ts';

/** Default unlanded-epic backlog threshold; override via FRICTION_UNLANDED_THRESHOLD. */
const DEFAULT_UNLANDED_THRESHOLD = 5;

/** The stale-worktree scan (listStaleWorktrees) is an O(N-worktrees) subprocess sweep, far
 *  too heavy to run on every ~30s orchestrator tick. Run it at most once per this interval. */
const STALE_WORKTREE_SCAN_INTERVAL_MS = 300_000; // 5 min

/** Module-level per-project epoch (ms) of the last stale-worktree scan; keyed by project so
 *  the throttle survives across ticks yet stays isolated per project (and per test). */
const lastStaleScanAt = new Map<string, number>();

// Durable dedup KV kept in the SAME per-project friction.db (NOT polluting
// friction_notes with under-threshold/cleared rows). Mirrors friction-store's
// openDb/withLock patterns so a standing condition records once, not every tick.
const WATCH_DDL = `
CREATE TABLE IF NOT EXISTS friction_watch_state (
  signalKey TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
`;

const watchDbCache = new Map<string, Database>();

function openWatchDb(project: string): Database {
  const cached = watchDbCache.get(project);
  if (cached) return cached;
  const path = join(project, '.collab', 'friction.db');
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(WATCH_DDL);
  watchDbCache.set(project, db);
  return db;
}

const watchLocks = new Map<string, Promise<unknown>>();
function withWatchLock<T>(project: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = watchLocks.get(project) ?? Promise.resolve();
  const next = prev.then(() => fn());
  watchLocks.set(project, next.catch(() => {}));
  return next;
}

function getWatchState(project: string, signalKey: string): string | null {
  const db = openWatchDb(project);
  const row = db.prepare('SELECT state FROM friction_watch_state WHERE signalKey = ?').get(signalKey) as
    | { state?: string }
    | undefined;
  return row?.state ?? null;
}

function setWatchState(project: string, signalKey: string, state: string): Promise<void> {
  return withWatchLock(project, () => {
    const db = openWatchDb(project);
    db.prepare(
      `INSERT INTO friction_watch_state (signalKey, state, updatedAt) VALUES (?,?,?)
       ON CONFLICT(signalKey) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`,
    ).run(signalKey, state, new Date().toISOString());
  });
}

/** Minimal slice of WorktreeManager this pass needs — lets a test inject a stub. */
type FrictionWatchManager = {
  listUnlandedEpics(): Promise<Array<{ branch: string; epicId8: string; ahead: number }>>;
  listStaleWorktrees(): Promise<
    Array<{ path: string; branch: string | null; reason: 'branch-gone' | 'prunable' | 'stale'; ageMs: number }>
  >;
};

/** One deterministic operational-friction watch pass for `project`. Records DF1
 *  operational-layer friction for issues a daemon can see, deduped on the edge via
 *  friction_watch_state so a STANDING condition records once, not every tick. No LLM. */
export async function runFrictionWatchPass(
  project: string,
  wm: FrictionWatchManager = getWorktreeManager(project) as unknown as FrictionWatchManager,
  opts: { now?: number; force?: boolean } = {},
): Promise<void> {
  // (a) unlanded-epic backlog over threshold — record on the under→over edge only.
  try {
    const threshold = Number(getConfig('FRICTION_UNLANDED_THRESHOLD', '') || 0) || DEFAULT_UNLANDED_THRESHOLD;
    const epics = await wm.listUnlandedEpics();
    const over = epics.length >= threshold;
    const key = 'watch:unlanded-threshold';
    const prev = getWatchState(project, key);
    if (over && prev !== 'over') {
      await recordFriction(project, {
        layer: 'operational',
        retryReason: 'unlanded-epics-over-threshold',
        detail: `${epics.length} unlanded epic branch(es) ≥ threshold ${threshold}: ${epics.map((e) => `${e.epicId8}(+${e.ahead})`).join(', ')}`,
      });
    }
    await setWatchState(project, key, over ? 'over' : 'under');
  } catch { /* best-effort */ }

  // (b) stale worktrees — throttled: the O(N-worktrees) listStaleWorktrees subprocess scan runs
  //     at most once per STALE_WORKTREE_SCAN_INTERVAL_MS, not on every ~30s tick. force bypasses.
  const now = opts.now ?? Date.now();
  const last = lastStaleScanAt.get(project);
  if (opts.force || last === undefined || now - last >= STALE_WORKTREE_SCAN_INTERVAL_MS) {
    lastStaleScanAt.set(project, now);
    try {
      const stale = await wm.listStaleWorktrees();
      for (const wt of stale) {
        const key = `watch:stale-wt:${wt.path}`;
        if (getWatchState(project, key) === wt.reason) continue;
        await recordFriction(project, {
          layer: 'operational',
          retryReason: 'stale-worktree',
          detail: `stale worktree (${wt.reason}) ${wt.path}${wt.branch ? ` [branch ${wt.branch}]` : ''}, age ${Math.round(wt.ageMs / 3_600_000)}h`,
        });
        await setWatchState(project, key, wt.reason);
      }
    } catch { /* best-effort */ }
  }
}
