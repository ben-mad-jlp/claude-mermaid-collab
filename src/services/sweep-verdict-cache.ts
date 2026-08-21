// Caches a sweep's verdict by the branch-tips fingerprint it was computed against, so a
// sweep pass that finds nothing changed since its last run can skip the expensive `check`
// callback entirely instead of re-running it every tick.
//
// `./worker-ledger` opens its DB lazily inside each function call — importing it here
// must stay side-effect-free at module load, or every importer of this cache module
// pays a DB open even when it never uses the default store.
import { getSweepVerdict, recordSweepVerdict, retireSweepVerdict } from './worker-ledger';

export interface CachedSweepState {
  lastBranchTips: string | null;
  ranCount: number;
  skippedUnchanged: number;
  /** Per-item verdict cache (item id -> the tip fingerprint it was last computed against
   *  and the verdict computed at that tip), used by the item-form `runCachedSweep`
   *  overload below. Unused by the legacy whole-sweep form. */
  verdicts: Map<string, { tip: string; verdict: boolean }>;
  /** Numeric paging cursor for the item-form sweep: the offset into `items` an
   *  unexplicit-cursor call resumes from. Advances to `cursorEnd` after each run and
   *  wraps to 0 once it reaches the end of the list. */
  cursor: number;
}

export function createCachedSweepState(): CachedSweepState {
  return { lastBranchTips: null, ranCount: 0, skippedUnchanged: 0, verdicts: new Map(), cursor: 0 };
}

export interface RunCachedSweepOptions {
  branchTips: string;
  check: () => void | Promise<void>;
}

/** Summary of one item-form `runCachedSweep` call, always present — a throttled early
 *  return still hands back this shape (via `zeroSweepSummary`) rather than an empty
 *  array, so callers can log counters uniformly either way. */
export interface SweepSummary {
  sweepKind: string;
  /** `items.length` for this call — the full candidate set, before paging. */
  candidates: number;
  /** The page length actually processed this call. */
  scanned: number;
  checked: number;
  cachedHits: number;
  /** Alias of `cachedHits` — both increment on the same cache-HIT branch. */
  skippedUnchanged: number;
  /** Items whose `tipOf` resolved `null` (branch absent from the tip enumeration):
   *  the stored verdict was retired, `check` never ran. */
  skippedMissingBranch: number;
  errors: number;
  cursorStart: number;
  cursorEnd: number;
  nextCursor: string | null;
}

/** The zeroed summary for a throttled/early-return sweep tick — all counters 0,
 *  `nextCursor: null`. */
export function zeroSweepSummary(sweepKind: string): SweepSummary {
  return {
    sweepKind,
    candidates: 0,
    scanned: 0,
    checked: 0,
    cachedHits: 0,
    skippedUnchanged: 0,
    skippedMissingBranch: 0,
    errors: 0,
    cursorStart: 0,
    cursorEnd: 0,
    nextCursor: null,
  };
}

/** Durable cross-process verdict store, keyed by (sweepKind, item id, branch tip).
 *  Defaults to an adapter over `./worker-ledger`'s `sweep_verdict` table; failures in
 *  `put`/`retire` must never propagate into a sweep pass (see `defaultVerdictStore`). */
export interface VerdictStore {
  get(sweepKind: string, id: string, tip: string): { verdict: boolean } | null;
  put(sweepKind: string, id: string, tip: string, verdict: boolean): void;
  retire(sweepKind: string, id: string): void;
}

/** Default `VerdictStore` adapter forwarding to `./worker-ledger`'s sweep_verdict
 *  functions. `get`/`put` are already best-effort/never-throw in worker-ledger;
 *  `retire` does throw on a DB error there, so it's wrapped here — a durable-cache
 *  fault must degrade to a MISS, never abort a sweep tick. */
export const defaultVerdictStore: VerdictStore = {
  get(sweepKind, id, tip) {
    return getSweepVerdict(sweepKind, id, tip);
  },
  put(sweepKind, id, tip, verdict) {
    recordSweepVerdict({ sweepKind, epicId: id, branchTipSha: tip, verdict });
  },
  retire(sweepKind, id) {
    try {
      retireSweepVerdict(sweepKind, id);
    } catch { /* best-effort — a retire failure must not sink the sweep */ }
  },
};

