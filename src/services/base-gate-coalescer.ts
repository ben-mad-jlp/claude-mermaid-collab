/**
 * In-process single-flight coalescer around `runBaseGate`. Two independent callers
 * (`ensureBaseGreen` in leaf-executor.ts and `defaultEpicBaseProbe` in
 * conductor-infra-arm.ts) can enter `runBaseGate` concurrently for the SAME epic base —
 * this module de-duplicates concurrent runs. The durable per-EPIC cache stays
 * `epic_base_gate`, and the in-flight entry here is dropped the instant its promise
 * settles.
 *
 * LAYERED IN FRONT of the run (opt-in via `opts.verdict`) sits the durable SHARED verdict
 * (`base_gate_verdict` in the worker ledger): keyed by what was measured — project, baseSha,
 * lane signature, active-quarantine-set hash — not by who asked. Sibling epics
 * forward-integrated to the same base sha resolve to the same key and consume ONE stored
 * measurement with zero suite spawns, instead of each re-running the ~20-minute suite
 * serially (only in-flight runs coalesced before; 3 siblings on one sha starved 6 claimed
 * leaves for an hour, 2026-08-13). Reuse is ASYMMETRIC: a PASS is served indefinitely while
 * the key matches, a FAIL only within a bounded budget — a flake-red has nothing to commit,
 * so the base sha never moves, and without the budget one false red would pin every sibling
 * forever.
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
import { createHash } from 'node:crypto';
import type { LeafGateConfig, LeafGateResult } from './leaf-gate.js';
import { getBaseGateVerdict, recordBaseGateVerdict, takeBaseGateFailServe } from './worker-ledger.js';

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

/** A stored FAIL may be served to at most this many consumers before the next asker must
 *  re-measure. Deliberately small: each serve propagates a possibly-flaky red to another
 *  epic's leaves, and the whole point of the budget is that ONE re-measure is always within
 *  two consumers' reach. */
export const BASE_GATE_FAIL_VERDICT_SERVE_BUDGET = 2;

/** A stored FAIL older than this is never served regardless of remaining budget — the
 *  wall-clock half of "2 consumers or 15 minutes, whichever first". */
export const BASE_GATE_FAIL_VERDICT_TTL_MS = 15 * 60_000;

/** Hash of the ACTIVE quarantine set (sorted test names), the third leg of the shared
 *  verdict key. Quarantining or un-quarantining a test changes this hash, which changes the
 *  key — that IS the invalidation for quarantine edits; no explicit delete is needed, the
 *  old row is simply never looked up again. */
export function quarantineSetHash(tests: string[]): string {
  return createHash('sha256').update(JSON.stringify([...tests].sort())).digest('hex');
}

/** The durable row's key: the coalescer key (project+baseSha+lanes) extended with the
 *  quarantine-set hash. Exported so tests assert on real rows instead of duplicating the
 *  format. */
export function sharedVerdictKey(coalescerKey: string, quarantineHash: string): string {
  return `${coalescerKey}|q:${quarantineHash}`;
}

/** What a caller must know about itself to participate in the durable shared verdict.
 *  Absent ⇒ pure single-flight + cap semantics, no ledger touch (explicit re-measures and
 *  callers with no citable base sha stay out of the shared layer). */
