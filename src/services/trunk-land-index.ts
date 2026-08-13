/**
 * Memoised, single-flighted history walk to find trunk trailers for epic commits.
 *
 * This module builds a durable cache keyed by `project + '\0' + trunk` and invalidates
 * only when the trunk tip sha changes. A single-flight coalescer prevents concurrent
 * redundant walks for the same project+trunk pair, even on a cold cache.
 *
 * Intentionally does NOT read epic.status or epic.landedAt — it is a builder of the
 * trailer index only, not a producer of landedness verdicts. The two canonical
 * landedness producers (`hasGitReachedMaster` and `isEpicLandedInGit` in
 * epic-landedness.ts) remain the sole readers of this index.
 */

import type { GitRunner } from './epic-landedness.js';

/** One entry in the trunk trailer index. */
export interface TrunkLandEntry {
  sha: string;
  committedAtIso: string;
}

/** Optional dependencies for getTrunkLandIndex. */
export interface TrunkLandIndexDeps {
  /** Time-to-live for the tip sha memo in milliseconds. Default 0 (memo is opt-in). */
  tipTtlMs?: number;
  /** Clock function for memo age comparison. Default Date.now. */
  now?: () => number;
  /** Pre-resolved trunk tip sha. If supplied, skips the rev-parse call entirely. */
  tipSha?: string;
}

/** Default TTL for tip memoization. Set to 0 to disable by default. */
export const DEFAULT_TIP_TTL_MS = 0;

/** Cache: key is `project + '\0' + trunk`, value is tip sha + memoised entries. */
const cache = new Map<string, { tipSha: string; entries: Map<string, TrunkLandEntry> }>();

/** In-flight walk promises, keyed by `project + '\0' + trunk`. */
const inFlight = new Map<string, Promise<Map<string, TrunkLandEntry> | null>>();

/** Tip sha memo: key is `project + '\0' + trunk`, value is { tipSha, atMs }. */
const tipMemo = new Map<string, { tipSha: string; atMs: number }>();

/**
 * Retrieve the memoised trunk trailer index for a project+trunk pair.
 *
 * On a cold cache, runs a single git log walk (single-flighted across concurrent callers).
 * On a cache hit (same trunk tip sha), returns the memoised entries directly with zero
 * additional git calls. Invalidates the cache only when trunk's tip sha changes.
 *
 * Returns the entries Map on success, or null if the walk fails or trunk is unreachable.
 * A failed walk is never cached — the next call walks again (criterion f).
 *
 * Optional deps allow pre-resolved tip sha and tip memoization with TTL.
 */
export async function getTrunkLandIndex(
  project: string,
  trunk: string,
  runGit: GitRunner,
  deps?: TrunkLandIndexDeps,
): Promise<Map<string, TrunkLandEntry> | null> {
  const key = project + '\0' + trunk;

  try {
    // Resolve the tip sha. Three-way resolution in order:
    // 1. Explicit tipSha in deps (no git call).
    // 2. Live memo entry within TTL (no git call).
    // 3. Rev-parse, then store in memo if successful (one git call).
    const now = deps?.now ?? Date.now;
    const effectiveTtl = deps?.tipTtlMs ?? DEFAULT_TIP_TTL_MS;

    let tipSha: string | null = null;

    if (deps?.tipSha) {
      tipSha = deps.tipSha;
    } else {
      const memoEntry = tipMemo.get(key);
      if (memoEntry && (now() - memoEntry.atMs) < effectiveTtl) {
        tipSha = memoEntry.tipSha;
      } else {
        // Resolve the tip sha via rev-parse. Never throw past this point.
        const rev = await runGit(project, ['rev-parse', trunk]).catch(() => null);
        tipSha = rev && rev.code === 0 ? rev.stdout.trim() : null;
        if (tipSha) {
          tipMemo.set(key, { tipSha, atMs: now() });
        }
      }
    }

    // Criterion (a)/(b): cache hit returns directly with zero further git calls.
    if (tipSha && cache.get(key)?.tipSha === tipSha) {
      return cache.get(key)!.entries;
    }

    // Criterion (d): single-flight coalescer. Two concurrent callers on a cold cache
    // land on the SAME promise. Insert the promise BEFORE any await.
    const existing = inFlight.get(key);
    if (existing) return existing;

    // Start the walk as an IIFE, store its promise immediately, and on settle delete
    // the inFlight entry ONLY if it still equals this promise (no race on stale entries).
    const promise = (async () => {
      try {
        // Criterion (c): walk even if tipSha is null (not memoised). Criterion (f):
        // wrap entire walk in try/catch, never throw.
        const res = await runGit(project, [
          'log',
          trunk,
          '--grep=Collab-Epic: ',
          '--format=\x1e%H%x09%cI%x09%B',
        ]).catch(() => null);

        // Criterion (f): non-zero exit is not cached. Resolve to null and let the
        // next call walk again.
        if (res === null || res.code !== 0) {
          return null;
        }

        const entries = new Map<string, TrunkLandEntry>();

        // Split on leading \x1e separator. Each record starts with \x1e, so the first
        // split element is empty and is dropped.
        for (const record of res.stdout.split('\x1e')) {
          if (!record.trim()) continue;

          // Split on the first two \x09 bytes: sha, committedAtIso, body.
          // Manual slicing to preserve tabs in the body.
          const tab1 = record.indexOf('\x09');
          if (tab1 === -1) continue;

          const sha = record.substring(0, tab1);
          const tab2 = record.indexOf('\x09', tab1 + 1);
          if (tab2 === -1) continue;

          const committedAtIso = record.substring(tab1 + 1, tab2);
          const body = record.substring(tab2 + 1);

          // Scan body for Collab-Epic trailers. Match the first occurrence of each
          // id (git log is newest-first, so first match wins — criterion: newest wins).
          for (const match of body.matchAll(/Collab-Epic:\s*(\S+)/g)) {
            const id = match[1];
            if (!entries.has(id)) {
              entries.set(id, { sha, committedAtIso });
            }
          }
        }

        // Criterion (c): cache only if tipSha is non-null. Criterion (f): failed walk
        // (tipSha === null or res.code !== 0) is not cached.
        if (tipSha) {
          cache.set(key, { tipSha, entries });
        }

        return entries;
      } catch {
        // Never throw out of the walk.
        return null;
      }
    })();

    inFlight.set(key, promise);
    const clear = () => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    };
    promise.then(clear, clear);

    return promise;
  } catch {
    // Catch-all: any throw becomes a null return.
    return null;
  }
}

/**
 * Look up an epic in a trunk trailer index by id.
 *
 * First tries exact-key lookup. If miss, scans for the first key that starts with
 * the given epicId (short-id-matches-full-uuid prefix semantics). Returns the entry
 * on match, or null if not found.
 */
export function lookupEpicLand(
  index: Map<string, TrunkLandEntry>,
  epicId: string,
): TrunkLandEntry | null {
  // Exact key lookup first.
  const exact = index.get(epicId);
  if (exact) return exact;

  // Prefix lookup: first key that starts with epicId.
  for (const key of index.keys()) {
    if (key.startsWith(epicId)) {
      return index.get(key) || null;
    }
  }

  return null;
}

/** Test-only: clear all cache and in-flight entries. */
export function resetTrunkLandIndex(): void {
  cache.clear();
  inFlight.clear();
  tipMemo.clear();
}
