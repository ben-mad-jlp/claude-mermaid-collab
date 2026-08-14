// Runs via `bun test` — verifies shouldRunFrictionTriagePass gates the friction-triage
// pass to at most once per FRICTION_TRIAGE_INTERVAL_MS per project, instead of on EVERY
// ~30s orchestrator tick and every 250ms-debounced kick (audit item 7b / E7: the pass had
// NO throttle at all). Filing 'planned' todos is planner-paced — a human promotes them —
// so sub-minute freshness buys nothing. The clock is injected so the gate is exercised
// deterministically without real time. Same idiom as mission-loop-throttle.test.ts.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunFrictionTriagePass,
  FRICTION_TRIAGE_INTERVAL_MS,
  _resetFrictionTriageThrottle,
} from '../friction-triage';

describe('friction-triage throttle — shouldRunFrictionTriagePass', () => {
  beforeEach(() => _resetFrictionTriageThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunFrictionTriagePass('/friction-triage-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const project = '/friction-triage-throttle-skip';
    const t = 5_000_000;
    expect(shouldRunFrictionTriagePass(project, t)).toBe(true);
    expect(shouldRunFrictionTriagePass(project, t + 1)).toBe(false);
    expect(shouldRunFrictionTriagePass(project, t + FRICTION_TRIAGE_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again once the injected clock reaches the interval boundary', () => {
    const project = '/friction-triage-throttle-advance';
    const t = 5_000_000;
    expect(shouldRunFrictionTriagePass(project, t)).toBe(true);
    expect(shouldRunFrictionTriagePass(project, t + 1)).toBe(false);
    expect(shouldRunFrictionTriagePass(project, t + FRICTION_TRIAGE_INTERVAL_MS)).toBe(true);
    // and re-arms: the next within-interval call after the re-run is skipped again.
    expect(shouldRunFrictionTriagePass(project, t + FRICTION_TRIAGE_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const a = '/friction-triage-throttle-a';
    const b = '/friction-triage-throttle-b';
    const t = 5_000_000;
    expect(shouldRunFrictionTriagePass(a, t)).toBe(true);
    expect(shouldRunFrictionTriagePass(b, t)).toBe(true); // b never ran — first call runs
    expect(shouldRunFrictionTriagePass(a, t + 1)).toBe(false);
    expect(shouldRunFrictionTriagePass(b, t + 1)).toBe(false);
  });

  it('the reset hook re-arms a single project without touching others', () => {
    const a = '/friction-triage-throttle-reset-a';
    const b = '/friction-triage-throttle-reset-b';
    const t = 5_000_000;
    expect(shouldRunFrictionTriagePass(a, t)).toBe(true);
    expect(shouldRunFrictionTriagePass(b, t)).toBe(true);
    _resetFrictionTriageThrottle(a);
    expect(shouldRunFrictionTriagePass(a, t + 1)).toBe(true);  // reset → first-call semantics
    expect(shouldRunFrictionTriagePass(b, t + 1)).toBe(false); // untouched — still throttled
  });
});
