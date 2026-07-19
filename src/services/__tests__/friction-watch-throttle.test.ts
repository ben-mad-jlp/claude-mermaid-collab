// Runs via `bun test` — verifies shouldRunFrictionWatchPass gates the whole friction-watch
// pass to at most once per FRICTION_WATCH_INTERVAL_MS per project, instead of on every ~30s
// orchestrator tick. Its listUnlandedEpics git-subprocess sweep runs every tick otherwise;
// throttling it off the every-tick cadence is the Phase-4 fix (mission c4eb4fcc). The clock is
// injected so the gate is exercised deterministically without real time.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunFrictionWatchPass,
  FRICTION_WATCH_INTERVAL_MS,
  _resetFrictionWatchThrottle,
} from '../friction-watch';

describe('friction-watch throttle — shouldRunFrictionWatchPass', () => {
  beforeEach(() => _resetFrictionWatchThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunFrictionWatchPass('/friction-watch-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const project = '/friction-watch-throttle-skip';
    const t = 5_000_000;
    expect(shouldRunFrictionWatchPass(project, t)).toBe(true);
    expect(shouldRunFrictionWatchPass(project, t + 1)).toBe(false);
    expect(shouldRunFrictionWatchPass(project, t + FRICTION_WATCH_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again once the injected clock reaches the interval boundary', () => {
    const project = '/friction-watch-throttle-advance';
    const t = 5_000_000;
    expect(shouldRunFrictionWatchPass(project, t)).toBe(true);
    expect(shouldRunFrictionWatchPass(project, t + 1)).toBe(false);
    expect(shouldRunFrictionWatchPass(project, t + FRICTION_WATCH_INTERVAL_MS)).toBe(true);
    expect(shouldRunFrictionWatchPass(project, t + FRICTION_WATCH_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const a = '/friction-watch-throttle-a';
    const b = '/friction-watch-throttle-b';
    const t = 5_000_000;
    expect(shouldRunFrictionWatchPass(a, t)).toBe(true);
    expect(shouldRunFrictionWatchPass(b, t)).toBe(true);
    expect(shouldRunFrictionWatchPass(a, t + 1)).toBe(false);
    expect(shouldRunFrictionWatchPass(b, t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    const project = '/friction-watch-throttle-coldstart';
    expect(shouldRunFrictionWatchPass(project, 10)).toBe(true);
    expect(shouldRunFrictionWatchPass(project, 11)).toBe(false);
  });
});
