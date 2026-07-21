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
  if (!hasWorkerHeadroom()) return false;
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
  poolSlotCount = 0;
}

// --- Reconciliation (capacity-fixes FIX 1) ------------------------------------
//
// The counters above are in-process module state, incremented/decremented SYNC at
// reserve/release time. Two failure modes with no self-repair: (1) a missed release
// (a bug, or a leaf killed on a path that skips the finally) permanently inflates the
// counter and starves headroom forever; (2) a daemon restart resets the counters to 0
// while some leaves are still genuinely running, transiently over-subscribing until
// enough reserve/release churn happens to rebalance. Neither corrects itself.
//
// reconcileInflight snaps the counters to an OBSERVED-truth snapshot the caller
// supplies. The caller (coordinator-live, per periodic sweep) is responsible for
// computing that snapshot from whichever "is this leaf really running" source the
// daemon already trusts — see coordinator-live's reapOrphanedLeaves, which uses the
// durable worker-ledger `leaf_inflight` table (preferred: it is NOT reset by an
// in-process restart the way this module's own counters, or the in-memory
// leaf-subprocess-registry, are) immediately after its own per-tick reap, so every
// row left is guaranteed current-epoch AND run-live.

export interface InflightLiveCounts {
  global: number;
  perProject: Record<string, number>;
}

export interface ReconcileResult {
  /** True iff the observed snapshot differed from the in-process counters (i.e. this
   *  call actually corrected drift) — callers should only audit-log on true. */
  corrected: boolean;
  before: InflightLiveCounts;
  after: InflightLiveCounts;
}

/** Snap `globalActive`/`perProject` to `live` (observed truth). Handles drift in
 *  EITHER direction (leak-inflated too high, or restart-reset too low) and is a
 *  same-tick no-op when there is no drift. Runs synchronously, so a reservation made
 *  immediately after sees the corrected counters. */
export function reconcileInflight(live: InflightLiveCounts): ReconcileResult {
  const before: InflightLiveCounts = { global: globalActive, perProject: Object.fromEntries(perProject) };

  let changed = live.global !== globalActive;
  globalActive = Math.max(0, live.global);

  const projects = new Set([...Object.keys(live.perProject), ...perProject.keys()]);
  for (const project of projects) {
    const observed = Math.max(0, live.perProject[project] ?? 0);
    const current = perProject.get(project) ?? 0;
    if (observed !== current) changed = true;
    if (observed > 0) perProject.set(project, observed);
    else perProject.delete(project);
  }

  const after: InflightLiveCounts = { global: globalActive, perProject: Object.fromEntries(perProject) };
  return { corrected: changed, before, after };
}

// --- Machine-wide total-worker cap (capacity-fixes FIX 2) ---------------------
//
// The global/per-project caps above bound HEADLESS leaf dispatch only. worker-pool.ts
// (tmux-lane pool sessions) has its own per-project-per-type clamp (MAX_POOL_SIZE=16)
// but no machine-wide ceiling — nothing stops the two populations combined from
// spawning an unbounded fleet of full agent processes. This is a single shared
// ceiling covering BOTH: headless in-flight leaves (globalActive, tracked here) plus
// pool/tmux-lane sessions (reported in by worker-pool.ts via reportPoolSlotCount,
// since the pool registry itself lives in that module).

/** Machine-wide ceiling on TOTAL live workers (headless in-flight leaves + pool
 *  sessions combined). Default 12 is deliberately generous — a typical single-project
 *  load (≤4 headless leaves + a handful of per-type pool slots) sits well under it, so
 *  the default changes nothing for today's usage; it exists purely as a fail-closed
 *  backstop against an unbounded fleet. Override via config.json/env
 *  MERMAID_MAX_WORKERS_TOTAL. */
export function maxWorkersTotal(): number {
  return cfgInt('MERMAID_MAX_WORKERS_TOTAL', 12);
}

/** Count of pool/tmux-lane sessions currently registered, as last reported by
 *  worker-pool.ts. Kept here (not a reference to the pool's registry) so this module
 *  doesn't depend on worker-pool's types — worker-pool depends on this module, not the
 *  other way around. */
let poolSlotCount = 0;

/** worker-pool.ts calls this whenever its registry size changes (slot created/removed/
 *  reset) so the combined total-worker count stays current. */
export function reportPoolSlotCount(n: number): void {
  poolSlotCount = Math.max(0, n);
}

/** Combined machine-wide live-worker count: headless in-flight leaves + pool slots. */
export function totalWorkersActive(): number {
  return globalActive + poolSlotCount;
}

/** TRUE iff there is headroom under the machine-wide total-worker cap for one more
 *  worker (of EITHER population). Check-then-act, same atomicity contract as
 *  reserveLeafSlot: callers must check immediately before creating/reserving. */
export function hasWorkerHeadroom(): boolean {
  return totalWorkersActive() < maxWorkersTotal();
}
