/**
 * Always-on Orchestrator daemon — the single per-process loop that drives all
 * registered projects at their configured autonomy level.
 *
 * Design: design-unified-orchestrator-daemon, decision f0ec0b06.
 * Replaces per-project coordinator timers + the Supervisor/Steward sessions;
 * passes dispatched by per-project level.
 *
 * Levels:
 *   off     — skipped entirely.
 *   build   — runBuildPass only.
 *   nudge+  — runBuildPass + runReconcilePass.
 *   propose — build + reconcile + triage (Grok suggests an inline action per
 *             escalation; the human confirms).
 *   drive   — propose + auto-resolve confident actionable suggestions unattended
 *             (behind the proof gate + rate limits).
 */

import { existsSync } from 'node:fs';
import { getOrchestratorLevel, listOrchestratorProjects, setOrchestratorLevel, emitAutoCollapseNotices } from './orchestrator-config.js';
import { listWatchedProjects } from './supervisor-store.js';
import { runBuildPass, shouldRunBuildPass, todoIsMissionScoped } from './coordinator-live.js';
import { runConductorPass } from './conductor-pass.js';
import { runReconcilePass, shouldRunReconcilePass } from './reconcile-pass.js';
import { runNotificationTick, shouldRunNotificationTick } from './session-notification-tick.js';
import { runFrictionWatchPass, shouldRunFrictionWatchPass } from './friction-watch.js';
import { runFrictionTriagePass } from './friction-triage.js';
import { runMissionIntakePass } from './mission-intake.js';
import { runContextRecyclePass } from './context-recycle.js';
import { runMissionLoopPass, shouldRunMissionLoopPass } from './mission-loop.js';
import { projectRegistry } from './project-registry.js';
import { getWebSocketHandler } from './ws-handler-manager.js';
import { registerOrchestratorKick } from './orchestrator-kick.js';
import { yieldToLoop } from './loop-yield.js';
import { runArchivalSweep, shouldRunArchivalSweep } from './archival-sweep.js';
import { runLandedEpicSweep, shouldRunLandedEpicSweep } from './landed-epic-sweep.js';
import { runBurnWatchPass, shouldRunBurnWatchPass } from './burn-watch.js';
import { getBurnBySource } from './spend-ledger.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let conductorTimer: ReturnType<typeof setInterval> | null = null;
let conductorRunning = false; // overlap guard for the independent conductor loop (B0)
let tickRunning = false;
let rerunRequested = false;
// Phase 5: a kick (ready-todo event) requests the build gate be BYPASSED on the next tick,
// so the todo is claimed immediately rather than waiting out the periodic build throttle.
// Latched here so a kick arriving mid-tick still forces the coalesced rerun (see runTickGuarded).
let forceBuildNextTick = false;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let lastTickAt: number | null = null;
let configuredTickMs = 30_000;
export const CONDUCTOR_INTERVAL_MS = 30_000;

// Visibility breadcrumb (Grok: "no visibility is the worst part of a wedge"). Set to
// `<project>:<pass>` while that pass is awaited, cleared when the tick finishes. If a
// tick wedges, getOrchestratorHealth().currentPhase shows EXACTLY which project+pass
// is stuck — no logfile spelunking. `tickStartedAt` lets a reader compute how long the
// in-flight tick has been running (lastTickAt only updates on COMPLETION).
let currentPhase: string | null = null;
let tickStartedAt: number | null = null;

/** Coalesce a burst of state changes (e.g. a planner promoting several leaves) into
 *  one kicked tick. */
const KICK_DEBOUNCE_MS = 250;

// Per-pass BACKSTOP timeouts. The single-flight tick awaits each pass inline, and the
// build pass in turn awaits full leaf runs (coordinator-daemon runTick). Every inner
// call is individually bounded already (node-invoker 10min wall-clock kill; git via
// worktree-manager runCmd SIGKILL; Grok/judgment via AbortSignal) — but a single
// residual unbounded await (or a pathological cold-start on a stale/conflicted branch
// like the build123d trigger) would wedge `tickRunning` FOREVER (lastTickAt stuck),
// which is the failure this guards. These deadlines convert a permanent wedge into a
// logged timeout + the tick moving on. NOT a force-clear of tickRunning (which would
// risk overlapping ticks per the design note) — we bound the awaited pass promise; the
// finally then clears the flag normally. An in-flight leaf is NOT killed by this: it
// keeps running under its claim (the lease + reattach make any true interruption cheap),
// and the next tick skips it (still claimed) and services other projects. The build
// ceiling sits well above a normal single leaf; tripping it means genuinely stuck or an
// unusually deep wave — either way the daemon stays alive.
const NOTIFY_PASS_TIMEOUT_MS = 90_000; // 1.5min — git-diff probes only
const BUILD_PASS_TIMEOUT_MS = 30 * 60_000; // 30min — awaits leaf run(s)
const RECONCILE_PASS_TIMEOUT_MS = 5 * 60_000; // 5min — reconcile harness
const ARCHIVAL_PASS_TIMEOUT_MS = 5 * 60_000; // 5min — archival sweep
const LANDED_EPIC_SWEEP_PASS_TIMEOUT_MS = 5 * 60_000; // 5min — landed-epic sweep

