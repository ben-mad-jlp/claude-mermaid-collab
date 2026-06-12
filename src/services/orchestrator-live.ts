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

import { getOrchestratorLevel, levelRank, listOrchestratorProjects } from './orchestrator-config.js';
import { runBuildPass } from './coordinator-live.js';
import { runReconcilePass } from './reconcile-pass.js';
import { runTriagePass } from './triage-pass.js';
import { projectRegistry } from './project-registry.js';
import { getWebSocketHandler } from './ws-handler-manager.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;
let lastTickAt: number | null = null;
let configuredTickMs = 30_000;

// ---------------------------------------------------------------------------
// Pure helper (also exported for unit tests)
// ---------------------------------------------------------------------------

/** Which passes should run for a given level. */
export function passesForLevel(level: ReturnType<typeof getOrchestratorLevel>): {
  build: boolean;
  reconcile: boolean;
  triage: boolean;
} {
  const rank = levelRank(level);
  return {
    build: rank >= levelRank('build'),
    reconcile: rank >= levelRank('nudge'),
    // Orch P2: the Grok 'propose' triage pass runs at level propose and above.
    triage: rank >= levelRank('propose'),
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
}

/** One tick: enumerate registered projects and dispatch passes per level. */
export async function runOrchestratorTick(deps: TickDeps = {}): Promise<void> {
  const listProjects = deps.listProjects ?? (() => projectRegistry.list());
  const getLevel = deps.getLevel ?? getOrchestratorLevel;
  const build = deps.build ?? runBuildPass;
  const reconcile = deps.reconcile ?? runReconcilePass;
  const triage = deps.triage ?? ((project: string, opts: { autoResolve: boolean }) => runTriagePass(project, { autoResolve: opts.autoResolve }));

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

    if (lvl === 'off') continue;

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
      const autoResolve = levelRank(lvl) >= levelRank('drive');
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

  const t = setInterval(async () => {
    if (tickRunning) return; // skip overlapping tick
    tickRunning = true;
    // Heartbeat: tell the UI the daemon woke to poll (flashes the header live dot).
    try { getWebSocketHandler()?.broadcast({ type: 'orchestrator_tick', at: Date.now() }); } catch { /* best-effort */ }
    try {
      await runOrchestratorTick();
    } catch (err) {
      console.warn('[orchestrator] Unhandled tick error:', err);
    } finally {
      lastTickAt = Date.now();
      tickRunning = false;
    }
  }, intervalMs);

  // Don't block process exit
  (t as { unref?: () => void }).unref?.();
  timer = t;
}

/** Stop the orchestrator interval. */
export function stopOrchestrator(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
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
