// Runs via `bun test` (reconcile-pass pulls bun:sqlite-backed stores) — excluded from vitest.
// Verifies shouldRunReconcilePass gates the reconcile HYGIENE pass to at most once per
// RECONCILE_INTERVAL_MS per project, instead of on every ~30s orchestrator tick. The pass
// drives ~5-6 synchronous full-table todos scans, so throttling it off the every-tick cadence
// is the Phase-3 fix (mission c4eb4fcc) that keeps the shared HTTP event loop responsive.
// The clock is injected so the gate is exercised deterministically without real time.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunReconcilePass,
  RECONCILE_INTERVAL_MS,
  _resetReconcileThrottle,
} from '../reconcile-pass';

describe('reconcile throttle — shouldRunReconcilePass', () => {
  beforeEach(() => _resetReconcileThrottle());

  it('runs on the first call for a project', () => {
    const project = '/reconcile-throttle-first';
    expect(shouldRunReconcilePass(project, 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const project = '/reconcile-throttle-skip';
    const t = 5_000_000;
    expect(shouldRunReconcilePass(project, t)).toBe(true);
    expect(shouldRunReconcilePass(project, t + 1)).toBe(false);
    expect(shouldRunReconcilePass(project, t + RECONCILE_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again once the injected clock reaches the interval boundary', () => {
    const project = '/reconcile-throttle-advance';
    const t = 5_000_000;
    expect(shouldRunReconcilePass(project, t)).toBe(true);
    expect(shouldRunReconcilePass(project, t + 1)).toBe(false); // skipped
    expect(shouldRunReconcilePass(project, t + RECONCILE_INTERVAL_MS)).toBe(true); // re-runs
    // and re-arms: the next within-interval call after the re-run is skipped again.
    expect(shouldRunReconcilePass(project, t + RECONCILE_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const a = '/reconcile-throttle-a';
    const b = '/reconcile-throttle-b';
    const t = 5_000_000;
    expect(shouldRunReconcilePass(a, t)).toBe(true);
    // b has never run — its first call runs even though a just ran.
    expect(shouldRunReconcilePass(b, t)).toBe(true);
    // both are now within their own intervals.
    expect(shouldRunReconcilePass(a, t + 1)).toBe(false);
    expect(shouldRunReconcilePass(b, t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    // A small `now` (< RECONCILE_INTERVAL_MS) must still run on the first call — the gate
    // keys off "never run" (no map entry), not `now - 0 >= interval`.
    const project = '/reconcile-throttle-coldstart';
    expect(shouldRunReconcilePass(project, 10)).toBe(true);
    expect(shouldRunReconcilePass(project, 11)).toBe(false);
  });
});
