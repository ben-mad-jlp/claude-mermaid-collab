/**
 * Unit tests for campaign-pass scheduling integration in orchestrator-live.ts
 *
 * Strategy: drive the real runOrchestratorTick with injected TickDeps to verify
 * the campaign pass is dispatched with correct guard operand ordering. The three
 * tests verify:
 * 1. The campaign pass is invoked when both the level and throttle gates permit it.
 * 2. The pass is skipped inside the throttle window (per-project clock).
 * 3. The pass is skipped when the campaign level reads 'off', AND the throttle gate
 *    is never called (the left-of-side-effect ordering proof).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the supervisor.db BEFORE the store modules open it.
const dir = mkdtempSync(join(tmpdir(), 'campaign-pass-sched-'));
process.env.MERMAID_SUPERVISOR_DIR = dir;

import {
  runOrchestratorTick,
  stopOrchestrator,
  type TickDeps,
} from '../orchestrator-live';
import { _closeDb } from '../orchestrator-config';
import { _closeDb as supervisorCloseDb } from '../supervisor-store';

beforeAll(() => {
  _closeDb();
  supervisorCloseDb();
});

afterAll(() => {
  _closeDb();
  supervisorCloseDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('campaign-pass scheduling in orchestrator tick', () => {
  afterEach(() => {
    stopOrchestrator();
  });

  it('invokes the campaign pass from the orchestrator tick when the project level permits it', async () => {
    const project = '/tmp/test-campaign-project';
    const campaignPassCalls: string[] = [];

    const deps: TickDeps = {
      listProjects: async () => [{ path: project }],
      getLevel: () => 'on',
      watchedProjects: () => new Set([project]),
      dirExists: () => true,
      listConfigured: () => [{ project, level: 'on' }],
      setLevel: () => {},
      loadTodos: () => [],
      // All other passes disabled to isolate campaign pass
      shouldRunNotify: () => false,
      shouldRunFrictionWatch: () => false,
      shouldRunFrictionTriage: () => false,
      shouldRunBurnWatch: () => false,
      shouldRunMissionIntake: () => false,
      shouldRunRepairForge: () => false,
      shouldRunRepairVerifyFiler: () => false,
      shouldRunReconcile: () => false,
      shouldRunArchival: () => false,
      shouldRunLandedEpicSweep: () => false,
      shouldRunBuild: () => false,
      shouldRunMissionLoop: () => false,
      // Campaign pass spies
      isCampaignEnabled: () => true,
      shouldRunCampaignPass: () => true,
      campaignPass: async (p: string) => {
        campaignPassCalls.push(p);
        return { campaigns: [], results: [] };
      },
    };

    await runOrchestratorTick(deps);

    expect(campaignPassCalls).toEqual([project]);
  });

  it('skips the campaign pass inside its throttle window', async () => {
    const project = '/tmp/test-campaign-throttle';
    const campaignPassCalls: string[] = [];

    const deps: TickDeps = {
      listProjects: async () => [{ path: project }],
      getLevel: () => 'on',
      watchedProjects: () => new Set([project]),
      dirExists: () => true,
      listConfigured: () => [{ project, level: 'on' }],
      setLevel: () => {},
      loadTodos: () => [],
      // All other passes disabled
      shouldRunNotify: () => false,
      shouldRunFrictionWatch: () => false,
      shouldRunFrictionTriage: () => false,
      shouldRunBurnWatch: () => false,
      shouldRunMissionIntake: () => false,
      shouldRunRepairForge: () => false,
      shouldRunRepairVerifyFiler: () => false,
      shouldRunReconcile: () => false,
      shouldRunArchival: () => false,
      shouldRunLandedEpicSweep: () => false,
      shouldRunBuild: () => false,
      shouldRunMissionLoop: () => false,
      // Campaign pass spies: level on, but throttle gate off
      isCampaignEnabled: () => true,
      shouldRunCampaignPass: () => false,
      campaignPass: async (p: string) => {
        campaignPassCalls.push(p);
        return { campaigns: [], results: [] };
      },
    };

    await runOrchestratorTick(deps);

    expect(campaignPassCalls).toEqual([]);
  });

  it('skips the campaign pass when the project campaign level reads off', async () => {
    const project = '/tmp/test-campaign-level-off';
    const campaignPassCalls: string[] = [];
    let shouldRunCampaignPassCalls = 0;

    const deps: TickDeps = {
      listProjects: async () => [{ path: project }],
      getLevel: () => 'on',
      watchedProjects: () => new Set([project]),
      dirExists: () => true,
      listConfigured: () => [{ project, level: 'on' }],
      setLevel: () => {},
      loadTodos: () => [],
      // All other passes disabled
      shouldRunNotify: () => false,
      shouldRunFrictionWatch: () => false,
      shouldRunFrictionTriage: () => false,
      shouldRunBurnWatch: () => false,
      shouldRunMissionIntake: () => false,
      shouldRunRepairForge: () => false,
      shouldRunRepairVerifyFiler: () => false,
      shouldRunReconcile: () => false,
      shouldRunArchival: () => false,
      shouldRunLandedEpicSweep: () => false,
      shouldRunBuild: () => false,
      shouldRunMissionLoop: () => false,
      // Campaign pass spies: level off (this gate is evaluated BEFORE shouldRunCampaignPass)
      isCampaignEnabled: () => false,
      shouldRunCampaignPass: () => {
        // This counter proves the left-of-side-effect ordering: with the level off,
        // shouldRunCampaignPass must NEVER be called, so this counter stays 0.
        shouldRunCampaignPassCalls++;
        return true; // would pass if it were called
      },
      campaignPass: async (p: string) => {
        campaignPassCalls.push(p);
        return { campaigns: [], results: [] };
      },
    };

    await runOrchestratorTick(deps);

    // Both assertions must be true: the pass was never called, AND the throttle gate was never called.
    // Without the correct operand order, the throttle gate would be called and this counter would be > 0.
    expect(campaignPassCalls).toEqual([]);
    expect(shouldRunCampaignPassCalls).toBe(0);
  });
});
