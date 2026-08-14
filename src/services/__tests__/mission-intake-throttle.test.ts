// Runs via `bun test` — verifies shouldRunMissionIntakePass gates the mission-intake
// pass to at most once per MISSION_INTAKE_INTERVAL_MS per project, instead of on EVERY
// ~30s orchestrator tick and every 250ms-debounced kick (audit item 7b / E7: the pass had
// NO throttle at all). Intake drafts an UNAPPROVED mission awaiting a human, so
// sub-minute freshness buys nothing. The clock is injected so the gate is exercised
// deterministically without real time. Same idiom as mission-loop-throttle.test.ts.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunMissionIntakePass,
  MISSION_INTAKE_INTERVAL_MS,
  _resetMissionIntakeThrottle,
} from '../mission-intake';

describe('mission-intake throttle — shouldRunMissionIntakePass', () => {
  beforeEach(() => _resetMissionIntakeThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunMissionIntakePass('/mission-intake-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const project = '/mission-intake-throttle-skip';
    const t = 5_000_000;
    expect(shouldRunMissionIntakePass(project, t)).toBe(true);
    expect(shouldRunMissionIntakePass(project, t + 1)).toBe(false);
    expect(shouldRunMissionIntakePass(project, t + MISSION_INTAKE_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again once the injected clock reaches the interval boundary', () => {
    const project = '/mission-intake-throttle-advance';
    const t = 5_000_000;
    expect(shouldRunMissionIntakePass(project, t)).toBe(true);
    expect(shouldRunMissionIntakePass(project, t + 1)).toBe(false);
    expect(shouldRunMissionIntakePass(project, t + MISSION_INTAKE_INTERVAL_MS)).toBe(true);
    // and re-arms: the next within-interval call after the re-run is skipped again.
    expect(shouldRunMissionIntakePass(project, t + MISSION_INTAKE_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const a = '/mission-intake-throttle-a';
    const b = '/mission-intake-throttle-b';
    const t = 5_000_000;
    expect(shouldRunMissionIntakePass(a, t)).toBe(true);
    expect(shouldRunMissionIntakePass(b, t)).toBe(true); // b never ran — first call runs
    expect(shouldRunMissionIntakePass(a, t + 1)).toBe(false);
    expect(shouldRunMissionIntakePass(b, t + 1)).toBe(false);
  });

  it('the reset hook re-arms a single project without touching others', () => {
    const a = '/mission-intake-throttle-reset-a';
    const b = '/mission-intake-throttle-reset-b';
    const t = 5_000_000;
    expect(shouldRunMissionIntakePass(a, t)).toBe(true);
    expect(shouldRunMissionIntakePass(b, t)).toBe(true);
    _resetMissionIntakeThrottle(a);
    expect(shouldRunMissionIntakePass(a, t + 1)).toBe(true);  // reset → first-call semantics
    expect(shouldRunMissionIntakePass(b, t + 1)).toBe(false); // untouched — still throttled
  });
});
