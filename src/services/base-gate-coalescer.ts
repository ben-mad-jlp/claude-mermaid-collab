/**
 * In-process single-flight coalescer around `runBaseGate`. Two independent callers
 * (`ensureBaseGreen` in leaf-executor.ts and `defaultEpicBaseProbe` in
 * conductor-infra-arm.ts) can enter `runBaseGate` concurrently for the SAME epic base —
 * this module de-duplicates concurrent runs only. It is NOT a verdict cache: the durable
 * cache stays `epic_base_gate`, and the entry here is dropped the instant its promise
 * settles.
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

const inFlight = new Map<string, Promise<LeafGateResult>>();

/** Coalesce concurrent `runBaseGate` calls sharing the same key into a single underlying
 *  run. The entry is inserted before any `await` so a synchronous second caller in the
 *  same tick coalesces, and is removed once the promise settles (success or rejection) —
 *  a settled entry is never reused, so the next call after settle always re-runs. */
export function runBaseGateShared(key: string, run: () => Promise<LeafGateResult>): Promise<LeafGateResult> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = (async () => run())();
  inFlight.set(key, p);
  const clear = () => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  };
  p.then(clear, clear);
  return p;
}

/** Test-only: clear all in-flight entries. */
export function resetBaseGateCoalescer(): void {
  inFlight.clear();
}
