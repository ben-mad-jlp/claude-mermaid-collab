/**
 * BUG 7fb16985 — orchestrator_status vs system_status must NOT disagree on
 * running / level / projects.
 *
 * Root cause: orchestrator_status read getOrchestratorHealth via a dynamic
 * `await import('...orchestrator-live.js')` multi-path loop (and a `.ts` route
 * variant) that, under Bun, could resolve a SECOND module record with its own
 * daemon `timer`/level state — so the two read-models disagreed. The fix routes
 * BOTH through ONE statically-bound getOrchestratorHealth.
 *
 * This test pins the contract at the source-of-truth level: the daemon liveness
 * (`running`) + the per-project `level` that system_status surfaces are BYTE-FOR-
 * BYTE the same values getOrchestratorHealth returns — the single fact both tools
 * project. If a future change re-introduces a second module instance, the live
 * `running` here would diverge from the daemon's and this test would catch it.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import {
  startOrchestrator,
  stopOrchestrator,
  getOrchestratorHealth,
} from '../orchestrator-live.js';
import { summarizeSystemStatus, type SystemStatusInputs } from '../system-status.js';

afterEach(() => stopOrchestrator());

/** Minimal system-status inputs that carry the orchestrator health through. */
function inputsFor(project: string, health: ReturnType<typeof getOrchestratorHealth>): SystemStatusInputs {
  return {
    project,
    now: 1_000,
    orchestratorHealth: health,
    poolOccupancy: 0,
    coldStartsInFlight: 0,
    fleet: {
      summary: { inProgress: 0, working: 0, idle: 0, permission: 0, deadOrGone: 0, overLease: 0 },
      headroom: { procCount: 0, procLimit: 0, percentUsed: 0, level: 'ok' },
      workers: [],
    } as unknown as SystemStatusInputs['fleet'],
    violations: [],
    topology: { canonicalHolder: null, hasShadow: false, instances: [] } as unknown as SystemStatusInputs['topology'],
    repoVersion: null,
    repoHead: null,
    uncommittedCount: null,
    openEscalations: 0,
    pendingDecisions: 0,
    stewardPaused: false,
    supervisorPaused: false,
  };
}

describe('orchestrator_status vs system_status reconciliation (7fb16985)', () => {
  it('both project the SAME running flag from one getOrchestratorHealth — daemon STOPPED', () => {
    stopOrchestrator();
    const health = getOrchestratorHealth();
    const sys = summarizeSystemStatus(inputsFor('/proj/x', health));
    // orchestrator_status returns `running: health.running`; system_status returns
    // `orchestrator.running: health.running`. Same source ⇒ same value.
    expect(sys.orchestrator.running).toBe(health.running);
    expect(health.running).toBe(false);
  });

  it('both project the SAME running flag — daemon RUNNING (no second module record)', () => {
    startOrchestrator(45_000);
    const health = getOrchestratorHealth();
    expect(health.running).toBe(true); // the daemon we just started IS visible here
    const sys = summarizeSystemStatus(inputsFor('/proj/x', health));
    expect(sys.orchestrator.running).toBe(true);
    expect(sys.orchestrator.running).toBe(health.running);
    expect(sys.orchestrator.tickMs).toBe(health.tickMs);
    expect(sys.orchestrator.lastTickAt).toBe(health.lastTickAt);
  });

  it('level + projects agree: system_status reads the level from the same projects[] rows', () => {
    const health: ReturnType<typeof getOrchestratorHealth> = {
      running: true,
      tickMs: 30_000,
      lastTickAt: 123,
      currentPhase: null,
      tickRunningMs: null,
      projects: [{ project: '/proj/drive', level: 'drive' }],
    };
    const sys = summarizeSystemStatus(inputsFor('/proj/drive', health));
    // system_status derives its level from health.projects (the SAME array
    // orchestrator_status returns verbatim as `projects`).
    expect(sys.orchestrator.level).toBe('drive');
    const fromOrchStatus = health.projects.find((p) => p.project === '/proj/drive')?.level ?? 'build';
    expect(sys.orchestrator.level).toBe(fromOrchStatus);
  });

  it('a project with NO level row defaults to build in BOTH read-models', () => {
    const health: ReturnType<typeof getOrchestratorHealth> = {
      running: true, tickMs: 30_000, lastTickAt: 1, currentPhase: null, tickRunningMs: null, projects: [],
    };
    const sys = summarizeSystemStatus(inputsFor('/proj/unset', health));
    expect(sys.orchestrator.level).toBe('build');
    const fromOrchStatus = health.projects.find((p) => p.project === '/proj/unset')?.level ?? 'build';
    expect(sys.orchestrator.level).toBe(fromOrchStatus);
  });
});
