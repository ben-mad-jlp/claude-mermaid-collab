// Caches a sweep's verdict by the branch-tips fingerprint it was computed against, so a
// sweep pass that finds nothing changed since its last run can skip the expensive `check`
// callback entirely instead of re-running it every tick.

export interface CachedSweepState {
  lastBranchTips: string | null;
  ranCount: number;
  skippedUnchanged: number;
  /** Per-item verdict cache (item id -> the tip fingerprint it was last computed against
   *  and the verdict computed at that tip), used by the item-form `runCachedSweep`
   *  overload below. Unused by the legacy whole-sweep form. */
  verdicts: Map<string, { tip: string; verdict: boolean }>;
}

export function createCachedSweepState(): CachedSweepState {
  return { lastBranchTips: null, ranCount: 0, skippedUnchanged: 0, verdicts: new Map() };
}

export interface RunCachedSweepOptions {
  branchTips: string;
  check: () => void | Promise<void>;
}

/** Summary of one item-form `runCachedSweep` call. Six fields, always present — a
 *  throttled early return still hands back this shape (via `zeroSweepSummary`) rather
 *  than an empty array, so callers can log `errors`/`scanned` uniformly either way. */
export interface SweepSummary {
  sweepKind: string;
  scanned: number;
  checked: number;
  cachedHits: number;
  errors: number;
  nextCursor: string | null;
}

/** The zeroed summary for a throttled/early-return sweep tick — all counters 0,
 *  `nextCursor: null`. */
export function zeroSweepSummary(sweepKind: string): SweepSummary {
  return { sweepKind, scanned: 0, checked: 0, cachedHits: 0, errors: 0, nextCursor: null };
}

export interface ItemSweepOptions<T> {
  sweepKind: string;
  items: T[];
  idOf: (item: T) => string;
  tipOf: (item: T) => string | Promise<string>;
  check: (item: T) => boolean | Promise<boolean>;
  /** Runs when a cached verdict is reused (cache HIT) so an idempotent positive-verdict
   *  side effect (e.g. re-surfacing a card) still fires without re-running `check`. */
  onHit?: (item: T, verdict: boolean) => void | Promise<void>;
  pageSize?: number;
  cursor?: string | null;
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
  const { sweepKind, items, idOf, tipOf, check, onHit, pageSize, cursor } = options;
  const summary = zeroSweepSummary(sweepKind);

  let start = 0;
  if (cursor != null) {
    const idx = items.findIndex((item) => idOf(item) === cursor);
    if (idx >= 0) start = idx + 1;
  }
  const limit = pageSize ?? items.length;
  const page = items.slice(start, start + limit);
  summary.scanned = page.length;

  for (const item of page) {
    const id = idOf(item);
    try {
      const tip = await tipOf(item);
      const cached = state.verdicts.get(id);
      if (cached && cached.tip === tip) {
        summary.cachedHits++;
        if (onHit) await onHit(item, cached.verdict);
        continue;
      }
      summary.checked++;
      const verdict = await check(item);
      state.verdicts.set(id, { tip, verdict });
    } catch {
      summary.errors++; // no verdict stored — retried next sweep
    }
  }

  const itemsRemain = start + page.length < items.length;
  summary.nextCursor = itemsRemain && page.length > 0 ? idOf(page[page.length - 1]) : null;

  return summary;
}
