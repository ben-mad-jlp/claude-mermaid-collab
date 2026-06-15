/**
 * system_status — THE one-call rollup the steward calls FIRST.
 *
 * Instead of grounding a steward decision on a stale checkpoint + N ad-hoc bash
 * probes, this single read-only call composes the four foundational status tools
 * plus the few inline facts a steward always wants in the same breath:
 *
 *   1. orchestrator_status  → daemon running/level, pool occupancy, cold-starts.
 *   2. fleet_status         → worker occupancy + the proc-headroom early warning.
 *   3. invariant_check      → work-graph violation count (graph health).
 *   4. instance_topology    → canonical-server confirmation vs stale shadows.
 *   + inline:
 *      - deploy/version drift: the live canonical sidecar (pid + version +
 *        startedAt) vs the repo's package.json version + git HEAD + uncommitted
 *        WIP — the "did the deploy actually land, or go cosmetic?" read.
 *      - open-escalation + pending-decision counts (the human/steward inbox).
 *      - steward + supervisor pause state.
 *
 * It COMPOSES the foundational read-models (calls their exported functions)
 * rather than recomputing them, so every field matches its standalone tool. The
 * result is a COMPACT summary with drill-down pointers: call the named focused
 * tool for the full detail behind any rollup field.
 *
 * NOTE on the ps snapshot: fleet_status takes its own single `ps` snapshot
 * internally (one spawn). We call getFleetStatus directly so the headroom/
 * occupancy numbers are byte-identical to the standalone fleet_status tool —
 * correctness/parity over shaving one `ps`. instance_topology's probes are
 * lock/health/registry reads, not `ps`, so there is no second ps here.
 *
 * The core (`summarizeSystemStatus`) is a PURE function over already-fetched
 * inputs so it is trivially unit-testable; `systemStatus` is the thin wrapper
 * that fetches from the foundational read-models and delegates to it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getFleetStatus, type FleetStatus } from './fleet-status';
import { checkInvariants, type InvariantViolation } from './invariant-check';
import { instanceTopology, type InstanceTopology } from './instance-topology';
import { getOrchestratorHealth } from './orchestrator-live.js';
import { getColdStartsInFlight } from './coordinator-live';
import { listPool } from './worker-pool';
import {
  listOpenEscalations,
  pendingDecisionCount,
  isStewardPaused,
  isSupervisorPaused,
} from './supervisor-store';

/** Live canonical sidecar identity vs the repo it should have been built from. */
export interface DeployDrift {
  /** pid of the live :9002 owner (the running sidecar), or null if none answered. */
  livePid: number | null;
  /** version the live sidecar reports, or null. */
  liveVersion: string | null;
  /** when the live sidecar started (ISO), or null. */
  liveStartedAt: string | null;
  /** version in the repo's package.json, or null if unreadable. */
  repoVersion: string | null;
  /** short git HEAD sha of the repo, or null if not a git repo / git missing. */
  repoHead: string | null;
  /** count of uncommitted (modified + untracked) paths in the repo, or null. */
  uncommittedCount: number | null;
  /**
   * True when the live sidecar is NOT the repo's current build — its version
   * differs from package.json, OR the repo carries uncommitted WIP that the live
   * server can't be running. This is the "deploy went cosmetic / is stale" flag.
   * Null when we can't tell (no live server or unreadable repo version).
   */
  drift: boolean | null;
}

export interface SystemStatus {
  project: string;
  now: number;
  /** orchestrator_status rollup. */
  orchestrator: {
    running: boolean;
    /** this project's orchestrator level (default 'build' when unset). */
    level: string;
    tickMs: number;
    lastTickAt: number | null;
    /** occupied pool lanes (one row per registered slot). */
    poolOccupancy: number;
    coldStartsInFlight: number;
  };
  /** fleet_status rollup (occupancy + proc-headroom early warning). */
  fleet: {
    inProgress: number;
    working: number;
    idle: number;
    permission: number;
    deadOrGone: number;
    overLease: number;
    headroom: FleetStatus['headroom'];
  };
  /** invariant_check rollup. */
  invariants: {
    violationCount: number;
    /** the distinct violation kinds present (for a one-glance read). */
    kinds: string[];
  };
  /** instance_topology rollup — canonical-server confirmation vs shadows. */
  instances: {
    /** True when a live process owns the canonical :9002 port. */
    canonicalConfirmed: boolean;
    canonicalHolder: InstanceTopology['canonicalHolder'];
    /** True when ≥1 instance is a stale shadow of the canonical port. */
    hasShadow: boolean;
    shadowCount: number;
    instanceCount: number;
  };
  /** inline deploy/version drift (live sidecar vs repo HEAD). */
  deploy: DeployDrift;
  /** inline human/steward inbox counts. */
  inbox: {
    openEscalations: number;
    pendingDecisions: number;
  };
  /** inline pause state. */
  pause: {
    steward: boolean;
    supervisor: boolean;
  };
  /** Drill-down: which focused tool to call for the full detail behind a field. */
  pointers: Record<string, string>;
}

