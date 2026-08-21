// Caches a sweep's verdict by the branch-tips fingerprint it was computed against, so a
// sweep pass that finds nothing changed since its last run can skip the expensive `check`
// callback entirely instead of re-running it every tick.

export interface CachedSweepState {
  lastBranchTips: string | null;
  ranCount: number;
  skippedUnchanged: number;
}

export function createCachedSweepState(): CachedSweepState {
  return { lastBranchTips: null, ranCount: 0, skippedUnchanged: 0 };
}

export interface RunCachedSweepOptions {
  branchTips: string;
  check: () => void | Promise<void>;
}

/**
 * Runs `check` only when `branchTips` differs from the last observed fingerprint on `state`.
 * When `branchTips` is unchanged, `check` is skipped and `state.skippedUnchanged` is
 * incremented. `state` is mutated in place and also returned for convenience.
 */
export async function runCachedSweep(
  state: CachedSweepState,
  options: RunCachedSweepOptions,
): Promise<CachedSweepState> {
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
