// Runs via `bun test` (module-level Map, same runtime as build-pass-throttle.test.ts).
// Throttle-gate-only tests, no DB — modeled directly on build-pass-throttle.test.ts's
// first describe block.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunArchivalSweep,
  ARCHIVAL_SWEEP_INTERVAL_MS,
  _resetArchivalSweepThrottle,
} from '../archival-sweep';

describe('archival-sweep throttle — shouldRunArchivalSweep', () => {
  beforeEach(() => _resetArchivalSweepThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunArchivalSweep('/archival-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const t = 5_000_000;
    const p = '/archival-throttle-skip';
    expect(shouldRunArchivalSweep(p, t)).toBe(true);
    expect(shouldRunArchivalSweep(p, t + 1)).toBe(false);
    expect(shouldRunArchivalSweep(p, t + ARCHIVAL_SWEEP_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again at the interval boundary and re-arms', () => {
    const t = 5_000_000;
    const p = '/archival-throttle-advance';
    expect(shouldRunArchivalSweep(p, t)).toBe(true);
    expect(shouldRunArchivalSweep(p, t + 1)).toBe(false);
    expect(shouldRunArchivalSweep(p, t + ARCHIVAL_SWEEP_INTERVAL_MS)).toBe(true);
    expect(shouldRunArchivalSweep(p, t + ARCHIVAL_SWEEP_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const t = 5_000_000;
    expect(shouldRunArchivalSweep('/archival-throttle-a', t)).toBe(true);
    expect(shouldRunArchivalSweep('/archival-throttle-b', t)).toBe(true);
    expect(shouldRunArchivalSweep('/archival-throttle-a', t + 1)).toBe(false);
    expect(shouldRunArchivalSweep('/archival-throttle-b', t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    expect(shouldRunArchivalSweep('/archival-throttle-coldstart', 10)).toBe(true);
    expect(shouldRunArchivalSweep('/archival-throttle-coldstart', 11)).toBe(false);
  });
});
