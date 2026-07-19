// Runs via `bun test` (leaf-worktree-reaper pulls bun:sqlite-backed stores) — excluded from vitest.
// Verifies tickGcLeafWorktrees fires its (heavy fs+git) GC pass at most once per
// WORKTREE_GC_INTERVAL_MS, not on every ~30s coordinator tick. Clock + underlying work are
// injected so the throttle is exercised deterministically without real time or a real scan.
import { describe, it, expect } from 'bun:test';
import { tickGcLeafWorktrees, WORKTREE_GC_INTERVAL_MS, type GcReport } from '../leaf-worktree-reaper';

function makeGc() {
  let calls = 0;
  const report: GcReport = {
    removed: [],
    refused: [],
    quarantined: [],
    prunedRegistrations: 0,
    scanned: 0,
  };
  return {
    calls: () => calls,
    gc: async (_project: string): Promise<GcReport> => {
      calls += 1;
      return report;
    },
  };
}

describe('worktree-gc throttle', () => {
  it('runs the GC pass on the first call', async () => {
    const g = makeGc();
    const project = '/gc-throttle-first';
    const t = 5_000_000;
    const res = await tickGcLeafWorktrees(project, { now: t, gc: g.gc });
    expect(res).not.toBeNull();
    expect(g.calls()).toBe(1);
  });

  it('skips a second call within the interval (work not re-run)', async () => {
    const g = makeGc();
    const project = '/gc-throttle-skip';
    const t = 5_000_000;
    await tickGcLeafWorktrees(project, { now: t, gc: g.gc });
    const second = await tickGcLeafWorktrees(project, { now: t + 1, gc: g.gc }); // within interval
    expect(second).toBeNull();
    expect(g.calls()).toBe(1);
  });

  it('runs again once the injected clock advances past the interval', async () => {
    const g = makeGc();
    const project = '/gc-throttle-advance';
    const t = 5_000_000;
    await tickGcLeafWorktrees(project, { now: t, gc: g.gc });
    await tickGcLeafWorktrees(project, { now: t + 1, gc: g.gc }); // skipped
    await tickGcLeafWorktrees(project, { now: t + WORKTREE_GC_INTERVAL_MS, gc: g.gc }); // re-runs
    expect(g.calls()).toBe(2);
  });
});
