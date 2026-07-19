// Runs via `bun test` (orchestrator-live pulls bun:sqlite-backed stores) — excluded from vitest.
// Phase 5 (mission c4eb4fcc): the Zen summary heartbeat (runSessionSummaryTick) does a per-session
// pane-capture + diagnoseClaimSuppression sweep (listReadyTodos/listTodos on the 8MB DB) on every
// 30s beat. Zen cards do not need 30s freshness, so shouldRunSummaryHeartbeat gates the per-session
// work to at most once per SUMMARY_HEARTBEAT_INTERVAL_MS. The clock is injected for determinism.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunSummaryHeartbeat,
  SUMMARY_HEARTBEAT_INTERVAL_MS,
  _resetSummaryHeartbeatThrottle,
} from '../orchestrator-live';

describe('summary heartbeat throttle — shouldRunSummaryHeartbeat', () => {
  beforeEach(() => _resetSummaryHeartbeatThrottle());

  it('runs on the first beat (boot freshness) regardless of absolute clock value', () => {
    expect(shouldRunSummaryHeartbeat(10)).toBe(true);
  });

  it('skips subsequent beats within the interval', () => {
    const t = 5_000_000;
    expect(shouldRunSummaryHeartbeat(t)).toBe(true);
    expect(shouldRunSummaryHeartbeat(t + 1)).toBe(false);
    expect(shouldRunSummaryHeartbeat(t + SUMMARY_HEARTBEAT_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again at the interval boundary and re-arms', () => {
    const t = 5_000_000;
    expect(shouldRunSummaryHeartbeat(t)).toBe(true);
    expect(shouldRunSummaryHeartbeat(t + 1)).toBe(false);
    expect(shouldRunSummaryHeartbeat(t + SUMMARY_HEARTBEAT_INTERVAL_MS)).toBe(true);
    expect(shouldRunSummaryHeartbeat(t + SUMMARY_HEARTBEAT_INTERVAL_MS + 1)).toBe(false);
  });

  it('is a single global clock (not per-project — the heartbeat is process-wide)', () => {
    const t = 5_000_000;
    expect(shouldRunSummaryHeartbeat(t)).toBe(true);
    // A second call at the same instant is throttled (there is no project key to reset it).
    expect(shouldRunSummaryHeartbeat(t)).toBe(false);
  });
});
