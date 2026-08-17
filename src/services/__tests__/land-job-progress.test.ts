/**
 * Land job phase tracking: a job row carries an advancing phase and can never stay
 * running forever.
 *
 * Tests the protocol: phase is updated by landEpic's onPhase callback, sweep catches
 * stalled jobs, and updatedAt monotonically increases.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'land-job-progress-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic, type LandStageDeps } from '../coordinator-land';
import { createTodo, _closeProject, type Todo } from '../todo-store';
import { createEscalation, addWatchedProject, setProjectDigestEnabled, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { createJob, markJobRunning, getJob, sweepStalledJobs, JOB_STALL_TIMEOUT_MS, _resetAsyncJobDbCache, updateJobPhase } from '../async-job-store';
import type { EpicLandGateResult } from '../epic-land-gate';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

afterEach(() => {
  _resetAsyncJobDbCache();
});

const mockLand = {
  landed: true,
  masterSha: 'abc123',
  reason: 'ok',
  conflict: false,
  baseRef: 'master',
};

const mockEpicGateResult: EpicLandGateResult = {
  status: 'pass',
  declared: true,
  manifestPath: '',
  units: [],
  regressions: [],
  inherited: [],
  incidents: [],
  reasons: [],
  specFiles: [],
  epicTipSha: 'abc123',
  baseSha: 'def456',
};

function makeStubDeps(callOrder: string[], overrides?: Partial<LandStageDeps>): LandStageDeps {
  return {
    checkDirtyTree: async () => {
      callOrder.push('checkDirtyTree');
      return { ok: true, dirty: [] };
    },
    runStewardPrecheck: async () => {
      callOrder.push('runStewardPrecheck');
      return { ok: true, epic: null, epicChildIds: [] };
    },
    checkStaleness: async () => {
      callOrder.push('checkStaleness');
      return { ok: true };
    },
    runProofStage: async () => {
      callOrder.push('runProofStage');
      return { ok: true, proof: { ok: true, reason: 'ok', gate: mockEpicGateResult } };
    },
    checkOpenChildren: async () => {
      callOrder.push('checkOpenChildren');
      return { ok: true };
    },
    runMerge: async () => {
      callOrder.push('runMerge');
      return { ok: true, land: mockLand };
    },
    finalizeLandRecord: async () => {
      callOrder.push('finalizeLandRecord');
    },
    teardownEpic: async () => {
      callOrder.push('teardownEpic');
    },
    runPostLandGuard: async () => {
      callOrder.push('runPostLandGuard');
      return { ok: true, treeRestored: false };
    },
    ...(overrides ?? {}),
  } as LandStageDeps;
}

describe('land job phase tracking', () => {
  it('advances updatedAt with a phase while a land is still running', async () => {
    const project = mkdtempSync(join(tmpdir(), 'land-job-progress-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    _closeProject(project);

    // Avoid a real (network-bound) digest regeneration firing off the tail of a
    // successful landEpic — refreshProjectDigestOnLand defaults digest-enabled
    // to true for an unwatched project.
    addWatchedProject(project);
    setProjectDigestEnabled(project, false);

    const epic = (await createTodo(project, {
      allowOrphan: true,
      title: '[EPIC] phase-test',
      kind: 'epic',
      ownerSession: 'test-session',
    })) as Todo;

    const child = (await createTodo(project, {
      title: 'child work',
      parentId: epic.id,
      ownerSession: 'test-session',
    })) as Todo;

    // Create and start the job
    const job = createJob(project, { kind: 'land-epic', targetId: epic.id });
    markJobRunning(project, job.id);

    // Collect observations: the job row at each phase transition
    const observed: typeof getJob extends (...args: any) => infer R ? R[] : never = [];

    const deps = makeStubDeps([]);

    // Run landEpic with the onPhase hook that updates and records
    await landEpic(project, { epicId: epic.id }, { onPhase: (p) => {
      // Update the phase in the store
      const updated = updateJobPhase(project, job.id, p);
      // Record the observation
      observed.push(updated);
    } }, deps);

    // Assertions
    expect(observed.length).toBeGreaterThanOrEqual(2);

    // Check that phase differs between observations
    const phases = observed.map(obs => obs?.phase);
    const uniquePhases = new Set(phases);
    expect(uniquePhases.size).toBeGreaterThan(1);

    // Check that every observation has status='running' (land hasn't terminated them yet)
    for (const obs of observed) {
      if (obs) expect(obs.status).toBe('running');
    }

    // Check that updatedAt is strictly increasing
    let lastUpdatedAt = 0;
    for (const obs of observed) {
      if (obs) {
        expect(obs.updatedAt).toBeGreaterThan(lastUpdatedAt);
        lastUpdatedAt = obs.updatedAt;
      }
    }

    // Cleanup
    rmSync(project, { recursive: true, force: true });
  });

  it('always reaches a terminal status rather than remaining running indefinitely', async () => {
    const project = mkdtempSync(join(tmpdir(), 'land-job-stall-'));

    // Create and run a job
    const job = createJob(project, { kind: 'land-epic', targetId: 'epic-abc' });
    markJobRunning(project, job.id);

    const now = Date.now();

    // Sweep with a time far enough in the future to trigger the timeout
    const result = await sweepStalledJobs(project, { now: now + JOB_STALL_TIMEOUT_MS + 1000 });

    // Assert: the job was swept
    expect(result.swept.length).toBe(1);
    expect(result.swept[0]!.id).toBe(job.id);
    expect(result.swept[0]!.status).toBe('failed');
    expect(result.swept[0]!.error).toBeDefined();
    expect(result.swept[0]!.error).toMatch(/stalled after/);
    expect(result.swept[0]!.error).toMatch(/JOB_STALL_TIMEOUT_MS|1800000/); // 30 minutes in ms

    // Verify via getJob that the job is now failed
    const fetched = getJob(project, job.id);
    expect(fetched).toBeDefined();
    expect(fetched!.status).toBe('failed');

    // Cleanup
    rmSync(project, { recursive: true, force: true });
  });
});