/** Race a pass against a backstop deadline. Rejects with a labelled error on timeout so
 *  the caller's existing try/catch logs it and the tick proceeds. The underlying work is
 *  abandoned (JS can't cancel it) but NOT killed — its own inner bounds + claim/lease own
 *  its lifecycle. */
export function withPassTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`pass-timeout after ${ms}ms: ${label}`)), ms);
    (t as { unref?: () => void }).unref?.();
  });
  return Promise.race([p, deadline]).finally(() => { if (t) clearTimeout(t); }) as Promise<T>;
}

/** B0 — independent CONDUCTOR heartbeat, decoupled from the serial build tick so a slow
 *  reconcile/build pass can never starve mission-driving (the ~15min conductor starvation of
 *  2026-07-18). Iterates WATCHED projects and runs the conductor pass for each; the pass self-gates
 *  on its per-project toggle + debounce, so this is a cheap no-op unless a mission is actionable.
 *  Own overlap guard (conductorRunning); it does NOT read tickRunning,
 *  which is exactly why the build tick can't block it. Exported for the saturation test. */
export async function runConductorGuarded(deps: Pick<TickDeps, 'conductor' | 'watchedProjects' | 'dirExists'> = {}): Promise<void> {
  if (conductorRunning) return; // previous conductor beat still in flight — skip this beat
  conductorRunning = true;
  try {
    const conductor = deps.conductor ?? runConductorPass;
    const dirExists = deps.dirExists ?? existsSync;
    const watched = (deps.watchedProjects ?? (() => new Set(listWatchedProjects().map((w) => w.project))))();
    for (const project of watched) {
      // Skip a project whose directory is GONE (a removed leaf-exec worktree, a cleaned temp/smoke
      // project) — a leaked watched_project row otherwise makes the conductor pass open a dead SQLite
      // DB every beat, and bun:sqlite is SYNCHRONOUS so a disk-I/O hang stalls the whole event loop
      // (the incident of 2026-07-19: ~61 stale worktrees + leaked conductorEnabled temp projects
      // wedged the server on every 30s conductor beat). withPassTimeout can't save a sync hang.
      if (!dirExists(project)) continue;
      try {
        // A conductor node can take a while, so it gets the build-pass timeout — but on ITS OWN
        // loop, so that latency never delays the build tick (or vice-versa).
        await withPassTimeout(conductor(project), BUILD_PASS_TIMEOUT_MS, `${project}:conductor`);
      } catch (err) {
        console.warn(`[orchestrator] conductor pass failed for ${project}:`, err);
      }
    }
  } catch (err) {
    console.warn('[orchestrator] conductor heartbeat failed:', err);
  } finally {
    conductorRunning = false;
  }
}

/** Run one tick under the overlap guard, coalescing any kick that arrives mid-tick
 *  (so a todo that becomes ready WHILE a tick runs still gets serviced immediately
 *  after, not 30s later). Shared by the interval and kickOrchestrator(). */
async function runTickGuarded(opts: { force?: boolean } = {}): Promise<void> {
  // A kick sets force — latch it so it survives an in-flight tick and forces the coalesced
  // rerun (below) to bypass the build throttle, even if the kick arrived mid-tick.
  if (opts.force) forceBuildNextTick = true;
  if (tickRunning) {
    rerunRequested = true; // a tick is in flight — ask it to run once more when done
    return;
  }
  tickRunning = true;
  tickStartedAt = Date.now();
  try {
    getWebSocketHandler()?.broadcast({ type: 'orchestrator_tick', at: Date.now() });
  } catch {
    /* heartbeat is best-effort */
  }
  try {
    do {
      rerunRequested = false;
      // Consume the latch: this iteration bypasses the build throttle iff a kick requested it.
      // Cleared before the await so a kick landing DURING the pass re-latches for the next rerun.
      const force = forceBuildNextTick;
      forceBuildNextTick = false;
      await runOrchestratorTick({ force });
    } while (rerunRequested); // drain kicks that landed during the pass
  } catch (err) {
    console.warn('[orchestrator] Unhandled tick error:', err);
  } finally {
    lastTickAt = Date.now();
    tickStartedAt = null;
    currentPhase = null;
    tickRunning = false;
  }
}

