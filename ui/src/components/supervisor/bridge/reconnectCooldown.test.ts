import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeCooldownGate } from './reconnectCooldown';

describe('makeCooldownGate — reconnect resync cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('first call fires immediately (a genuine reconnect resyncs with no lag)', () => {
    const fn = vi.fn();
    const gate = makeCooldownGate(fn, 15_000);
    gate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a storm inside the window coalesces into ONE trailing call at the boundary', () => {
    const fn = vi.fn();
    const gate = makeCooldownGate(fn, 15_000);
    gate(); // leading edge
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(100);
      gate();
    }
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(fn).toHaveBeenCalledTimes(2); // the whole storm cost one trailing resync
  });

  it('after a quiet period the next call is immediate again', () => {
    const fn = vi.fn();
    const gate = makeCooldownGate(fn, 15_000);
    gate();
    vi.advanceTimersByTime(15_001);
    gate();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending trailing call (unmount safety)', () => {
    const fn = vi.fn();
    const gate = makeCooldownGate(fn, 15_000);
    gate();
    gate(); // schedules trailing
    gate.cancel();
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
