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
  withPassTimeout,
  type TickDeps,
} from '../orchestrator-live';

const buildCalls: string[] = [];
const notifyCalls: string[] = [];
const reconcileCalls: string[] = [];
const triageCalls: string[] = [];
const triageAutoResolve: Array<{ project: string; autoResolve: boolean }> = [];
let buildShouldThrow: string | null = null; // project path whose build should throw
const registeredProjects: Array<{ path: string; name: string; lastAccess: string }> = [];
const levelOverrides = new Map<string, string>();
const setLevelCalls: Array<{ project: string; level: string }> = [];
// Config rows that exist in orchestrator_config but are NOT in the registry (e.g. stale /tmp
// test projects) — the sweep must still force these off.
const configOnly: Array<{ project: string; level: 'off' | 'on' | 'auto' }> = [];
// null → every registered project is treated as watched (existing tests' default); a Set
// restricts the watched set so the unwatched-auto-off path can be exercised.
let watchedOverride: Set<string> | null = null;

function makeDeps(): TickDeps {
  return {
    listProjects: async () => [...registeredProjects],
    getLevel: (project: string) => (levelOverrides.get(project) ?? 'on') as 'off' | 'on' | 'auto',
    watchedProjects: () => watchedOverride ?? new Set(registeredProjects.map((p) => p.path)),
    setLevel: (project: string, level) => { setLevelCalls.push({ project, level }); levelOverrides.set(project, level); },
    // Configured projects = the registered ones with their level (plus any config-only
    // entries the test injects via configOnly), mirroring orchestrator_config.
    listConfigured: () => [
      ...registeredProjects.map((p) => ({ project: p.path, level: (levelOverrides.get(p.path) ?? 'on') as 'off' | 'on' | 'auto' })),
      ...configOnly.map((c) => ({ project: c.project, level: c.level })),
    ],
    build: async (project: string) => {
      if (buildShouldThrow && project === buildShouldThrow) throw new Error(`simulated build failure for ${project}`);
      buildCalls.push(project);
    },
    notify: async (project: string) => { notifyCalls.push(project); return { enqueued: 0, nudged: [] }; },
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
  notifyCalls.length = 0;
  reconcileCalls.length = 0;
  triageCalls.length = 0;
  triageAutoResolve.length = 0;
  buildShouldThrow = null;
  registeredProjects.length = 0;
  levelOverrides.clear();
  setLevelCalls.length = 0;
  watchedOverride = null;
  configOnly.length = 0;
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

describe('withPassTimeout (per-pass backstop)', () => {
  it('resolves with the value when the pass beats the deadline', async () => {
    await expect(withPassTimeout(Promise.resolve(42), 1000, 'x')).resolves.toBe(42);
  });

  it('rejects with a labelled error when the pass exceeds the deadline', async () => {
    const never = new Promise<number>(() => {}); // never settles → simulates a wedge
    await expect(withPassTimeout(never, 20, 'proj:build')).rejects.toThrow(/pass-timeout.*proj:build/);
  });

  it('propagates the pass\'s own rejection (does not swallow real errors)', async () => {
    await expect(withPassTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
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
    // ...but notifications run even at off (decoupled from build) for watched projects.
    expect(notifyCalls).toEqual(['/proj/a']);
  });

  it('notifications do NOT run for an UNWATCHED project (even though forced off)', async () => {
    registeredProjects.push({ path: '/proj/unwatched', name: 'u', lastAccess: '' });
    levelOverrides.set('/proj/unwatched', 'on'); // will be force-off by the sweep
    watchedOverride = new Set(); // nothing is watched

    await runOrchestratorTick(makeDeps());

    expect(buildCalls).toEqual([]);
    expect(notifyCalls).toEqual([]); // unwatched → no notify, matching unwatched-auto-off intent
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

  it('unwatched projects are forced off — registered AND config-only (never built)', async () => {
    reset();
    registeredProjects.push(
      { path: '/p/watched', name: 'w', lastAccess: '' },
      { path: '/p/orphan', name: 'o', lastAccess: '' }, // registered but unwatched
    );
    levelOverrides.set('/p/watched', 'auto');
    levelOverrides.set('/p/orphan', 'on');
    configOnly.push({ project: '/tmp/stale', level: 'on' }); // config-only, not in the registry
    watchedOverride = new Set(['/p/watched']);
    await runOrchestratorTick(makeDeps());
    expect(buildCalls).toEqual(['/p/watched']); // neither orphan nor the /tmp entry built
    expect(reconcileCalls).toEqual(['/p/watched']);
    // Both unwatched non-off projects forced off (the sweep covers the config-only one too).
    expect(setLevelCalls.map((c) => c.project).sort()).toEqual(['/p/orphan', '/tmp/stale']);
    expect(setLevelCalls.every((c) => c.level === 'off')).toBe(true);
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
