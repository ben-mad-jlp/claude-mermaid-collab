// Runs via `bun test` — verifies shouldRunNotificationTick gates the notification tick to at
// most once per NOTIFY_INTERVAL_MS per project, instead of on every ~30s orchestrator tick.
// When a project has subscriptions the tick does a full-table todos scan to diff against its
// last snapshot; the diff is cumulative + nudges are already throttled, so throttling the scan
// off the every-tick cadence is the Phase-4 fix (mission c4eb4fcc). The clock is injected so
// the gate is exercised deterministically without real time.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunNotificationTick,
  NOTIFY_INTERVAL_MS,
  _resetNotifyThrottle,
} from '../session-notification-tick';

describe('notify throttle — shouldRunNotificationTick', () => {
  beforeEach(() => _resetNotifyThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunNotificationTick('/notify-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const project = '/notify-throttle-skip';
    const t = 5_000_000;
    expect(shouldRunNotificationTick(project, t)).toBe(true);
    expect(shouldRunNotificationTick(project, t + 1)).toBe(false);
    expect(shouldRunNotificationTick(project, t + NOTIFY_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again once the injected clock reaches the interval boundary', () => {
    const project = '/notify-throttle-advance';
    const t = 5_000_000;
    expect(shouldRunNotificationTick(project, t)).toBe(true);
    expect(shouldRunNotificationTick(project, t + 1)).toBe(false);
    expect(shouldRunNotificationTick(project, t + NOTIFY_INTERVAL_MS)).toBe(true);
    expect(shouldRunNotificationTick(project, t + NOTIFY_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const a = '/notify-throttle-a';
    const b = '/notify-throttle-b';
    const t = 5_000_000;
    expect(shouldRunNotificationTick(a, t)).toBe(true);
    expect(shouldRunNotificationTick(b, t)).toBe(true);
    expect(shouldRunNotificationTick(a, t + 1)).toBe(false);
    expect(shouldRunNotificationTick(b, t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    const project = '/notify-throttle-coldstart';
    expect(shouldRunNotificationTick(project, 10)).toBe(true);
    expect(shouldRunNotificationTick(project, 11)).toBe(false);
  });
});
