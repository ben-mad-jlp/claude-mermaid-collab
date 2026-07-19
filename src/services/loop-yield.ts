/**
 * loop-yield.ts — cede the event loop between chunks of synchronous daemon work.
 *
 * Mission c4eb4fcc (design-daemon-passes-off-event-loop), Phase 1.
 *
 * The Bun sidecar serves HTTP AND runs the orchestrator daemon on ONE event loop.
 * bun:sqlite + node:fs are SYNCHRONOUS: a per-project pass that scans SQLite/fs inline,
 * with no yield, starves the loop — and therefore every in-flight HTTP request — for its
 * whole duration. The fix is not to do less work; it is to CEDE the loop between chunks
 * of the same work so HTTP (and the other independent passes) can interleave.
 *
 * `yieldToLoop()` awaits a MACROTASK (`setImmediate`), which drains the I/O + timer queues
 * — pending HTTP callbacks run — before the next chunk. A microtask (`Promise.resolve()`)
 * would NOT do this: microtasks flush before the loop services I/O, so they never let an
 * HTTP request in. `setImmediate` is the correct primitive here (the repro harness proves
 * it recovers ~86× of responsiveness on accumulated sync work).
 *
 * The impl is swappable via `_setYieldToLoop` so tests can substitute a no-op (to prove the
 * WITHOUT-yield case) or a deterministic stand-in without real macrotask latency.
 */

export type YieldFn = () => Promise<void>;

const defaultYield: YieldFn = () => new Promise<void>((resolve) => setImmediate(resolve));

let impl: YieldFn = defaultYield;

/** Cede the event loop for one macrotask so pending HTTP/I-O callbacks can run. */
export function yieldToLoop(): Promise<void> {
  return impl();
}

/** Test seam: override the yield implementation (pass null to restore the default). */
export function _setYieldToLoop(fn: YieldFn | null): void {
  impl = fn ?? defaultYield;
}