export interface SharedVerdictScope {
  project: string;
  baseSha: string;
  quarantineHash: string;
  /** Injectable clock for the FAIL TTL (tests must control time; defaults to Date.now). */
  now?: () => number;
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

/** Observability sidecar for `inFlight` — WHY the map's entries exist and since when, so the
 *  UI can tell a leaf queued behind a long base gate apart from a dead one. Written strictly
 *  in lockstep with `inFlight` (set before the run's promise is stored, deleted by the same
 *  settle handler). Never consulted by the coalescing logic itself. */
interface InflightGateMeta {
  project: string;
  baseSha: string | null;
  /** Every epic that dispatched or coalesced onto this run — recorded from `opts.epicId`
   *  at the call site, so the leaf↔gate join downstream is exact, not inferred. */
  epicIds: Set<string>;
  startedAt: number;
  /** true once the run holds its concurrency slots and is actually executing;
   *  false while it is still queued behind the per-project/global caps. */
  running: boolean;
}
const inFlightMeta = new Map<string, InflightGateMeta>();

export interface InflightBaseGate {
  key: string;
  project: string;
  baseSha: string | null;
  epicIds: string[];
  startedAt: number;
  running: boolean;
}

/** Read-only snapshot of the base gates in flight right now (executing OR queued behind the
 *  caps). Purely observational — mutating the result changes nothing. */
export function listInflightBaseGates(): InflightBaseGate[] {
  return [...inFlightMeta.entries()].map(([key, m]) => ({
    key,
    project: m.project,
    baseSha: m.baseSha,
    epicIds: [...m.epicIds],
    startedAt: m.startedAt,
    running: m.running,
  }));
}

/** Recover {project, baseSha} from a `baseGateKey`-produced key (JSON `[project, baseSha,
 *  lanes]`). Falls back to the caller-supplied project and a null sha for foreign keys —
 *  the meta entry still exists, it just carries less detail. */
function parseGateKey(key: string, fallbackProject: string): { project: string; baseSha: string | null } {
  try {
    const arr = JSON.parse(key) as unknown;
    if (Array.isArray(arr) && typeof arr[0] === 'string') {
      return { project: arr[0], baseSha: typeof arr[1] === 'string' && arr[1] !== '' ? arr[1] : null };
    }
  } catch { /* not a baseGateKey-shaped key */ }
  return { project: fallbackProject, baseSha: null };
}

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
  opts?: { project?: string; epicId?: string; verdict?: SharedVerdictScope },
): Promise<LeafGateResult> {
  const existing = inFlight.get(key);
  if (existing) {
    // A coalescing sibling still shows up in the observability meta — its epic is waiting
    // on this run just as much as the dispatcher's.
    if (opts?.epicId) inFlightMeta.get(key)?.epicIds.add(opts.epicId);
    return existing;
  }

  // Durable shared-verdict consult, BEFORE any slot is taken or run dispatched. In-flight
  // wins above on purpose: a live run for this key is at least as fresh as any stored row.
  const verdict = opts?.verdict;
  const verdictKey = verdict ? sharedVerdictKey(key, verdict.quarantineHash) : null;
  if (verdict && verdictKey) {
    const stored = getBaseGateVerdict(verdictKey);
    const replay = stored ? parseStoredVerdict(stored.resultJson, stored.status) : null;
    if (stored && replay) {
      if (stored.status === 'pass') return Promise.resolve(replay);
      // A stored FAIL is served only within the budget: fresh enough AND a CAS-taken serve
      // slot. Either bound failing sends THIS asker to a real run (the ONE re-measure);
      // concurrent siblings then coalesce onto it via the in-flight map above, and the
      // fresh write below resets the budget.
      const nowMs = verdict.now?.() ?? Date.now();
      if (nowMs - stored.measuredAt <= BASE_GATE_FAIL_VERDICT_TTL_MS
        && takeBaseGateFailServe(verdictKey, BASE_GATE_FAIL_VERDICT_SERVE_BUDGET)) {
        return Promise.resolve(replay);
      }
    }
  }

  // Callers that don't name a project share one bucket rather than escaping the cap.
  const project = opts?.project ?? '';
  const limit = maxConcurrentBaseGates();

  // Meta goes in BEFORE the IIFE below starts: with free slots its body runs synchronously
  // up to `run()`, and the `running` flip must land on an entry that already exists.
  const parsed = parseGateKey(key, project);
  const meta: InflightGateMeta = {
    project: parsed.project,
    baseSha: parsed.baseSha,
    epicIds: new Set(opts?.epicId ? [opts.epicId] : []),
    startedAt: Date.now(),
    running: false,
  };
  inFlightMeta.set(key, meta);

  const p = (async () => {
    // GLOBAL first, then project — a fixed acquisition order, so two callers can never each
    // hold one slot while waiting for the other's. Both are released in reverse.
    const waitGlobal = acquire(GLOBAL_BUCKET, maxConcurrentBaseGatesGlobal());
    if (waitGlobal) await waitGlobal;
    try {
      const waitProject = acquire(project, limit);
      if (waitProject) await waitProject;
      try {
        meta.running = true; // both slots held — the gate is executing, not queued
        const r = await run();
        // Persist the settled verdict for siblings. 'error' is an incident, not a base
        // fact — never stored (mirrors isCacheableBaseGateStatus / recordEpicBaseGate).
        // Write failure is invisible here by design: the next asker just re-runs.
        if (verdict && verdictKey && r.status !== 'error') {
          recordBaseGateVerdict({
            key: verdictKey,
            project: verdict.project,
            baseSha: verdict.baseSha,
            status: r.status,
            resultJson: stringifyVerdictResult(r),
            quarantineHash: verdict.quarantineHash,
          }, verdict.now?.() ?? Date.now());
        }
        return r;
      } finally {
        release(project);
      }
    } finally {
      release(GLOBAL_BUCKET);
    }
  })();
  inFlight.set(key, p);
  const clear = () => {
    if (inFlight.get(key) === p) {
      inFlight.delete(key);
      inFlightMeta.delete(key);
    }
  };
  p.then(clear, clear);
  return p;
}

/** Cap on the `output` embedded in a persisted verdict — capped BEFORE serializing, because
 *  truncating the serialized JSON would corrupt it into a permanent parse-miss. */
const MAX_VERDICT_OUTPUT_CHARS = 200_000;

function stringifyVerdictResult(r: LeafGateResult): string | null {
  try {
    return JSON.stringify({ ...r, output: (r.output ?? '').slice(0, MAX_VERDICT_OUTPUT_CHARS) });
  } catch { return null; }
}

/** Parse a stored verdict back into the result its consumers replay. Anything off — null,
 *  corrupt JSON, a status that disagrees with the row's own column — reads as a MISS, and a
 *  miss means re-measure: extra work, never a skipped or wrong-status gate. */
function parseStoredVerdict(resultJson: string | null, status: 'pass' | 'fail'): LeafGateResult | null {
  if (resultJson == null) return null;
  try {
    const r = JSON.parse(resultJson) as LeafGateResult;
    if (!r || typeof r !== 'object' || r.status !== status) return null;
    return r;
  } catch { return null; }
}

/** Test-only: clear all in-flight entries and release every queued/held slot. */
export function resetBaseGateCoalescer(): void {
  inFlight.clear();
  inFlightMeta.clear();
  running.clear();
  for (const q of waiting.values()) for (const resolve of q) resolve();
  waiting.clear();
}
