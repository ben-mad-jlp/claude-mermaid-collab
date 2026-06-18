/**
 * Unit tests for src/services/orchestrator-live.ts
 *
 * Strategy: the dispatch logic (which passes run for which level) is tested via
 * the exported pure helper `passesForLevel`. The integration of runOrchestratorTick
 * with real project enumeration is tested via module mocks for projectRegistry,
 * runBuildPass, and runReconcilePass so no FS/SQLite I/O is required.
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// runOrchestratorTick takes injectable deps, so we drive it with plain spies —
// NO `mock.module` (which is process-global in bun and would clobber the real
// reconcile-pass/coordinator-live modules for their own test files).
import {
  passesForLevel,
  runOrchestratorTick,
  startOrchestrator,
  stopOrchestrator,
  isOrchestratorRunning,
  getOrchestratorHealth,
  type TickDeps,
} from '../orchestrator-live';

const buildCalls: string[] = [];
const reconcileCalls: string[] = [];
const triageCalls: string[] = [];
const triageAutoResolve: Array<{ project: string; autoResolve: boolean }> = [];
let buildShouldThrow: string | null = null; // project path whose build should throw
const registeredProjects: Array<{ path: string; name: string; lastAccess: string }> = [];
const levelOverrides = new Map<string, string>();

function makeDeps(): TickDeps {
  return {
    listProjects: async () => [...registeredProjects],
    getLevel: (project: string) => (levelOverrides.get(project) ?? 'on') as 'off' | 'on' | 'auto',
    build: async (project: string) => {
      if (buildShouldThrow && project === buildShouldThrow) throw new Error(`simulated build failure for ${project}`);
      buildCalls.push(project);
    },
    reconcile: async (project: string) => { reconcileCalls.push(project); },
    triage: async (project: string, opts: { autoResolve: boolean }) => {
      triageCalls.push(project);
      triageAutoResolve.push({ project, autoResolve: opts.autoResolve });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reset() {
  buildCalls.length = 0;
  reconcileCalls.length = 0;
  triageCalls.length = 0;
  triageAutoResolve.length = 0;
  buildShouldThrow = null;
  registeredProjects.length = 0;
  levelOverrides.clear();
  stopOrchestrator();
}

// ---------------------------------------------------------------------------
// passesForLevel — pure unit tests (no mocks needed)
// ---------------------------------------------------------------------------

describe('passesForLevel', () => {
  it('off → no passes', () => {
    expect(passesForLevel('off')).toEqual({ build: false, reconcile: false, triage: false });
  });

  it('on → build + reconcile + triage (suggest write-only)', () => {
    expect(passesForLevel('on')).toEqual({ build: true, reconcile: true, triage: true });
  });

  it('auto → build + reconcile + triage', () => {
    expect(passesForLevel('auto')).toEqual({ build: true, reconcile: true, triage: true });
  });
});

// ---------------------------------------------------------------------------
// runOrchestratorTick — dispatch tests
// ---------------------------------------------------------------------------

describe('runOrchestratorTick', () => {
  beforeEach(() => reset());

  it('off level: runs nothing', async () => {
    registeredProjects.push({ path: '/proj/a', name: 'a', lastAccess: '' });
    levelOverrides.set('/proj/a', 'off');

    await runOrchestratorTick(makeDeps());

    expect(buildCalls).toEqual([]);
    expect(reconcileCalls).toEqual([]);
  });

  it('on level: runs build + reconcile + triage (suggest), autoResolve=false', async () => {
    registeredProjects.push({ path: '/proj/b', name: 'b', lastAccess: '' });
    levelOverrides.set('/proj/b', 'on');

    await runOrchestratorTick(makeDeps());

    expect(buildCalls).toEqual(['/proj/b']);
    expect(reconcileCalls).toEqual(['/proj/b']);
    expect(triageCalls).toEqual(['/proj/b']);
    // `on` writes suggestions but does NOT auto-resolve.
    expect(triageAutoResolve).toEqual([{ project: '/proj/b', autoResolve: false }]);
  });

  it('auto level: triage runs with autoResolve=true', async () => {
    registeredProjects.push({ path: '/proj/x', name: 'x', lastAccess: '' });
    levelOverrides.set('/proj/x', 'auto');

    await runOrchestratorTick(makeDeps());

    expect(buildCalls).toEqual(['/proj/x']);
    expect(reconcileCalls).toEqual(['/proj/x']);
    expect(triageCalls).toEqual(['/proj/x']);
    expect(triageAutoResolve).toEqual([{ project: '/proj/x', autoResolve: true }]);
  });

  it('fail-open: a throwing build pass does NOT block other projects', async () => {
    registeredProjects.push(
      { path: '/proj/bad', name: 'bad', lastAccess: '' },
      { path: '/proj/good', name: 'good', lastAccess: '' },
    );
    levelOverrides.set('/proj/bad', 'on');
    levelOverrides.set('/proj/good', 'on');
    buildShouldThrow = '/proj/bad';

    // Should not throw
    await expect(runOrchestratorTick(makeDeps())).resolves.toBeUndefined();

    // bad project's build threw — not in calls
    expect(buildCalls).not.toContain('/proj/bad');
    // good project still ran
    expect(buildCalls).toContain('/proj/good');
  });

  it('no projects: tick completes cleanly', async () => {
    await expect(runOrchestratorTick(makeDeps())).resolves.toBeUndefined();
    expect(buildCalls).toEqual([]);
    expect(reconcileCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('startOrchestrator / stopOrchestrator', () => {
  beforeEach(() => reset());

  it('starts and reports running', () => {
    startOrchestrator(60_000);
    expect(isOrchestratorRunning()).toBe(true);
    stopOrchestrator();
  });

  it('is idempotent — second start is a no-op', () => {
    startOrchestrator(60_000);
    startOrchestrator(60_000); // should not throw or create second timer
    expect(isOrchestratorRunning()).toBe(true);
    stopOrchestrator();
  });

  it('stops and reports not running', () => {
    startOrchestrator(60_000);
    stopOrchestrator();
    expect(isOrchestratorRunning()).toBe(false);
  });

  it('getOrchestratorHealth reflects running state', () => {
    startOrchestrator(45_000);
    const h = getOrchestratorHealth();
    expect(h.running).toBe(true);
    expect(h.tickMs).toBe(45_000);
    stopOrchestrator();
    expect(getOrchestratorHealth().running).toBe(false);
  });
});