/**
 * EVENT-DRIVEN kick: a todo just became `ready` (or another state worth acting on),
 * so run a build tick NOW instead of waiting up to a full interval. Debounced
 * (coalesces a burst into one tick) and overlap-safe (coalesces with an in-flight
 * tick via runTickGuarded). The interval remains the TIME-BASED safety net — lease
 * expiry, stall sweeps, and any missed kick still get serviced on the slow cadence.
 * No-op if the daemon isn't running.
 */
export function kickOrchestrator(_reason?: string): void {
  if (timer === null) return; // daemon not started → nothing to kick
  if (kickTimer !== null) return; // already scheduled within the debounce window
  kickTimer = setTimeout(() => {
    kickTimer = null;
    // force: a kick means a todo became ready — bypass the periodic build throttle so it is
    // claimed NOW, not on the next 2-min safety-net scan. This is the claim-latency guarantee.
    void runTickGuarded({ force: true });
  }, KICK_DEBOUNCE_MS);
  (kickTimer as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------------------
// Pure helper (also exported for unit tests)
// ---------------------------------------------------------------------------

/** Which passes should run for a given level (epic 4b81ca59 — off/on).
 *  `on` runs build + reconcile. Off runs nothing. */
export function passesForLevel(level: ReturnType<typeof getOrchestratorLevel>): {
  build: boolean;
  reconcile: boolean;
  archival: boolean;
  landedEpicSweep: boolean;
} {
  const active = level !== 'off';
  return {
    build: active,
    reconcile: active,
    archival: active,
    landedEpicSweep: active,
  };
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

/** Injectable seams — default to the real implementations; tests pass spies so
 *  the tick can be exercised without process-global `mock.module` (which leaks
 *  across test files in one bun run). */
export interface TickDeps {
  listProjects?: () => Promise<Array<{ path: string }>>;
  getLevel?: (project: string) => ReturnType<typeof getOrchestratorLevel>;
  build?: (project: string) => Promise<void>;
  /** Phase 5 throttle gate: returns true (and records the run) when the PERIODIC build
   *  safety-net scan is due for a project, false while within BUILD_PASS_INTERVAL_MS.
   *  Bypassed when `force` is set (a kick), so ready-todo claim latency is preserved —
   *  only the time-based lease/orphan/stall catch-up scan is coarsened. Default:
   *  shouldRunBuildPass. */
  shouldRunBuild?: (project: string) => boolean;
  /** Phase 5: this tick was triggered by a kickOrchestrator event (a todo became ready),
   *  so BYPASS the periodic build throttle and claim immediately. The interval-driven tick
   *  leaves this false (throttled safety-net cadence). Threaded from runTickGuarded. */
  force?: boolean;
  reconcile?: (project: string) => Promise<void>;
  /** Phase 3 throttle gate: returns true (and records the run) when the reconcile
   *  hygiene pass is due for a project, false while within RECONCILE_INTERVAL_MS.
   *  Keeps the every-tick loop free of the pass's ~5-6 full-table todos scans.
   *  Default: shouldRunReconcilePass. */
  shouldRunReconcile?: (project: string) => boolean;
  /** Throttled archival sweep: stamp archivedAt on terminal (done/dropped todos,
   *  converged/abandoned missions) rows past retention. Hygiene, not claim/build-latency-
   *  sensitive — same throttle shape as reconcile. Default: p => runArchivalSweep(p, { force: true }). */
  archival?: (project: string) => Promise<void>;
  /** Throttle gate for the archival sweep: returns true (and records the run) when the
   *  pass is due for a project, false while within ARCHIVAL_SWEEP_INTERVAL_MS.
   *  Default: shouldRunArchivalSweep. */
  shouldRunArchival?: (project: string) => boolean;
  /** Throttled landed-epic sweep: reconcile [LAND] leaves + GC fully-landed epic branches
   *  (reconcileLandedEpics + gcEpicBranches, landed-epic-sweep.ts). Hygiene, not claim/
   *  build-latency-sensitive — same throttle shape as archival. Default:
   *  p => runLandedEpicSweep(p, { force: true }). */
  landedEpicSweep?: (project: string) => Promise<void>;
  /** Throttle gate for the landed-epic sweep: returns true (and records the run) when the
   *  pass is due for a project, false while within LANDED_EPIC_SWEEP_INTERVAL_MS.
   *  Default: shouldRunLandedEpicSweep. */
  shouldRunLandedEpicSweep?: (project: string) => boolean;
  /** Diff todos → enqueue subscription notifications → nudge idle subscribers.
   *  Runs for every WATCHED project regardless of level (decoupled from build).
   *  Default: runNotificationTick. */
  notify?: (project: string) => Promise<unknown>;
  /** Phase 4 throttle gate: returns true (and records the run) when the notification tick
   *  is due for a project, false while within NOTIFY_INTERVAL_MS. Keeps the every-tick loop
   *  free of the pass's full-table todos scan. Default: shouldRunNotificationTick. */
  shouldRunNotify?: (project: string) => boolean;
  /** One deterministic operational-friction watch pass (unlanded-epic backlog, stale
   *  worktrees). Runs for every WATCHED project regardless of level, like notify.
   *  Default: runFrictionWatchPass. */
  frictionWatch?: (project: string) => Promise<unknown>;
  /** Phase 4 throttle gate: returns true (and records the run) when the friction-watch pass
   *  is due for a project, false while within FRICTION_WATCH_INTERVAL_MS. Keeps the every-tick
   *  loop free of the pass's listUnlandedEpics git-subprocess sweep. Default:
   *  shouldRunFrictionWatchPass. */
  shouldRunFrictionWatch?: (project: string) => boolean;
  /** DF3: file deduped 'planned' todos from recurring friction. Runs for every
   *  WATCHED project regardless of level (planned filing is non-claimable — the
   *  "suggest"; a human promotes to ready). Default: runFrictionTriagePass. */
  frictionTriage?: (project: string) => Promise<unknown>;
  /** Token-leak alarm: read the burn gauge and raise a deduped escalation when a non-build LLM
   *  source exceeds its call ceiling with no accepted work. Runs for every WATCHED project regardless
   *  of level (observability isn't gated on building). Default: runBurnWatchPass. */
  burnWatch?: (project: string) => Promise<unknown>;
  /** Throttle gate for burn-watch (at most once per BURN_WATCH_INTERVAL_MS/project).
   *  Default: shouldRunBurnWatchPass. */
  shouldRunBurnWatch?: (project: string) => boolean;
  /** Mission A: DETERMINISTIC friction→forge intake. Escalates an over-threshold domain/orchestration
   *  friction cluster into an UNAPPROVED forged mission (one/tick). Self-gates on the per-project
   *  intake toggle (default OFF); runs for WATCHED projects. Default: runMissionIntakePass. */
  missionIntake?: (project: string) => Promise<unknown>;
  /** Context-auto-recycle driver: checkpoint→clear→collab a low-context watched
   *  session (gated by per-project contextRecycleMode). Runs for every WATCHED
   *  project regardless of level, like notify. Default: runContextRecyclePass. */
  recycle?: (project: string) => Promise<unknown>;
  /** Phase-2b mission-loop driver: advance convergence missions (nudge steward for
   *  judgment phases, auto-advance the mechanical EXECUTE→VERIFY step). Drives each
   *  project's ACTIVE missions; runs for WATCHED projects only (the safety boundary —
   *  no per-project mode). Default: runMissionLoopPass. */
  missionLoop?: (project: string) => Promise<unknown>;
  /** Phase 4 throttle gate: returns true (and records the run) when the mission-loop pass is
   *  due for a project, false while within MISSION_LOOP_INTERVAL_MS. Keeps the every-tick loop
   *  free of listMissions' ~1+3N full-table todos scans (the single heaviest per-tick scanner).
   *  Default: shouldRunMissionLoopPass. */
  shouldRunMissionLoop?: (project: string) => boolean;
  /** AUTONOMOUS CONDUCTOR pass (Phase 2): spawn a conductor node to drive the project's approved
   *  active mission. Self-gates on the per-project conductor toggle (default OFF) + debounce; runs
   *  for WATCHED projects. Default: runConductorPass. */
  conductor?: (project: string) => Promise<unknown>;
  /** Set of WATCHED project paths. A non-off project that isn't watched is forced off
   *  (so nothing runs that the human isn't watching). Default: the watched_project table. */
  watchedProjects?: () => Set<string>;
  /** Does a project's directory still exist? A leaked watched row for a removed worktree/temp
   *  project is skipped so a pass never opens its dead SQLite DB (sync hang wedges the loop).
   *  Default: node:fs existsSync. Injected in tests that use fictional project paths. */
  dirExists?: (project: string) => boolean;
  /** Persist a level (used to force an unwatched project off). Default: setOrchestratorLevel. */
  setLevel?: (project: string, level: ReturnType<typeof getOrchestratorLevel>) => void;
  /** All CONFIGURED projects + levels (the unwatched-auto-off sweep reads these so it also
   *  catches config-only entries never in the registry). Default: listOrchestratorProjects. */
  listConfigured?: () => Array<{ project: string; level: ReturnType<typeof getOrchestratorLevel> }>;
}

/** One tick: enumerate registered projects and dispatch passes per level. */
export async function runOrchestratorTick(deps: TickDeps = {}): Promise<void> {
  const listProjects = deps.listProjects ?? (() => projectRegistry.list());
  const getLevel = deps.getLevel ?? getOrchestratorLevel;
  const build = deps.build ?? runBuildPass;
  const shouldRunBuild = deps.shouldRunBuild ?? shouldRunBuildPass;
  const force = deps.force ?? false;
  const reconcile = deps.reconcile ?? runReconcilePass;
  const shouldRunReconcile = deps.shouldRunReconcile ?? shouldRunReconcilePass;
  const archival = deps.archival ?? ((p: string) => runArchivalSweep(p, { force: true }).then(() => {}));
  const shouldRunArchival = deps.shouldRunArchival ?? shouldRunArchivalSweep;
  const landedEpicSweep = deps.landedEpicSweep ?? ((p: string) => runLandedEpicSweep(p, { force: true }).then(() => {}));
  const shouldRunLandedEpicSweepDep = deps.shouldRunLandedEpicSweep ?? shouldRunLandedEpicSweep;
  const notify = deps.notify ?? runNotificationTick;
  const shouldRunNotify = deps.shouldRunNotify ?? shouldRunNotificationTick;
  const frictionWatch = deps.frictionWatch ?? runFrictionWatchPass;
  const shouldRunFrictionWatch = deps.shouldRunFrictionWatch ?? shouldRunFrictionWatchPass;
  const frictionTriage = deps.frictionTriage ?? runFrictionTriagePass;
  const burnWatch = deps.burnWatch ?? runBurnWatchPass;
  const shouldRunBurnWatch = deps.shouldRunBurnWatch ?? shouldRunBurnWatchPass;
  const missionIntake = deps.missionIntake ?? runMissionIntakePass;
  const recycle = deps.recycle ?? runContextRecyclePass;
  const missionLoop = deps.missionLoop ?? runMissionLoopPass;
  const shouldRunMissionLoop = deps.shouldRunMissionLoop ?? shouldRunMissionLoopPass;
  // NB: the conductor pass no longer runs in this serial tick — it moved to its own decoupled loop
  // (runConductorGuarded / conductorTimer, B0). deps.conductor is consumed there.
  const watchedProjects = deps.watchedProjects ?? (() => new Set(listWatchedProjects().map((w) => w.project)));
  const setLevel = deps.setLevel ?? setOrchestratorLevel;
  const listConfigured = deps.listConfigured ?? listOrchestratorProjects;
  const watched = watchedProjects();

  // Unwatched-auto-off sweep: force off EVERY configured project that isn't watched — so the
  // daemon never builds (or appears to be running) something the human isn't watching. This
  // sweeps the ORCHESTRATOR-CONFIG rows (not just the registry the loop below iterates), so it
  // also cleans CONFIG-ONLY stale entries that were never registered (e.g. /tmp test projects
  // left at 'on'). Persisted + sticky; the loop below then sees them 'off' and skips.
  try {
    for (const { project, level } of listConfigured()) {
      if (level !== 'off' && !watched.has(project)) {
        setLevel(project, 'off');
        console.warn(`[orchestrator] ${project} is at '${level}' but UNWATCHED — forcing off.`);
      }
    }
  } catch (err) {
    console.warn('[orchestrator] unwatched-auto-off sweep failed:', err);
  }

  let projects: Array<{ path: string }>;
  try {
    projects = await listProjects();
  } catch (err) {
    console.warn('[orchestrator] Failed to list registered projects:', err);
    return;
  }

  const dirExists = deps.dirExists ?? existsSync;
  for (const { path: project } of projects) {
    // Phase 1 (mission c4eb4fcc): cede the HTTP event loop BETWEEN per-project iterations so a
    // pending health poll / MCP request can interleave before this project's synchronous
    // bun:sqlite/fs passes run. Same work, same order, same results — only a macrotask boundary is
    // inserted so no single project's inline scans hold the loop for the whole serial tick.
    await yieldToLoop();

    // Skip a project whose directory is GONE — a synchronous SQLite hang on a dead worktree/temp DB
    // stalls the event loop for every pass below (see runConductorGuarded for the full incident note).
    if (!dirExists(project)) continue;
    let lvl: ReturnType<typeof getOrchestratorLevel>;
    try {
      lvl = getLevel(project);
    } catch (err) {
      console.warn(`[orchestrator] Could not read level for ${project}:`, err);
      continue;
    }

    // Session-subscription notifications run for every WATCHED project regardless of
    // level — you can subscribe-and-be-notified (e.g. a Planner monitoring its plan)
    // without turning on autonomous building. Decoupled from runBuildPass on purpose;
    // cheap (a no-op when nothing is subscribed to the project). Best-effort.
    // Phase 4 (mission c4eb4fcc): throttle the notify pass's full-table todos scan off the
    // every-tick cadence (at most once per NOTIFY_INTERVAL_MS/project). The snapshot diff is
    // cumulative + nudges are already idle-gated/throttled, so a coarser scan cadence delays
    // no events. Not the CLAIM path.
    if (watched.has(project) && shouldRunNotify(project)) {
      try {
        currentPhase = `${project}:notify`;
        await withPassTimeout(notify(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:notify`);
      } catch (err) {
        console.warn(`[orchestrator] notify failed for ${project}:`, err);
      }
    }

    // Operational-friction watch (DF2): record unlanded-epic backlog + stale worktrees as
    // operational friction. Runs for every WATCHED project regardless of level — same as
    // notify — since observability is not gated on autonomous building. No LLM; best-effort.
    // Phase 4 (mission c4eb4fcc): throttle friction-watch off the every-tick cadence (at most
    // once per FRICTION_WATCH_INTERVAL_MS/project). Its listUnlandedEpics git-subprocess sweep
    // runs every tick otherwise; this is pure backlog observation, not real-time.
    if (watched.has(project) && shouldRunFrictionWatch(project)) {
      try {
        currentPhase = `${project}:friction-watch`;
        await withPassTimeout(frictionWatch(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:friction-watch`);
      } catch (err) {
        console.warn(`[orchestrator] friction-watch failed for ${project}:`, err);
      }
    }

    // DF3 friction triage: turn recurring friction into deduped 'planned' todos
    // (Bugfix inbox / Collab gaps). Runs for every WATCHED project regardless of
    // level — filing 'planned' is the "suggest"; a human promotes to ready
    // (planner-promotes-ready). No LLM; best-effort.
    if (watched.has(project)) {
      try {
        currentPhase = `${project}:friction-triage`;
        await withPassTimeout(frictionTriage(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:friction-triage`);
      } catch (err) {
        console.warn(`[orchestrator] friction-triage failed for ${project}:`, err);
      }
    }

    // Token-leak alarm (burn-watch): read the per-source burn gauge over the last hour and raise a
    // deduped escalation for any non-build LLM source exceeding its call ceiling with no accepted
    // work — catches a daemon pass re-spinning on an idle system. Runs for every WATCHED project;
    // cheap (one SQLite GROUP BY + an optional escalation), throttled off the every-tick beat.
    if (watched.has(project) && shouldRunBurnWatch(project)) {
      try {
        currentPhase = `${project}:burn-watch`;
        await withPassTimeout(burnWatch(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:burn-watch`);
      } catch (err) {
        console.warn(`[orchestrator] burn-watch failed for ${project}:`, err);
      }
    }

    // Mission A friction→forge intake: escalate an over-threshold domain/orchestration friction
    // cluster into an UNAPPROVED forged mission (deterministic detector; the forge NODE is the only
    // LLM spend). Self-gates on the per-project intake toggle (default OFF) so it is inert until a
    // human opts in; runs for every WATCHED project. Best-effort; bounded. A drafted mission never
    // self-drives (unapproved → approve_mission is the human gate).
    if (watched.has(project)) {
      try {
        currentPhase = `${project}:mission-intake`;
        await withPassTimeout(missionIntake(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:mission-intake`);
      } catch (err) {
        console.warn(`[orchestrator] mission-intake failed for ${project}:`, err);
      }
    }

    // Context-auto-recycle: keep a low-context watched session alive by driving
    // checkpoint→clear→collab (gated by per-project contextRecycleMode; inert when
    // 'off'). Runs for every WATCHED project regardless of level — a long-running
    // interactive/steward session must survive a context fill without autonomous
    // building being on. No LLM; best-effort.
    if (watched.has(project)) {
      try {
        currentPhase = `${project}:recycle`;
        await withPassTimeout(recycle(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:recycle`);
      } catch (err) {
        console.warn(`[orchestrator] context-recycle failed for ${project}:`, err);
      }
    }

    // Phase-2b mission-loop driver: advance convergence missions (attended — nudge the
    // steward for judgment phases, auto-advance mechanical EXECUTE→VERIFY). Drives the
    // project's ACTIVE missions; runs for every WATCHED project regardless of level (the
    // watched gate IS the safety boundary — no per-project mode). Best-effort; bounded.
    // Phase 4 (mission c4eb4fcc): throttle the mission-loop pass off the every-tick cadence
    // (at most once per MISSION_LOOP_INTERVAL_MS/project). listMissions drives ~1+3N synchronous
    // full-table todos scans (N missions) — the single heaviest per-tick block on the 8MB DB —
    // and only NUDGES the steward (already 15-min-cooldown-debounced), so 30s freshness is
    // wasted. Not the CLAIM path.
    if (watched.has(project) && shouldRunMissionLoop(project)) {
      try {
        currentPhase = `${project}:mission-loop`;
        await withPassTimeout(missionLoop(project), NOTIFY_PASS_TIMEOUT_MS, `${project}:mission-loop`);
      } catch (err) {
        console.warn(`[orchestrator] mission-loop failed for ${project}:`, err);
      }
    }

    // AUTONOMOUS CONDUCTOR: moved OFF this serial tick onto its own decoupled loop
    // (runConductorGuarded / conductorTimer, B0) so a slow reconcile/build pass can never starve
    // mission-driving. See startOrchestrator.

    if (lvl === 'off') continue; // includes anything the sweep above just forced off

    const passes = passesForLevel(lvl);

    // Phase 5 (mission c4eb4fcc): throttle the PERIODIC build safety-net scan off the every-tick
    // cadence (at most once per BUILD_PASS_INTERVAL_MS/project). runTick's per-tick lease/orphan/
    // stall sweep + listReadyTodos claim scan is the LAST every-tick synchronous block on the 8MB
    // DB. A KICK (force) — fired the instant a todo becomes ready — BYPASSES the gate and claims
    // immediately, so this coarsens ONLY the time-based safety net, never claim latency. `force ||`
    // short-circuits so a kicked tick doesn't even consume the gate clock (periodic cadence stays
    // regular regardless of kicks).
    if (passes.build && (force || shouldRunBuild(project))) {
      try {
        currentPhase = `${project}:build`;
        await withPassTimeout(build(project), BUILD_PASS_TIMEOUT_MS, `${project}:build`);
      } catch (err) {
        console.warn(`[orchestrator] runBuildPass failed for ${project}:`, err);
      }
    }

    // Phase 3 (mission c4eb4fcc): the reconcile pass is a hygiene catch-up that drives
    // ~5-6 synchronous full-table todos scans per run — the distributed block that keeps
    // the shared HTTP loop starved after Phase 1/2. THROTTLE it off the every-tick cadence
    // (at most once per RECONCILE_INTERVAL_MS/project), so ~4/5 of those scans leave the
    // loop. The ready-todo CLAIM path (build pass / kickOrchestrator) is NOT gated here —
    // it stays every-tick responsive.
    if (passes.reconcile && shouldRunReconcile(project)) {
      try {
        currentPhase = `${project}:reconcile`;
        await withPassTimeout(reconcile(project), RECONCILE_PASS_TIMEOUT_MS, `${project}:reconcile`);
      } catch (err) {
        console.warn(`[orchestrator] runReconcilePass failed for ${project}:`, err);
      }
    }

    // Throttled archival sweep: stamp archivedAt on terminal rows past retention (mission
    // 03a968f5). Hygiene, not claim/build-latency-sensitive — same throttle shape as reconcile.
    if (passes.archival && shouldRunArchival(project)) {
      try {
        currentPhase = `${project}:archival`;
        await withPassTimeout(archival(project), ARCHIVAL_PASS_TIMEOUT_MS, `${project}:archival`);
      } catch (err) {
        console.warn(`[orchestrator] runArchivalSweep failed for ${project}:`, err);
      }
    }

    // Throttled landed-epic sweep: reconcile [LAND] leaves + GC fully-landed epic branches.
    // Hygiene, not claim/build-latency-sensitive — same throttle shape as archival.
    if (passes.landedEpicSweep && shouldRunLandedEpicSweepDep(project)) {
      try {
        currentPhase = `${project}:landed-epic-sweep`;
        await withPassTimeout(landedEpicSweep(project), LANDED_EPIC_SWEEP_PASS_TIMEOUT_MS, `${project}:landed-epic-sweep`);
      } catch (err) {
        console.warn(`[orchestrator] runLandedEpicSweep failed for ${project}:`, err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Start the orchestrator interval. Idempotent — no-op if already running. */
export function startOrchestrator(intervalMs = 30_000): void {
  if (timer !== null) return;
  configuredTickMs = intervalMs;

  // One-time emission of escalation cards for projects that were formerly at auto/drive
  // and collapsed to on (best-effort; wrap in try/catch so a bad project doesn't abort startup).
  try {
    emitAutoCollapseNotices();
  } catch (err) {
    console.warn('[orchestrator] Failed to emit auto-collapse notices:', err);
  }

  // The interval is now the TIME-BASED safety net; the latency-sensitive claim path
  // is driven by kickOrchestrator() on ready-todo events. Both funnel through the
  // same overlap-guarded runner.
  const t = setInterval(() => {
    void runTickGuarded();
  }, intervalMs);

  // Don't block process exit
  (t as { unref?: () => void }).unref?.();
  timer = t;

  // B0 — independent conductor heartbeat, decoupled from the build tick so a long reconcile/build
  // can never starve mission-driving. Own overlap guard (see runConductorGuarded). Idempotent.
  if (conductorTimer === null) {
    void runConductorGuarded();
    const ct = setInterval(() => { void runConductorGuarded(); }, CONDUCTOR_INTERVAL_MS);
    (ct as { unref?: () => void }).unref?.();
    conductorTimer = ct;
  }

  // Event-driven claim path: the todo-store fires this when a todo becomes ready, so
  // we tick within KICK_DEBOUNCE_MS instead of waiting for the interval.
  registerOrchestratorKick((reason) => kickOrchestrator(reason));
}

/** Stop the orchestrator interval. */
export function stopOrchestrator(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  if (conductorTimer !== null) {
    clearInterval(conductorTimer);
    conductorTimer = null;
  }
  // Drop any kick scheduled within the debounce window so it can't tick after stop
  // (kickOrchestrator already no-ops new kicks once timer is null).
  if (kickTimer !== null) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
  forceBuildNextTick = false; // drop any un-serviced kick's force latch
}

/** Whether the daemon interval is currently active. */
export function isOrchestratorRunning(): boolean {
  return timer !== null;
}

/** Health snapshot for the /health route. */
export function getOrchestratorHealth(): {
  running: boolean;
  tickMs: number;
  lastTickAt: number | null;
  /** `<project>:<pass>` currently being awaited, or null when idle between ticks. */
  currentPhase: string | null;
  /** ms the in-flight tick has been running (null when idle). A large value here with a
   *  non-null currentPhase = that pass is wedged — points straight at the culprit. */
  tickRunningMs: number | null;
  projects: Array<{ project: string; level: string }>;
  /** Per-source LLM-call burn over the last hour (the leak gauge). Empty on any read failure. */
  burn: Array<{ source: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
} {
  // Synchronous snapshot of the projects with an explicitly-set level (SQLite is
  // cheap + sync). Projects on the 'build' default with no row aren't listed.
  let projects: Array<{ project: string; level: string }> = [];
  try {
    projects = listOrchestratorProjects();
  } catch {
    // ignore — health stays best-effort
  }
  // Fleet-wide LLM burn over the last hour, grouped by source — the leak gauge, right on /health.
  let burn: Array<{ source: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }> = [];
  try {
    burn = getBurnBySource({ sinceMs: Date.now() - 60 * 60_000 }).map((r) => ({
      source: r.source,
      calls: r.calls,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.estCostUsd,
    }));
  } catch {
    // ignore — health stays best-effort
  }
  return {
    running: isOrchestratorRunning(),
    tickMs: configuredTickMs,
    lastTickAt,
    currentPhase,
    tickRunningMs: tickStartedAt != null ? Date.now() - tickStartedAt : null,
    projects,
    burn,
  };
}
