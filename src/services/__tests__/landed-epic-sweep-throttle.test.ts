// Runs via `bun test` (module-level Map, same runtime as archival-sweep-throttle.test.ts).
// Throttle-gate-only tests, no DB — modeled directly on archival-sweep-throttle.test.ts's
// first describe block.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  shouldRunLandedEpicSweep,
  LANDED_EPIC_SWEEP_INTERVAL_MS,
  _resetLandedEpicSweepThrottle,
  runLandedEpicSweep,
} from '../landed-epic-sweep';
import { _closeProject } from '../todo-store';
import { _resetMissionDbCache } from '../mission-store';
import { _closeLedgerDb } from '../worker-ledger';
import type { GitProbe } from '../epic-branch-status';

describe('landed-epic-sweep throttle — shouldRunLandedEpicSweep', () => {
  beforeEach(() => _resetLandedEpicSweepThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const t = 5_000_000;
    const p = '/landed-epic-throttle-skip';
    expect(shouldRunLandedEpicSweep(p, t)).toBe(true);
    expect(shouldRunLandedEpicSweep(p, t + 1)).toBe(false);
    expect(shouldRunLandedEpicSweep(p, t + LANDED_EPIC_SWEEP_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again at the interval boundary and re-arms', () => {
    const t = 5_000_000;
    const p = '/landed-epic-throttle-advance';
    expect(shouldRunLandedEpicSweep(p, t)).toBe(true);
    expect(shouldRunLandedEpicSweep(p, t + 1)).toBe(false);
    expect(shouldRunLandedEpicSweep(p, t + LANDED_EPIC_SWEEP_INTERVAL_MS)).toBe(true);
    expect(shouldRunLandedEpicSweep(p, t + LANDED_EPIC_SWEEP_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const t = 5_000_000;
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-a', t)).toBe(true);
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-b', t)).toBe(true);
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-a', t + 1)).toBe(false);
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-b', t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-coldstart', 10)).toBe(true);
    expect(shouldRunLandedEpicSweep('/landed-epic-throttle-coldstart', 11)).toBe(false);
  });
});

describe('runLandedEpicSweep — force bypass + yield-between-batches', () => {
  let project: string;

  beforeEach(() => {
    _resetLandedEpicSweepThrottle();
    project = mkdtempSync(join(tmpdir(), 'landed-epic-sweep-throttle-'));
  });
  afterEach(() => {
    _closeProject(project);
    _resetMissionDbCache(project);
    _closeLedgerDb();
    rmSync(project, { recursive: true, force: true });
  });

  it('does not block: yieldFn is invoked between reconcile and gc batches when forced', async () => {
    const probe: GitProbe = () => ({ exists: false, ahead: null, behind: null, mergeable: null });
    const runner = {
      revParse: () => null,
      deleteBranch: () => false,
      listEpicBranches: () => [],
      aheadCount: () => 0,
    };

    let yieldCalls = 0;
    const result = await runLandedEpicSweep(project, {
      force: true,
      probe,
      runner,
      yieldFn: async () => {
        yieldCalls++;
      },
    });

    expect(yieldCalls).toBeGreaterThanOrEqual(1);
    expect(result.reconcile).toEqual({ reconciled: [], skipped: 0 });
    expect(result.gc).toEqual({ deleted: [], flagged: [], skipped: 0 });
  });
});
