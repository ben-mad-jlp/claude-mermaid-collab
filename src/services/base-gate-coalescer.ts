/**
 * In-process single-flight coalescer around `runBaseGate`. Two independent callers
 * (`ensureBaseGreen` in leaf-executor.ts and `defaultEpicBaseProbe` in
 * conductor-infra-arm.ts) can enter `runBaseGate` concurrently for the SAME epic base —
 * this module de-duplicates concurrent runs only. It is NOT a verdict cache: the durable
 * cache stays `epic_base_gate`, and the entry here is dropped the instant its promise
 * settles.
 *
 * It ALSO bounds how many base gates may run at once, per project AND globally. Coalescing
 * alone cannot
 * do that: `baseGateKey` includes the epic's own base sha, so N open epics produce N
 * distinct keys and nothing merges across them. Each gate is a full typecheck plus the
 * whole backend suite, so an uncapped fan-out (one land or one restart invalidates every
 * open epic's verdict at the same instant) saturates the box, which starves the sidecar's
 * health probes, which gets it killed and restarted — re-invalidating every verdict and
 * starting the storm over. The cap is what breaks that loop.
 */
import type { LeafGateConfig, LeafGateResult } from './leaf-gate.js';

/** Stable signature for a base-gate run: project + baseSha + the exact lane sequence
 *  `runBaseGate` would execute, in its fixed order (leaf-gate.ts:807-830), each lane
 *  carrying its command AND its worktree-relative cwd (two lanes can share a command and
 *  differ only in cwd, and cwd is part of what actually runs — leaf-gate.ts:832). */
export function baseGateKey(project: string, baseSha: string | null | undefined, cfg: LeafGateConfig | null): string {
  const lanes: Array<{ command: string; cwd?: string }> = [];
  if (cfg) {
    if (cfg.typecheck) {
      lanes.push({ command: cfg.typecheck });
    }
    for (const l of cfg.typechecks ?? []) {
      lanes.push({ command: l.command, cwd: l.cwd });
    }
    for (const l of cfg.suites ?? []) {
      lanes.push({ command: l.command, cwd: l.cwd });
    }
    for (const l of cfg.floors ?? []) {
      lanes.push({ command: l.command, cwd: l.cwd });
    }
    if (cfg.baseTest) {
      lanes.push({ command: cfg.baseTest });
    }
  }
  return JSON.stringify([project, baseSha ?? '', lanes]);
}

const DEFAULT_MAX_CONCURRENT_BASE_GATES = 2;

/**
 * Global ceiling across ALL projects. The per-project cap alone does not bound the box, and on
 * 2026-08-10 that is what killed the sidecar twice in twelve minutes: two projects were `on`,
 * each within its cap of 2, and EACH GATE itself fans out to `--concurrency=6` `bun test`
 * children (scripts/test-backend.ts). 2 projects x 2 gates x 6 = 24 processes on a 14-core box.
 * Nothing was uncapped; the caps simply multiplied, and the count that matters — processes, not
 * gates — was never bounded anywhere.
 *
 * Deliberately a small constant rather than a function of core count. The fan-out per gate is
 * decided in the test script, so any core-based arithmetic here would be guessing at a number it
 * cannot see; 2 gates keeps the worst case near the machine's width and leaves the sidecar room
 * to answer its health probe, which is the whole point.
 */
const DEFAULT_MAX_CONCURRENT_BASE_GATES_GLOBAL = 2;

/** Bucket key for the global slot pool. Not a legal project path, so it cannot collide. */
const GLOBAL_BUCKET = '\u0000global';

/** How many base gates may execute at once for a single project. Env override exists so a
 *  saturated or unusually large box can be tuned without a redeploy; anything unparseable
 *  or below 1 falls back to the default rather than disabling the cap. */
export function maxConcurrentBaseGates(): number {
  return readLimit(process.env.MERMAID_MAX_CONCURRENT_BASE_GATES, DEFAULT_MAX_CONCURRENT_BASE_GATES);
}

/** How many base gates may execute at once across EVERY project. Same override contract. */
export function maxConcurrentBaseGatesGlobal(): number {
  return readLimit(
    process.env.MERMAID_MAX_CONCURRENT_BASE_GATES_GLOBAL,
    DEFAULT_MAX_CONCURRENT_BASE_GATES_GLOBAL,
  );
}

/** Anything unparseable or below 1 falls back to the default rather than DISABLING the cap —
 *  a typo in an env var must not be a way to uncork the fan-out that killed the sidecar. */
function readLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

const inFlight = new Map<string, Promise<LeafGateResult>>();

/** Slots currently held per project, and the FIFO of callers waiting for one. */
const running = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();

function acquire(project: string, limit: number): Promise<void> | null {
  const held = running.get(project) ?? 0;
  if (held < limit) {
    running.set(project, held + 1);
    return null; // free slot ⇒ no await, the caller proceeds synchronously
  }
  return new Promise<void>((resolve) => {
    const q = waiting.get(project);
    if (q) q.push(resolve);
    else waiting.set(project, [resolve]);
  });
}

function release(project: string): void {
  const q = waiting.get(project);
  if (q && q.length > 0) {
    // Hand the slot straight to the next waiter: `running` stays unchanged, so the count
    // can never dip below the cap while work is still queued.
    const next = q.shift()!;
    if (q.length === 0) waiting.delete(project);
    next();
    return;
  }
  const held = running.get(project) ?? 1;
  if (held <= 1) running.delete(project);
  else running.set(project, held - 1);
}

/** Coalesce concurrent `runBaseGate` calls sharing the same key into a single underlying
 *  run, and cap how many distinct runs execute concurrently per project. The in-flight
 *  entry is inserted before any `await` so a synchronous second caller in the same tick
 *  coalesces, and is removed once the promise settles (success or rejection) — a settled
 *  entry is never reused, so the next call after settle always re-runs. A queued caller
 *  still holds its in-flight entry, so late callers for the same key coalesce onto it
 *  rather than queueing a second time. */
export function runBaseGateShared(
  key: string,
  run: () => Promise<LeafGateResult>,
  opts?: { project?: string },
): Promise<LeafGateResult> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  // Callers that don't name a project share one bucket rather than escaping the cap.
  const project = opts?.project ?? '';
  const limit = maxConcurrentBaseGates();

  const p = (async () => {
    // GLOBAL first, then project — a fixed acquisition order, so two callers can never each
    // hold one slot while waiting for the other's. Both are released in reverse.
    const waitGlobal = acquire(GLOBAL_BUCKET, maxConcurrentBaseGatesGlobal());
    if (waitGlobal) await waitGlobal;
    try {
      const waitProject = acquire(project, limit);
      if (waitProject) await waitProject;
      try {
        return await run();
      } finally {
        release(project);
      }
    } finally {
      release(GLOBAL_BUCKET);
    }
  })();
  inFlight.set(key, p);
  const clear = () => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  };
  p.then(clear, clear);
  return p;
}

/** Test-only: clear all in-flight entries and release every queued/held slot. */
export function resetBaseGateCoalescer(): void {
  inFlight.clear();
  running.clear();
  for (const q of waiting.values()) for (const resolve of q) resolve();
  waiting.clear();
}
