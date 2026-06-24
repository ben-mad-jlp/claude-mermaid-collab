// In-process concurrency limiter for headless leaf dispatch.
//
// WHY a separate in-process counter (not the leaf_inflight ledger): the
// `leaf_inflight` rows in worker-ledger are written per-NODE by the executor —
// i.e. only AFTER a leaf has started running its first node. That is too late to
// gate claim-time concurrency: a single fire-and-track tick can claim+launch
// several leaves before any of them writes a ledger row, so all would read
// count=0 and blow past the cap. This counter is incremented SYNCHRONOUSLY at
// reservation (before any await) and decremented when the leaf run settles, so it
// is an accurate same-process in-flight count for cap enforcement.
//
// The cap replaces the old throughput model where the orchestrator tick AWAITED
// each full leaf run inline (serializing the whole fleet behind one leaf). With
// fire-and-track dispatch the tick launches and returns; these caps are what now
// bound parallelism — a GLOBAL ceiling across all projects plus a PER-PROJECT
// ceiling so one project can't starve the rest.

import { getConfig } from './config-file';
import { getProjectInflightCap } from './orchestrator-config';

let globalActive = 0;
const perProject = new Map<string, number>();

/** Resolve a positive int from a string value, else the fallback. */
function posInt(v: string | undefined, def: number): number {
  if (v == null || v === '') return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Config-FIRST, env fallback (mirrors getSecret precedence): a UI change persisted to
 *  config.json wins over a stale launch-time env var. SYNCHRONOUS — the limiter's reserve
 *  is atomic (no await between the cap check and the increment). */
function cfgInt(key: string, def: number): number {
  const cfg = getConfig(key);
  if (cfg != null && cfg !== '') return posInt(cfg, def);
  return posInt(process.env[key], def);
}

/** Max headless leaves running CONCURRENTLY across ALL projects (config.json → env → 4). */
export function maxInflightGlobal(): number {
  return cfgInt('MERMAID_MAX_INFLIGHT_GLOBAL', 4);
}

/** Max headless leaves running CONCURRENTLY within a project. A per-project override
 *  (orchestrator_config.inflightCap, set via the UI) wins; else the global default
 *  (config.json → env → 2). The DB lookup is defensive — if the store is unavailable
 *  (e.g. a unit test with no DB) it falls back to the global default. */
export function maxInflightPerProject(project?: string): number {
  if (project) {
    try {
      const override = getProjectInflightCap(project);
      if (override != null) return override;
    } catch { /* DB unavailable → global default */ }
  }
  return cfgInt('MERMAID_MAX_INFLIGHT_PROJECT', 2);
}

/** Current in-flight count — global (no arg) or for one project. */
export function inflightActive(project?: string): number {
  return project == null ? globalActive : perProject.get(project) ?? 0;
}

/**
 * Atomically (no await between read and write) reserve one in-flight slot for
 * `project` IFF both the global and per-project caps have headroom. Returns true
 * and increments on success; returns false and changes nothing on failure. The
 * caller MUST pair a successful reservation with exactly one releaseLeafSlot().
 */
export function reserveLeafSlot(project: string): boolean {
  if (globalActive >= maxInflightGlobal()) return false;
  if ((perProject.get(project) ?? 0) >= maxInflightPerProject(project)) return false;
  globalActive += 1;
  perProject.set(project, (perProject.get(project) ?? 0) + 1);
  return true;
}

/** Release one previously-reserved slot for `project`. Clamped at zero so a
 *  double-release can never drive a counter negative (which would permanently
 *  inflate headroom). */
export function releaseLeafSlot(project: string): void {
  if (globalActive > 0) globalActive -= 1;
  const c = perProject.get(project) ?? 0;
  if (c > 1) perProject.set(project, c - 1);
  else perProject.delete(project);
}

/** Test-only: reset all counters. */
export function _resetLeafSlots(): void {
  globalActive = 0;
  perProject.clear();
}
