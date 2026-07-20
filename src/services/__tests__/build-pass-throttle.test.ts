// Runs via `bun test` (coordinator-live / orchestrator-live pull bun:sqlite-backed stores) —
// excluded from vitest. Phase 5 (mission c4eb4fcc): the PERIODIC build safety-net scan (runTick's
// lease/orphan/stall sweep + listReadyTodos claim scan on the 8MB DB) is throttled off the
// every-tick cadence via shouldRunBuildPass, BUT a kick-triggered (force) tick BYPASSES the gate so
// a ready-todo is claimed immediately. This file proves BOTH:
//   1. the gate itself throttles per project (same shape as reconcile), and
//   2. THE CLAIM-LATENCY GUARANTEE: runOrchestratorTick({ force:true }) builds even within the
//      throttle interval, while a plain periodic tick ({ force:false }) skips the throttled build.
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  shouldRunBuildPass,
  BUILD_PASS_INTERVAL_MS,
  _resetBuildPassThrottle,
} from '../coordinator-live';
import { runOrchestratorTick, type TickDeps } from '../orchestrator-live';

describe('build-pass throttle — shouldRunBuildPass', () => {
  beforeEach(() => _resetBuildPassThrottle());

  it('runs on the first call for a project', () => {
    expect(shouldRunBuildPass('/build-throttle-first', 5_000_000)).toBe(true);
  });

  it('skips a second call within the interval', () => {
    const t = 5_000_000;
    const p = '/build-throttle-skip';
    expect(shouldRunBuildPass(p, t)).toBe(true);
    expect(shouldRunBuildPass(p, t + 1)).toBe(false);
    expect(shouldRunBuildPass(p, t + BUILD_PASS_INTERVAL_MS - 1)).toBe(false);
  });

  it('runs again at the interval boundary and re-arms', () => {
    const t = 5_000_000;
    const p = '/build-throttle-advance';
    expect(shouldRunBuildPass(p, t)).toBe(true);
    expect(shouldRunBuildPass(p, t + 1)).toBe(false);
    expect(shouldRunBuildPass(p, t + BUILD_PASS_INTERVAL_MS)).toBe(true);
    expect(shouldRunBuildPass(p, t + BUILD_PASS_INTERVAL_MS + 1)).toBe(false);
  });

  it('throttles each project independently', () => {
    const t = 5_000_000;
    expect(shouldRunBuildPass('/build-throttle-a', t)).toBe(true);
    expect(shouldRunBuildPass('/build-throttle-b', t)).toBe(true);
    expect(shouldRunBuildPass('/build-throttle-a', t + 1)).toBe(false);
    expect(shouldRunBuildPass('/build-throttle-b', t + 1)).toBe(false);
  });

  it('first-call-runs regardless of absolute clock value (no cold-start skip)', () => {
    expect(shouldRunBuildPass('/build-throttle-coldstart', 10)).toBe(true);
    expect(shouldRunBuildPass('/build-throttle-coldstart', 11)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE CLAIM-LATENCY GUARANTEE — a kick (force) tick bypasses the throttle.
// ---------------------------------------------------------------------------
describe('build throttle — kick (force) preserves claim latency', () => {
  const project = '/proj/build-force';

  // A minimal tick harness that drives ONLY the build pass through a real (closed-over)
  // throttle clock, so we exercise the exact `force || shouldRunBuild(project)` decision in
  // runOrchestratorTick. All other passes are no-op'd so the tick just decides build-or-skip.
  function makeDeps(buildCalls: string[], gateNow: () => number): TickDeps {
    return {
      listProjects: async () => [{ path: project }],
      getLevel: () => 'on',
      watchedProjects: () => new Set([project]),
      listConfigured: () => [{ project, level: 'on' }],
      dirExists: () => true,
      build: async (p: string) => { buildCalls.push(p); },
      // Real throttle semantics, but with an injected clock so we control the interval window.
      shouldRunBuild: (p: string) => shouldRunBuildPass(p, gateNow()),
      // No-op every other pass + force their gates open so nothing else touches a real DB.
      notify: async () => ({ enqueued: 0, nudged: [] }),
      shouldRunNotify: () => true,
      reconcile: async () => {},
      shouldRunReconcile: () => true,
      frictionWatch: async () => ({}),
      shouldRunFrictionWatch: () => true,
      frictionTriage: async () => ({}),
      missionIntake: async () => ({}),
      recycle: async () => ({}),
      missionLoop: async () => ({}),
      shouldRunMissionLoop: () => true,
    };
  }

  beforeEach(() => _resetBuildPassThrottle());

  it('a plain periodic tick within the throttle interval SKIPS build; a kicked (force) tick BUILDS', async () => {
    let now = 1_000_000;
    const buildCalls: string[] = [];
    const deps = makeDeps(buildCalls, () => now);

    // Tick 1 (periodic): first call for the project → throttle opens → builds, arming the window.
    await runOrchestratorTick({ ...deps, force: false });
    expect(buildCalls).toEqual([project]);

    // Tick 2 (periodic, still within BUILD_PASS_INTERVAL_MS): throttle SKIPS the build scan.
    now += 1_000; // well under the 2-min interval
    await runOrchestratorTick({ ...deps, force: false });
    expect(buildCalls).toEqual([project]); // unchanged — periodic scan throttled

    // Tick 3 (KICK / force, SAME instant, still within the interval): MUST build anyway — this is
    // the claim-latency guarantee. force short-circuits the throttle so a ready todo is claimed now.
    await runOrchestratorTick({ ...deps, force: true });
    expect(buildCalls).toEqual([project, project]); // built again despite the throttle window

    // Tick 4 (periodic again, still within interval): back to throttled — force did not consume the
    // gate clock, so the periodic cadence is unchanged and still skips.
    await runOrchestratorTick({ ...deps, force: false });
    expect(buildCalls).toEqual([project, project]); // still throttled
  });

  it('build never runs for an off project even under force (force bypasses the throttle, not the level gate)', async () => {
    let now = 2_000_000;
    const buildCalls: string[] = [];
    const deps = makeDeps(buildCalls, () => now);
    now += 1;
    await runOrchestratorTick({ ...deps, getLevel: () => 'off', force: true });
    expect(buildCalls).toEqual([]); // off → passes.build false → no build even when forced
  });
});