/** Read package.json `version` from a project root. Injectable for tests. */
function defaultRepoVersion(project: string): string | null {
  try {
    const raw = readFileSync(join(project, 'package.json'), 'utf8');
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Read git HEAD (short) + uncommitted count from a project. Injectable for tests. */
function defaultGitInfo(project: string): { head: string | null; uncommittedCount: number | null } {
  let head: string | null = null;
  let uncommittedCount: number | null = null;
  try {
    head = execFileSync('git', ['-C', project, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    head = null;
  }
  try {
    const out = execFileSync('git', ['-C', project, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    uncommittedCount = out.split('\n').filter((l) => l.trim().length > 0).length;
  } catch {
    uncommittedCount = null;
  }
  return { head, uncommittedCount };
}

export interface SystemStatusInputs {
  project: string;
  now: number;
  orchestratorHealth: ReturnType<typeof getOrchestratorHealth>;
  poolOccupancy: number;
  coldStartsInFlight: number;
  fleet: FleetStatus;
  violations: InvariantViolation[];
  topology: InstanceTopology;
  repoVersion: string | null;
  repoHead: string | null;
  uncommittedCount: number | null;
  openEscalations: number;
  pendingDecisions: number;
  stewardPaused: boolean;
  supervisorPaused: boolean;
}

/**
 * Pure rollup — assembles already-fetched foundational read-models into the
 * compact system-status summary. No I/O, so unit tests feed hand-built inputs.
 */
export function summarizeSystemStatus(inp: SystemStatusInputs): SystemStatus {
  const { topology } = inp;
  const liveVersion = topology.canonicalHolder?.version ?? null;
  const livePid = topology.canonicalHolder?.pid ?? null;
  const liveStartedAt = topology.canonicalHolder?.startedAt ?? null;

  // Drift is knowable only when we have BOTH a live version and a repo version.
  // It's drift if the running sidecar is a different version than the repo, or
  // the repo carries uncommitted WIP the live server can't be running.
  let drift: boolean | null;
  if (liveVersion == null || inp.repoVersion == null) {
    drift = null;
  } else {
    drift = liveVersion !== inp.repoVersion || (inp.uncommittedCount ?? 0) > 0;
  }

  const level =
    inp.orchestratorHealth.projects.find((p) => p.project === inp.project)?.level ?? 'build';

  const kinds = Array.from(new Set(inp.violations.map((v) => v.kind)));

  return {
    project: inp.project,
    now: inp.now,
    orchestrator: {
      running: inp.orchestratorHealth.running,
      level,
      tickMs: inp.orchestratorHealth.tickMs,
      lastTickAt: inp.orchestratorHealth.lastTickAt,
      poolOccupancy: inp.poolOccupancy,
      coldStartsInFlight: inp.coldStartsInFlight,
    },
    fleet: {
      inProgress: inp.fleet.summary.inProgress,
      working: inp.fleet.summary.working,
      idle: inp.fleet.summary.idle,
      permission: inp.fleet.summary.permission,
      deadOrGone: inp.fleet.summary.deadOrGone,
      overLease: inp.fleet.summary.overLease,
      headroom: inp.fleet.headroom,
    },
    invariants: {
      violationCount: inp.violations.length,
      kinds,
    },
    instances: {
      canonicalConfirmed: topology.canonicalHolder != null,
      canonicalHolder: topology.canonicalHolder,
      hasShadow: topology.hasShadow,
      shadowCount: topology.instances.filter((i) => i.tag === 'shadow').length,
      instanceCount: topology.instances.length,
    },
    deploy: {
      livePid,
      liveVersion,
      liveStartedAt,
      repoVersion: inp.repoVersion,
      repoHead: inp.repoHead,
      uncommittedCount: inp.uncommittedCount,
      drift,
    },
    inbox: {
      openEscalations: inp.openEscalations,
      pendingDecisions: inp.pendingDecisions,
    },
    pause: {
      steward: inp.stewardPaused,
      supervisor: inp.supervisorPaused,
    },
    pointers: {
      orchestrator: 'orchestrator_status',
      fleet: 'fleet_status',
      invariants: 'invariant_check',
      instances: 'instance_topology',
      inbox: 'escalation_list / supervisor_next_decision',
      pause: 'steward_pause_status / supervisor_pause_status',
    },
  };
}

export interface SystemStatusDeps {
  now?: number;
  repoVersionImpl?: (project: string) => string | null;
  gitInfoImpl?: (project: string) => { head: string | null; uncommittedCount: number | null };
}

/**
 * Wrapper the MCP tool calls. Fetches each foundational read-model via its
 * exported function (composing, not recomputing) + the inline deploy/inbox/pause
 * facts, then delegates to the pure {@link summarizeSystemStatus}.
 */
export async function systemStatus(project: string, deps: SystemStatusDeps = {}): Promise<SystemStatus> {
  const now = deps.now ?? Date.now();
  const repoVersionFn = deps.repoVersionImpl ?? defaultRepoVersion;
  const gitInfoFn = deps.gitInfoImpl ?? defaultGitInfo;

  const orchestratorHealth = getOrchestratorHealth();
  // Registry is partitioned by project; count only this project's slots.
  const poolOccupancy = listPool().filter((s) => s.project === project).length;
  const coldStartsInFlight = getColdStartsInFlight();
  const fleet = getFleetStatus(project, now);
  const violations = checkInvariants(project);
  const topology = await instanceTopology();
  const repoVersion = repoVersionFn(project);
  const { head: repoHead, uncommittedCount } = gitInfoFn(project);

  return summarizeSystemStatus({
    project,
    now,
    orchestratorHealth,
    poolOccupancy,
    coldStartsInFlight,
    fleet,
    violations,
    topology,
    repoVersion,
    repoHead,
    uncommittedCount,
    openEscalations: listOpenEscalations().length,
    pendingDecisions: pendingDecisionCount(project),
    stewardPaused: isStewardPaused(),
    supervisorPaused: isSupervisorPaused(project),
  });
}