export interface ItemSweepOptions<T> {
  sweepKind: string;
  items: T[];
  idOf: (item: T) => string;
  /** A resolved `null` means the branch is absent from the tip enumeration: the item's
   *  stored verdict is retired, `check`/`onHit` never run for it, and it counts toward
   *  `skippedMissingBranch` — distinct from a thrown error. */
  tipOf: (item: T) => string | null | Promise<string | null>;
  check: (item: T) => boolean | Promise<boolean>;
  /** Runs when a cached verdict is reused (cache HIT) so an idempotent positive-verdict
   *  side effect (e.g. re-surfacing a card) still fires without re-running `check`. */
  onHit?: (item: T, verdict: boolean) => void | Promise<void>;
  pageSize?: number;
  /** A string resolves via `idOf` lookup (back-compat: start just after that item, or
   *  the head if not found). A number is a direct start offset — the current form.
   *  Absent/null starts from `state.cursor`, the offset persisted by the previous call. */
  cursor?: string | number | null;
  /** Durable cross-process verdict cache; defaults to `defaultVerdictStore`. */
  store?: VerdictStore;
}

/**
 * Runs `check` only when `branchTips` differs from the last observed fingerprint on `state`.
 * When `branchTips` is unchanged, `check` is skipped and `state.skippedUnchanged` is
 * incremented. `state` is mutated in place and also returned for convenience.
 */
export async function runCachedSweep(
  state: CachedSweepState,
  options: RunCachedSweepOptions,
): Promise<CachedSweepState>;
/**
 * Per-item paged sweep with a per-item verdict cache: each item's cheap `tipOf`
 * fingerprint is compared against the last one it was checked at (stored in
 * `state.verdicts`, keyed by `idOf(item)`). Unchanged tip ⇒ cache HIT — `check` is
 * skipped and the stored verdict is handed to `onHit` so any idempotent side effect
 * still fires. Changed/absent tip ⇒ cache MISS — `check` runs and its verdict is
 * stored. A throwing `tipOf`/`check` counts as an error and stores no verdict, so the
 * item is retried on the next sweep. Processes at most `pageSize` items starting just
 * after `cursor` (an unknown/absent cursor starts at the head); `nextCursor` is the id
 * of the last item processed when items remain, or `null` when the page reached the
 * end (wrap to the head next run).
 */
export async function runCachedSweep<T>(
  state: CachedSweepState,
  options: ItemSweepOptions<T>,
): Promise<SweepSummary>;
export async function runCachedSweep<T>(
  state: CachedSweepState,
  options: RunCachedSweepOptions | ItemSweepOptions<T>,
): Promise<CachedSweepState | SweepSummary> {
  if ('items' in options) {
    return runItemSweep(state, options);
  }

  const { branchTips, check } = options;

  if (state.lastBranchTips === branchTips) {
    state.skippedUnchanged++;
    return state;
  }

  await check();
  state.lastBranchTips = branchTips;
  state.ranCount++;
  return state;
}

async function runItemSweep<T>(
  state: CachedSweepState,
  options: ItemSweepOptions<T>,
): Promise<SweepSummary> {
  const { sweepKind, items, idOf, tipOf, check, onHit, pageSize, cursor, store = defaultVerdictStore } = options;
  const summary = zeroSweepSummary(sweepKind);
  summary.candidates = items.length;

  let start: number;
  if (typeof cursor === 'number') {
    start = cursor;
  } else if (typeof cursor === 'string') {
    const idx = items.findIndex((item) => idOf(item) === cursor);
    start = idx >= 0 ? idx + 1 : 0;
  } else {
    start = state.cursor;
  }
  if (start >= items.length) start = 0;

  summary.cursorStart = start;
  const limit = pageSize ?? items.length;
  const page = items.slice(start, start + limit);
  summary.scanned = page.length;
  summary.cursorEnd = start + page.length;
  state.cursor = summary.cursorEnd;

  for (const item of page) {
    const id = idOf(item);
    try {
      const tip = await tipOf(item);
      if (tip === null) {
        summary.skippedMissingBranch++;
        store.retire(sweepKind, id);
        state.verdicts.delete(id);
        continue;
      }
      const cached = state.verdicts.get(id);
      if (cached && cached.tip === tip) {
        summary.cachedHits++;
        summary.skippedUnchanged++;
        if (onHit) await onHit(item, cached.verdict);
        continue;
      }
      const stored = store.get(sweepKind, id, tip);
      if (stored) {
        state.verdicts.set(id, { tip, verdict: stored.verdict });
        summary.cachedHits++;
        summary.skippedUnchanged++;
        if (onHit) await onHit(item, stored.verdict);
        continue;
      }
      summary.checked++;
      const verdict = await check(item);
      state.verdicts.set(id, { tip, verdict });
      store.put(sweepKind, id, tip, verdict);
    } catch {
      summary.errors++; // no verdict stored — retried next sweep
    }
  }

  const itemsRemain = start + page.length < items.length;
  summary.nextCursor = itemsRemain && page.length > 0 ? idOf(page[page.length - 1]) : null;

  return summary;
}
