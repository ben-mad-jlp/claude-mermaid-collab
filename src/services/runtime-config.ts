/**
 * runtime_config — the effective control plane in ONE read.
 *
 * The steward repeatedly had to read ~/.mermaid-collab/config.json by hand and
 * cross-reference N pause/override tools to answer "what knobs is the daemon
 * ACTUALLY running with right now?". This composes that into a single read-only
 * view:
 *
 *   1. Resolved runtime flags — the values the running daemon actually uses
 *      (not what config.json *says*, but what the process resolved at launch):
 *      worker isolation, per-type pool sizes, cold-start cap, dead-grace, and
 *      the effective context-watchdog threshold for the project.
 *   2. Every pause / override — steward pause+liveness, supervisor pauses, and
 *      this project's orchestrator autonomy level.
 *
 * Like system_status, the core (`summarizeRuntimeConfig`) is a PURE function
 * over already-fetched inputs (trivially unit-testable); `runtimeConfig` is the
 * thin wrapper that fetches from the owning modules and delegates. Each flag is
 * read via the owning module's exported accessor so the reported value is
 * byte-identical to what the daemon uses (compose, don't recompute). Read-only.
 */
import {
  workerIsolationEnabled,
  getMaxColdStarts,
  getDeadGraceMs,
} from './coordinator-live';
import { POOL_CONFIG, type PoolConfig } from './worker-pool';
import { getOrchestratorHealth } from './orchestrator-live';
import { DEFAULT_WATCHDOG_CONFIG } from './context-watchdog';
import {
  getWatchdogThreshold,
  isStewardPaused,
  isStewardLive,
  stewardAutoEnabled,
  isStewardEnabled,
  isSupervisorPaused,
  listSupervisorPauses,
} from './supervisor-store';

export interface RuntimeConfig {
  project: string;
  now: number;
  /** Resolved runtime flags — the values the running daemon actually uses. */
  flags: {
    /** MERMAID_WORKER_ISOLATION — workers run in isolated git worktrees when true. */
    workerIsolation: boolean;
    /** Per-type pool slot counts (MERMAID_POOL_<TYPE>), the parallelism dial. */
    poolSizes: PoolConfig;
    /** MERMAID_MAX_COLD_STARTS — max concurrent worker cold-starts in flight. */
    maxColdStarts: number;
    /** MERMAID_DEAD_GRACE resolved to ms — dead-worker confirmation window. */
    deadGraceMs: number;
    /** Effective context-watchdog trigger threshold (%) for this project. */
    watchdog: {
      /** The threshold actually in force: per-project override, else the default. */
      effectivePercent: number;
      /** Per-project override (%), or null when none is set (default in force). */
      perProjectOverride: number | null;
      /** The built-in default threshold (%) when no override is set. */
      defaultPercent: number;
    };
  };
  /** Every pause / override state in the control plane. */
  overrides: {
    /** Steward pause + liveness (mirrors steward_pause_status). */
    steward: {
      paused: boolean;
      live: boolean;
      /** Env arm (MERMAID_STEWARD_AUTO). */
      autoEnabled: boolean;
      /** Live human on/off switch. */
      switchedOn: boolean;
    };
    /** Supervisor pauses (mirrors supervisor_pause_status) + this project's view. */
    supervisor: {
      /** True when this project's supervisor is paused (global or per-project scope). */
      pausedForProject: boolean;
      pauses: Array<{ scope: string; pausedAt: number }>;
    };
    /** This project's orchestrator autonomy level (default 'build' when unset). */
    orchestrator: {
      level: string;
    };
  };
  /** Drill-down: which focused tool to call for the full detail behind a field. */
  pointers: Record<string, string>;
}

export interface RuntimeConfigInputs {
  project: string;
  now: number;
  workerIsolation: boolean;
  poolSizes: PoolConfig;
  maxColdStarts: number;
  deadGraceMs: number;
  perProjectWatchdogThreshold: number | null;
  defaultWatchdogThreshold: number;
  orchestratorLevel: string;
  stewardPaused: boolean;
  stewardLive: boolean;
  stewardAutoEnabled: boolean;
  stewardSwitchedOn: boolean;
  supervisorPausedForProject: boolean;
  supervisorPauses: Array<{ scope: string; pausedAt: number }>;
}

/**
 * Pure rollup — assembles already-resolved flags + pause states into the
 * compact runtime-config view. No I/O, so unit tests feed hand-built inputs.
 */
export function summarizeRuntimeConfig(inp: RuntimeConfigInputs): RuntimeConfig {
  const effectivePercent = inp.perProjectWatchdogThreshold ?? inp.defaultWatchdogThreshold;
  return {
    project: inp.project,
    now: inp.now,
    flags: {
      workerIsolation: inp.workerIsolation,
      poolSizes: inp.poolSizes,
      maxColdStarts: inp.maxColdStarts,
      deadGraceMs: inp.deadGraceMs,
      watchdog: {
        effectivePercent,
        perProjectOverride: inp.perProjectWatchdogThreshold,
        defaultPercent: inp.defaultWatchdogThreshold,
      },
    },
    overrides: {
      steward: {
        paused: inp.stewardPaused,
        live: inp.stewardLive,
        autoEnabled: inp.stewardAutoEnabled,
        switchedOn: inp.stewardSwitchedOn,
      },
      supervisor: {
        pausedForProject: inp.supervisorPausedForProject,
        pauses: inp.supervisorPauses,
      },
      orchestrator: {
        level: inp.orchestratorLevel,
      },
    },
    pointers: {
      watchdog: 'set_watchdog_threshold',
      steward: 'steward_pause_status / steward_pause / steward_resume',
      supervisor: 'supervisor_pause_status / supervisor_pause / supervisor_resume',
      orchestrator: 'orchestrator_status',
    },
  };
}

/**
 * Wrapper the MCP tool calls. Resolves each flag via the owning module's
 * exported accessor (so the value matches what the daemon uses) + the pause /
 * override states, then delegates to the pure {@link summarizeRuntimeConfig}.
 */
export function runtimeConfig(project: string, now: number = Date.now()): RuntimeConfig {
  const orchestratorLevel =
    getOrchestratorHealth().projects.find((p) => p.project === project)?.level ?? 'build';

  return summarizeRuntimeConfig({
    project,
    now,
    workerIsolation: workerIsolationEnabled(),
    poolSizes: { ...POOL_CONFIG },
    maxColdStarts: getMaxColdStarts(),
    deadGraceMs: getDeadGraceMs(),
    perProjectWatchdogThreshold: getWatchdogThreshold(project),
    defaultWatchdogThreshold: DEFAULT_WATCHDOG_CONFIG.thresholdPercent,
    orchestratorLevel,
    stewardPaused: isStewardPaused(),
    stewardLive: isStewardLive(now),
    stewardAutoEnabled: stewardAutoEnabled(),
    stewardSwitchedOn: isStewardEnabled(),
    supervisorPausedForProject: isSupervisorPaused(project),
    supervisorPauses: listSupervisorPauses(),
  });
}
