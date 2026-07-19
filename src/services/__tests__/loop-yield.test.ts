/**
 * Phase 0 responsiveness guard (mission c4eb4fcc, crit-1) for src/services/loop-yield.ts.
 *
 * The falsifiable property the mission requires: a heavy per-project pass, when composed of
 * chunks with `yieldToLoop()` BETWEEN them, must not starve the shared event loop — a
 * fixed-interval heartbeat (the stand-in for an in-flight HTTP health poll) keeps firing with
 * bounded scheduling lag WHILE the pass runs. The SAME total work run WITHOUT a real macrotask
 * yield between chunks blows the bound. This encodes the exact mechanism the fix relies on and
 * is GREEN in the committed state (yield in place).
 *
 * Deterministic: the "heavy work" is a synchronous CPU busy-block (no DB, no real sleep), and the
 * yield is injected via the module's `_setYieldToLoop` seam, so the with/without contrast is the
 * only variable. Technique mirrors scripts/repro-event-loop-stall.ts, promoted to a committed test.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { yieldToLoop, _setYieldToLoop } from '../loop-yield';

// A heartbeat cadence well below the per-chunk work time, so a blocked loop is unmistakable.
const HEARTBEAT_MS = 10;
// The responsiveness bound: max heartbeat scheduling lag must stay under this while a pass runs.
const BOUND_MS = 50;
// Heavy pass shape: many synchronous chunks (mimics the interleaved bun:sqlite/fs scans).
const CHUNKS = 12;
const CHUNK_MS = 25; // one chunk blocks the loop ~25ms; total sync work ~300ms.

/** Synchronous CPU busy-block for ~ms — control never returns to the loop for its duration. */
function busyBlock(ms: number): void {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  if (x < 0) throw new Error('unreachable'); // defeat dead-code elimination
}

/** The simulated heavy pass: CHUNKS synchronous chunks with a yield BETWEEN each. The yield is
 *  whatever the module's `yieldToLoop` currently resolves to (real macrotask, or the injected
 *  microtask no-op) — that is the single variable under test. */
async function heavyPass(): Promise<void> {
  for (let i = 0; i < CHUNKS; i++) {
    busyBlock(CHUNK_MS);
    if (i < CHUNKS - 1) await yieldToLoop();
  }
}

/** Measure the max scheduling lag of a fixed-interval heartbeat while `work` runs. */
async function measureMaxLag(work: () => Promise<void>): Promise<number> {
  let maxLag = 0;
  let lastBeat = performance.now();
  const hb = setInterval(() => {
    const now = performance.now();
    const lag = now - lastBeat - HEARTBEAT_MS; // scheduling delay beyond the nominal interval
    if (lag > maxLag) maxLag = lag;
    lastBeat = now;
  }, HEARTBEAT_MS);
  try {
    // Let the heartbeat settle, then baseline right before the work.
    await new Promise((r) => setTimeout(r, 40));
    lastBeat = performance.now();
    await work();
    // One more window so post-work lag is captured.
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS * 3));
  } finally {
    clearInterval(hb);
  }
  return maxLag;
}

afterEach(() => _setYieldToLoop(null)); // restore the real macrotask yield

describe('loop-yield responsiveness guard (crit-1)', () => {
  it('WITH a real macrotask yield between chunks, max heartbeat lag stays under the bound', async () => {
    _setYieldToLoop(null); // default = setImmediate macrotask cede
    const maxLag = await measureMaxLag(heavyPass);
    // A single chunk (~25ms) is the most the loop is held at once, comfortably under BOUND_MS.
    expect(maxLag).toBeLessThan(BOUND_MS);
  });

  it('WITHOUT a macrotask yield (microtask no-op) the SAME work blows the bound — falsifiable proof', async () => {
    // A microtask (`Promise.resolve()`) does NOT cede to the timer/I-O phase, so the awaits chain
    // and the whole synchronous pass runs as one uninterrupted block — exactly the pre-fix stall.
    _setYieldToLoop(() => Promise.resolve());
    const maxLag = await measureMaxLag(heavyPass);
    // ~300ms of uninterrupted sync work → the heartbeat cannot fire until it finishes.
    expect(maxLag).toBeGreaterThan(BOUND_MS);
  });

  it('yieldToLoop resolves (cedes the loop) and is overridable via the test seam', async () => {
    let ceded = false;
    setImmediate(() => { ceded = true; });
    await yieldToLoop(); // a macrotask cede must let the queued setImmediate run first
    expect(ceded).toBe(true);

    let called = 0;
    _setYieldToLoop(async () => { called++; });
    await yieldToLoop();
    expect(called).toBe(1);
  });
});
