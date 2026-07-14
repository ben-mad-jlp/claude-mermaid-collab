/**
 * Unit tests for the P3 process-wide headless circuit breaker.
 *
 * The clock is INJECTED (every breaker fn takes an explicit `now`) so there are no
 * timers and no live claude / real 429. State is process-wide module state, so each
 * test calls `resetBreaker()` first to isolate.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  tripBreaker,
  breakerOpen,
  breakerOpenUntil,
  resetBreaker,
  enqueuePausedLeaf,
  pausedNodesSpent,
  pausedLeavesFor,
  recordResume,
  drainResumable,
  breakerExhausted,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  MAX_TOTAL_WAIT_MS,
} from '../headless-breaker';
import type { LeafPaused } from '../headless-breaker';

const T0 = 1_000_000;
const paused = (over: Partial<LeafPaused> = {}): LeafPaused => ({
  atNode: 'blueprint',
  attempt: 1,
  nodesSpent: 3,
  ...over,
});

beforeEach(() => resetBreaker());

describe('tripBreaker / breakerOpen — exponential backoff', () => {
  it('(ii) trip with no capReset → open until now + BASE_BACKOFF; closed once clock passes it', () => {
    tripBreaker(undefined, T0);
    expect(breakerOpenUntil()).toBe(T0 + BASE_BACKOFF_MS);
    expect(breakerOpen(T0)).toBe(true);
    expect(breakerOpen(T0 + BASE_BACKOFF_MS - 1)).toBe(true);
    expect(breakerOpen(T0 + BASE_BACKOFF_MS)).toBe(false); // now === openUntil ⇒ closed
  });

  it('(iii) consecutive trips lengthen the backoff exponentially, capped at MAX_BACKOFF_MS', () => {
    tripBreaker(undefined, T0);
    expect(breakerOpenUntil()).toBe(T0 + BASE_BACKOFF_MS); // 1×
    tripBreaker(undefined, T0);
    expect(breakerOpenUntil()).toBe(T0 + BASE_BACKOFF_MS * 2); // 2×
    tripBreaker(undefined, T0);
    expect(breakerOpenUntil()).toBe(T0 + BASE_BACKOFF_MS * 4); // 4×
    // keep tripping until the ceiling pins it
    for (let i = 0; i < 12; i += 1) tripBreaker(undefined, T0);
    expect(breakerOpenUntil()).toBe(T0 + MAX_BACKOFF_MS);
  });

  it('capReset (when in the future) sets openUntil exactly to it', () => {
    const reset = T0 + 5 * 60_000;
    tripBreaker(reset, T0);
    expect(breakerOpenUntil()).toBe(reset);
    expect(breakerOpen(reset - 1)).toBe(true);
    expect(breakerOpen(reset)).toBe(false);
  });

  it('a stale (past) capReset falls back to exponential backoff', () => {
    tripBreaker(T0 - 1, T0);
    expect(breakerOpenUntil()).toBe(T0 + BASE_BACKOFF_MS);
  });

  it('never SHORTENS an existing hold (takes the later openUntil)', () => {
    tripBreaker(T0 + 10 * 60_000, T0); // long capReset
    const long = breakerOpenUntil();
    tripBreaker(undefined, T0); // short backoff
    expect(breakerOpenUntil()).toBe(long);
  });

  it('(iv) resetBreaker clears the window AND the backoff streak', () => {
    tripBreaker(undefined, T0);
    tripBreaker(undefined, T0);
    resetBreaker();
    expect(breakerOpen(T0)).toBe(false);
    tripBreaker(undefined, T0); // streak reset → back to 1× base
    expect(breakerOpenUntil()).toBe(T0 + BASE_BACKOFF_MS);
  });

  it('clamps a far-future capReset to MAX_BACKOFF_MS (re-probe ceiling), and re-trips on a second 429', () => {
    const farReset = T0 + 2 * 60 * 60_000; // 2h out — unconfirmed cap
    tripBreaker(farReset, T0);
    // Hold is capped at the 30-min re-probe ceiling, NOT the claimed 2h.
    expect(breakerOpenUntil()).toBe(T0 + MAX_BACKOFF_MS);
    expect(breakerOpen(T0 + MAX_BACKOFF_MS - 1)).toBe(true);
    expect(breakerOpen(T0 + MAX_BACKOFF_MS)).toBe(false); // probe allowed once ceiling passes

    // A second 429 after the probe re-trips on a fresh (still far) capReset.
    const now2 = T0 + MAX_BACKOFF_MS;
    const farReset2 = now2 + 2 * 60 * 60_000;
    tripBreaker(farReset2, now2);
    expect(breakerOpenUntil()).toBe(now2 + MAX_BACKOFF_MS);
    expect(breakerOpen(now2)).toBe(true);
  });
});

describe('paused-leaf registry', () => {
  it('enqueue + pausedNodesSpent carries the prior budget forward (v)', () => {
    enqueuePausedLeaf('proj', 'leaf-1', paused({ nodesSpent: 7 }), T0);
    expect(pausedNodesSpent('proj', 'leaf-1')).toBe(7);
    expect(pausedNodesSpent('proj', 'unknown')).toBe(0);
  });

  it('re-pausing the same leaf preserves the FIRST trip time (for exhaustion)', () => {
    enqueuePausedLeaf('proj', 'leaf-1', paused(), T0);
    enqueuePausedLeaf('proj', 'leaf-1', paused({ nodesSpent: 6 }), T0 + 60_000);
    const [entry] = pausedLeavesFor('proj');
    expect(entry.firstTrippedAt).toBe(T0);
    expect(entry.paused.nodesSpent).toBe(6); // latest paused state retained
  });

  it('recordResume drops the entry', () => {
    enqueuePausedLeaf('proj', 'leaf-1', paused(), T0);
    recordResume('proj', 'leaf-1');
    expect(pausedLeavesFor('proj')).toHaveLength(0);
  });

  it('pausedLeavesFor scopes by project', () => {
    enqueuePausedLeaf('a', 'l1', paused(), T0);
    enqueuePausedLeaf('b', 'l2', paused(), T0);
    expect(pausedLeavesFor('a')).toHaveLength(1);
    expect(pausedLeavesFor('a')[0].todoId).toBe('l1');
  });

  it('drainResumable returns [] while open, returns + clears once closed', () => {
    tripBreaker(undefined, T0);
    enqueuePausedLeaf('proj', 'leaf-1', paused(), T0);
    expect(drainResumable(T0)).toEqual([]); // window open
    expect(pausedLeavesFor('proj')).toHaveLength(1); // not cleared
    const out = drainResumable(T0 + BASE_BACKOFF_MS); // closed
    expect(out).toHaveLength(1);
    expect(pausedLeavesFor('proj')).toHaveLength(0); // drained
  });
});

describe('breakerExhausted (vi)', () => {
  it('false before the 2h ceiling, true once past it', () => {
    expect(breakerExhausted(T0, T0 + MAX_TOTAL_WAIT_MS - 1)).toBe(false);
    expect(breakerExhausted(T0, T0 + MAX_TOTAL_WAIT_MS)).toBe(true);
  });
  it('a zero firstTrippedAt is never exhausted', () => {
    expect(breakerExhausted(0, T0 + MAX_TOTAL_WAIT_MS * 10)).toBe(false);
  });
});
