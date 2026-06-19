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

import { getOrchestratorLevel, listOrchestratorProjects, setOrchestratorLevel } from './orchestrator-config.js';
import { listWatchedProjects } from './supervisor-store.js';
import { runBuildPass } from './coordinator-live.js';
import { runReconcilePass } from './reconcile-pass.js';
import { runTriagePass } from './triage-pass.js';
import { projectRegistry } from './project-registry.js';
import { getWebSocketHandler } from './ws-handler-manager.js';
import { registerOrchestratorKick } from './orchestrator-kick.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;
let rerunRequested = false;
let kickTimer: ReturnType<typeof setTimeout> | null = null;
let lastTickAt: number | null = null;
let configuredTickMs = 30_000;

/** Coalesce a burst of state changes (e.g. a planner promoting several leaves) into
 *  one kicked tick. */
const KICK_DEBOUNCE_MS = 250;

/** Run one tick under the overlap guard, coalescing any kick that arrives mid-tick
 *  (so a todo that becomes ready WHILE a tick runs still gets serviced immediately
 *  after, not 30s later). Shared by the interval and kickOrchestrator(). */
async function runTickGuarded(): Promise<void> {
  if (tickRunning) {
    rerunRequested = true; // a tick is in flight — ask it to run once more when done
    return;
  }
  tickRunning = true;
  try {
    getWebSocketHandler()?.broadcast({ type: 'orchestrator_tick', at: Date.now() });
  } catch {
    /* heartbeat is best-effort */
  }
  try {
    do {
      rerunRequested = false;
      await runOrchestratorTick();
    } while (rerunRequested); // drain kicks that landed during the pass
  } catch (err) {
    console.warn('[orchestrator] Unhandled tick error:', err);
  } finally {
    lastTickAt = Date.now();
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
    void runTickGuarded();
  }, KICK_DEBOUNCE_MS);
  (kickTimer as { unref?: () => void }).unref?.();
}

// ---------------------------------------------------------------------------
// Pure helper (also exported for unit tests)
// ---------------------------------------------------------------------------

/** Which passes should run for a given level (epic 4b81ca59 — off/on/auto).
 *  `on` runs build + reconcile + triage SUGGEST (write-only); auto-resolve is the
 *  only thing reserved for `auto` (decided in the tick via `lvl === 'auto'`). */
export function passesForLevel(level: ReturnType<typeof getOrchestratorLevel>): {
  build: boolean;
  reconcile: boolean;
  triage: boolean;
} {
  const active = level !== 'off';
  return {
    build: active,
    reconcile: active,
    // Always-on suggest at `on`+ (write-only; a human confirms). Auto-resolve of
    // those suggestions stays gated to `auto`.
    triage: active,
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
  reconcile?: (project: string) => Promise<void>;
  triage?: (project: string, opts: { autoResolve: boolean }) => Promise<void>;
  /** Set of WATCHED project paths. A non-off project that isn't watched is forced off
   *  (so nothing runs that the human isn't watching). Default: the watched_project table. */
  watchedProjects?: () => Set<string>;
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
  const reconcile = deps.reconcile ?? runReconcilePass;
  const triage = deps.triage ?? ((project: string, opts: { autoResolve: boolean }) => runTriagePass(project, { autoResolve: opts.autoResolve }));
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

  for (const { path: project } of projects) {
    let lvl: ReturnType<typeof getOrchestratorLevel>;
    try {
      lvl = getLevel(project);
    } catch (err) {
      console.warn(`[orchestrator] Could not read level for ${project}:`, err);
      continue;
    }

    if (lvl === 'off') continue; // includes anything the sweep above just forced off

    const passes = passesForLevel(lvl);

    if (passes.build) {
      try {
        await build(project);
      } catch (err) {
        console.warn(`[orchestrator] runBuildPass failed for ${project}:`, err);
      }
    }

    if (passes.reconcile) {
      try {
        await reconcile(project);
      } catch (err) {
        console.warn(`[orchestrator] runReconcilePass failed for ${project}:`, err);
      }
    }

    // Triage runs LAST (after reconcile auto-closes the deterministic stale/done
    // buckets), so Grok only sees escalations the cheap passes couldn't resolve.
    // At `drive` (rank >= drive) the triage pass also auto-resolves the
    // high-confidence actionable suggestions it writes (behind the proof gate);
    // at `propose` it only writes them for human confirm.
    if (passes.triage) {
      const autoResolve = lvl === 'auto';
      try {
        await triage(project, { autoResolve });
      } catch (err) {
        console.warn(`[orchestrator] runTriagePass failed for ${project}:`, err);
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

  // The interval is now the TIME-BASED safety net; the latency-sensitive claim path
  // is driven by kickOrchestrator() on ready-todo events. Both funnel through the
  // same overlap-guarded runner.
  const t = setInterval(() => {
    void runTickGuarded();
  }, intervalMs);

  // Don't block process exit
  (t as { unref?: () => void }).unref?.();
  timer = t;

  // Event-driven claim path: the todo-store fires this when a todo becomes ready, so
  // we tick within KICK_DEBOUNCE_MS instead of waiting for the interval.
  registerOrchestratorKick((reason) => kickOrchestrator(reason));
}

/** Stop the orchestrator interval. */
export function stopOrchestrator(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  // Drop any kick scheduled within the debounce window so it can't tick after stop
  // (kickOrchestrator already no-ops new kicks once timer is null).
  if (kickTimer !== null) {
    clearTimeout(kickTimer);
    kickTimer = null;
  }
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
  projects: Array<{ project: string; level: string }>;
} {
  // Synchronous snapshot of the projects with an explicitly-set level (SQLite is
  // cheap + sync). Projects on the 'build' default with no row aren't listed.
  let projects: Array<{ project: string; level: string }> = [];
  try {
    projects = listOrchestratorProjects();
  } catch {
    // ignore — health stays best-effort
  }
  return {
    running: isOrchestratorRunning(),
    tickMs: configuredTickMs,
    lastTickAt,
    projects,
  };
}
