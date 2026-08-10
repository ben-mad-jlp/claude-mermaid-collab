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
  maxConcurrentBaseGatesGlobal,
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
const ORIGINAL_ENV_GLOBAL = process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL;

beforeEach(() => {
  resetBaseGateCoalescer();
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.MERMAID_MAX_CONCURRENT_BASE_GATES;
  else process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = ORIGINAL_ENV;
  if (ORIGINAL_ENV_GLOBAL === undefined) delete process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL;
  else process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL = ORIGINAL_ENV_GLOBAL;
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

describe('the GLOBAL cap — what the per-project cap does not bound', () => {
  // 2026-08-10: two projects were `on`, each INSIDE its per-project cap of 2, and the sidecar was
  // SIGKILLed twice in twelve minutes. Each gate itself fans out to `--concurrency=6` bun test
  // children, so the box saw 2 x 2 x 6 = 24 processes on 14 cores. Nothing was uncapped — the
  // per-project caps simply multiplied, and the total was bounded nowhere.
  it('holds the TOTAL across projects, not just per project', async () => {
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES = '2';        // per-project: generous
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL = '2'; // global: the real ceiling
    const { state, wrap } = concurrencyTracker();
    const d = [deferredRun(), deferredRun(), deferredRun(), deferredRun()];

    // Four gates over two projects: within BOTH per-project caps, over the global one.
    const all = [
      runBaseGateShared('a1', wrap(d[0]!.gate), { project: '/proj/a' }),
      runBaseGateShared('a2', wrap(d[1]!.gate), { project: '/proj/a' }),
      runBaseGateShared('b1', wrap(d[2]!.gate), { project: '/proj/b' }),
      runBaseGateShared('b2', wrap(d[3]!.gate), { project: '/proj/b' }),
    ];
    await Promise.resolve(); await Promise.resolve();

    expect(state.peak).toBe(2); // the per-project caps alone would have permitted 4

    for (const x of d) x.release();
    await Promise.all(all);
    expect(state.peak).toBe(2);
  });

  it('throttles rather than drops: a queued gate runs once a slot frees', async () => {
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL = '1';
    const { state, wrap } = concurrencyTracker();
    const first = deferredRun();
    const second = deferredRun();

    const a = runBaseGateShared('k1', wrap(first.gate), { project: '/proj/a' });
    const b = runBaseGateShared('k2', wrap(second.gate), { project: '/proj/b' });
    await Promise.resolve(); await Promise.resolve();
    expect(state.started).toBe(1); // the second is waiting, not rejected

    first.release();
    await a;
    await Promise.resolve(); await Promise.resolve();
    expect(state.started).toBe(2); // and it starts when the slot frees

    second.release();
    await b;
  });

  it('a bad env value falls back to the default instead of uncapping', () => {
    // A typo must never become a way to reopen the fan-out that killed the sidecar.
    for (const bad of ['0', '-3', 'lots', '']) {
      process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL = bad;
      expect(maxConcurrentBaseGatesGlobal()).toBe(2);
    }
    delete process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL;
    expect(maxConcurrentBaseGatesGlobal()).toBe(2);
  });
});
