// Runs via `bun test` — verifies shouldRunMissionLoopPass gates the mission-loop pass to at
// most once per MISSION_LOOP_INTERVAL_MS per project, instead of on every ~30s orchestrator
// tick. runMissionLoopPass calls listMissions, which drives ~1+3N synchronous full-table
// todos scans (N missions) — the single heaviest per-tick block — so throttling it off the
// every-tick cadence is the Phase-4 fix (mission c4eb4fcc). The clock is injected so the gate
// is exercised deterministically without real time.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunMissionLoopPass,
  MISSION_LOOP_INTERVAL_MS,
  _resetMissionLoopThrottle,
} from '../mission-loop';

describe('mission-loop throttle — shouldRunMissionLoopPass', () => {
  beforeEach(() => _resetMissionLoopThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunMissionLoopPass('/mission-loop-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const project = '/mission-loop-throttle-skip';
    const t = 5_000_000;
    expect(shouldRunMissionLoopPass(project, t)).toBe(true);
    expect(shouldRunMissionLoopPass(project, t + 1)).toBe(false);
    expect(shouldRunMissionLoopPass(project, t + MISSION_LOOP_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again once the injected clock reaches the interval boundary', () => {
    const project = '/mission-loop-throttle-advance';
    const t = 5_000_000;
    expect(shouldRunMissionLoopPass(project, t)).toBe(true);
    expect(shouldRunMissionLoopPass(project, t + 1)).toBe(false);
    expect(shouldRunMissionLoopPass(project, t + MISSION_LOOP_INTERVAL_MS)).toBe(true);
    // and re-arms: the next within-interval call after the re-run is skipped again.
    expect(shouldRunMissionLoopPass(project, t + MISSION_LOOP_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const a = '/mission-loop-throttle-a';
    const b = '/mission-loop-throttle-b';
    const t = 5_000_000;
    expect(shouldRunMissionLoopPass(a, t)).toBe(true);
    expect(shouldRunMissionLoopPass(b, t)).toBe(true); // b never ran — first call runs
    expect(shouldRunMissionLoopPass(a, t + 1)).toBe(false);
    expect(shouldRunMissionLoopPass(b, t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    const project = '/mission-loop-throttle-coldstart';
    expect(shouldRunMissionLoopPass(project, 10)).toBe(true);
    expect(shouldRunMissionLoopPass(project, 11)).toBe(false);
  });
});
