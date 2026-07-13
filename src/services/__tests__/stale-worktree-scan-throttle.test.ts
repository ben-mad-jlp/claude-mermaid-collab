// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFrictionWatchPass } from '../friction-watch';
import { _closeProject } from '../friction-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'stale-throttle-')); });
afterEach(() => { _closeProject(project); rmSync(project, { recursive: true, force: true }); });

function makeCountingWm() {
  let staleCalls = 0;
  return {
    calls: () => staleCalls,
    listUnlandedEpics: async () => [],
    listStaleWorktrees: async () => { staleCalls += 1; return []; },
  };
}

describe('stale-worktree scan throttle', () => {
  it('scans once for two passes with the same injected now inside the interval', async () => {
    const wm = makeCountingWm();
    const t = 1_000_000;
    await runFrictionWatchPass(project, wm, { now: t });
    await runFrictionWatchPass(project, wm, { now: t }); // within interval → skipped
    expect(wm.calls()).toBe(1);
  });

  it('scans again once now advances past STALE_WORKTREE_SCAN_INTERVAL_MS', async () => {
    const wm = makeCountingWm();
    const t = 1_000_000;
    await runFrictionWatchPass(project, wm, { now: t });
    await runFrictionWatchPass(project, wm, { now: t + 300_000 }); // >= interval → re-scan
    expect(wm.calls()).toBe(2);
  });

  it('force:true bypasses the throttle even inside the interval', async () => {
    const wm = makeCountingWm();
    const t = 1_000_000;
    await runFrictionWatchPass(project, wm, { now: t });
    await runFrictionWatchPass(project, wm, { now: t, force: true }); // forced re-scan
    expect(wm.calls()).toBe(2);
  });
});
