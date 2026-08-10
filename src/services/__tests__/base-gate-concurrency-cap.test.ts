/**
 * Coverage for the per-project concurrency cap in the base-gate coalescer.
 *
 * Coalescing alone cannot bound the fan-out: `baseGateKey` includes each epic's own base
 * sha, so N open epics produce N DISTINCT keys and nothing merges across them. Each gate
 * is a full typecheck plus the whole backend suite, so an uncapped fan-out (one land or
 * one sidecar restart invalidates every open epic's verdict at the same instant)
 * saturates the box — which starves the sidecar's health probes, gets it killed and
 * restarted, and re-invalidates every verdict. These tests pin the cap that breaks it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  runBaseGateShared,
  resetBaseGateCoalescer,
  maxConcurrentBaseGates,
} from '../base-gate-coalescer';
import type { LeafGateResult } from '../leaf-gate';

const PASS: LeafGateResult = { status: 'pass', output: '', reasons: [], declared: true };

/** A run whose completion the test controls, so overlap is observable rather than timed. */
function deferredRun() {
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  return { gate, release };
}

/** Tracks how many runs are executing at once and the high-water mark. */
function concurrencyTracker() {
  const state = { live: 0, peak: 0, started: 0 };
  const wrap = (body: Promise<void>) => async (): Promise<LeafGateResult> => {
    state.started += 1;
    state.live += 1;
    state.peak = Math.max(state.peak, state.live);
    try {
      await body;
      return PASS;
    } finally {
      state.live -= 1;
    }
  };
  return { state, wrap };
}

const ORIGINAL_ENV = process.env.MERMAID_MAX_CONCURRENT_BASE_GATES;

beforeEach(() => {
  resetBaseGateCoalescer();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.MERMAID_MAX_CONCURRENT_BASE_GATES;
  else process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = ORIGINAL_ENV;
  resetBaseGateCoalescer();
});

describe('base-gate per-project concurrency cap', () => {
  it('never runs more than the cap concurrently, however many distinct epics fan out', async () => {
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '2';
    const { state, wrap } = concurrencyTracker();
    const d = deferredRun();

    // Eight epics, eight DISTINCT keys (distinct base shas) — the real fan-out shape.
    const all = Array.from({ length: 8 }, (_, i) =>
      runBaseGateShared(`["/p","sha${i}",[]]`, wrap(d.gate), { project: '/p' }),
    );

    // Let every queued caller reach the semaphore before anything is allowed to finish.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.live).toBe(2);
    expect(state.started).toBe(2);

    d.release();
    await Promise.all(all);

    expect(state.started).toBe(8); // all eight really ran
    expect(state.peak).toBe(2); // but never more than two at a time
  });

  it('does not let one project block another', async () => {
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '1';
    const { state, wrap } = concurrencyTracker();
    const d = deferredRun();

    const a = runBaseGateShared('["/a","sha",[]]', wrap(d.gate), { project: '/a' });
    const b = runBaseGateShared('["/b","sha",[]]', wrap(d.gate), { project: '/b' });

    await new Promise((r) => setTimeout(r, 0));
    // One slot EACH, not one slot total: a busy project must not starve its neighbours.
    expect(state.live).toBe(2);

    d.release();
    await Promise.all([a, b]);
  });

  it('still coalesces same-key callers instead of consuming two slots', async () => {
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '2';
    const { state, wrap } = concurrencyTracker();
    const d = deferredRun();

    const first = runBaseGateShared('["/p","same",[]]', wrap(d.gate), { project: '/p' });
    const second = runBaseGateShared('["/p","same",[]]', wrap(d.gate), { project: '/p' });
    expect(second).toBe(first); // same promise ⇒ one underlying run

    await new Promise((r) => setTimeout(r, 0));
    expect(state.started).toBe(1);

    d.release();
    expect(await first).toEqual(PASS);
    expect(await second).toEqual(PASS);
    expect(state.started).toBe(1);
  });

  it('releases the slot when a run rejects, so the queue still drains', async () => {
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '1';
    let secondRan = false;

    const boom = runBaseGateShared('["/p","a",[]]', async () => {
      throw new Error('gate blew up');
    }, { project: '/p' });
    const next = runBaseGateShared('["/p","b",[]]', async () => {
      secondRan = true;
      return PASS;
    }, { project: '/p' });

    await expect(boom).rejects.toThrow('gate blew up');
    expect(await next).toEqual(PASS);
    expect(secondRan).toBe(true); // a failed gate must not strand its slot forever
  });

  it('falls back to the default cap on a missing or nonsensical override', () => {
    delete process.env.MERMAID_MAX_CONCURRENT_BASE_GATES;
    expect(maxConcurrentBaseGates()).toBe(2);
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = 'banana';
    expect(maxConcurrentBaseGates()).toBe(2);
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '0';
    expect(maxConcurrentBaseGates()).toBe(2); // 0 must not silently disable the cap
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '4';
    expect(maxConcurrentBaseGates()).toBe(4);
  });
});
