/**
 * Verifies that the post-land test sweep is wired into landEpic's post-merge
 * advisory block and never blocks a completed land, even if it rejects.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'post-land-sweep-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { landEpic, type LandStageDeps } from '../coordinator-land';
import { createTodo, _closeProject, type Todo } from '../todo-store';
import { createEscalation, addWatchedProject, setProjectDigestEnabled, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import type { EpicLandGateResult } from '../epic-land-gate';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

const mockLand = {
  landed: true,
  masterSha: 'abc123',
  reason: 'ok',
  conflict: false,
  baseRef: 'master',
  landedPaths: [],
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

interface SweepCall {
  project: string;
  ctx: { epicId: string; landSha: string; targetProject?: string };
}

function makeStubDeps(sweepCalls: SweepCall[], overrides?: Partial<LandStageDeps>): LandStageDeps {
  return {
    checkDirtyTree: async () => {
      return { ok: true, dirty: [] };
    },
    runStewardPrecheck: async () => {
      return { ok: true, epic: null, epicChildIds: [] };
    },
    checkStaleness: async () => {
      return { ok: true };
    },
    runProofStage: async () => {
      return { ok: true, proof: { ok: true, reason: 'ok', gate: mockEpicGateResult } };
    },
    checkOpenChildren: async () => {
      return { ok: true };
    },
    runMerge: async () => {
      return { ok: true, land: mockLand };
    },
    finalizeLandRecord: async () => {
      // no-op
    },
    teardownEpic: async () => {
      // no-op
    },
    runPostLandGuard: async () => {
      return { ok: true, treeRestored: false };
    },
    runPostLandTestSweep: async (project: string, ctx: { epicId: string; landSha: string; targetProject?: string }) => {
      sweepCalls.push({ project, ctx });
      return { filed: [], skipped: [] };
    },
    ...(overrides ?? {}),
  } as LandStageDeps;
}

describe('post-land test sweep wiring', () => {
  let project: string;
  let epic: Todo;
  let child: Todo;
  let escalationId: string;

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), 'post-land-sweep-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    _closeProject(project);

    // Avoid a real (network-bound) digest regeneration firing off the tail of a
    // successful landEpic — refreshProjectDigestOnLand defaults digest-enabled
    // to true for an unwatched project.
    addWatchedProject(project);
    setProjectDigestEnabled(project, false);

    epic = (await createTodo(project, {
      allowOrphan: true,
      title: '[EPIC] post-land-sweep-test',
      kind: 'epic',
      ownerSession: 'test-session',
    })) as Todo;

    child = (await createTodo(project, {
      title: 'child work',
      parentId: epic.id,
      ownerSession: 'test-session',
    })) as Todo;

    const { escalation } = createEscalation({
      project,
      audience: 'internal',
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: child.id,
      questionText: 'ready',
    });
    escalationId = escalation.id;
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('calls runPostLandTestSweep exactly once with the landed epicId and merge sha', async () => {
    const sweepCalls: SweepCall[] = [];
    const stubDeps = makeStubDeps(sweepCalls);
    const outcome = await landEpic(project, escalationId, undefined, stubDeps);

    expect(outcome.ok).toBe(true);
    expect(outcome.landed).toBe(true);

    expect(sweepCalls.length).toBe(1);
    expect(sweepCalls[0].project).toBe(project);
    expect(sweepCalls[0].ctx.epicId).toBe(epic.id);
    expect(sweepCalls[0].ctx.landSha).toBe('abc123');
    expect(sweepCalls[0].ctx.targetProject).toBe(project);
  });

  it('still lands ok when runPostLandTestSweep rejects', async () => {
    const sweepCalls: SweepCall[] = [];
    const stubDeps = makeStubDeps(sweepCalls, {
      runPostLandTestSweep: async () => {
        sweepCalls.push({ project, ctx: { epicId: '', landSha: '' } });
        throw new Error('sweep failed');
      },
    });
    const outcome = await landEpic(project, escalationId, undefined, stubDeps);

    expect(outcome.ok).toBe(true);
    expect(outcome.landed).toBe(true);
    expect(sweepCalls.length).toBe(1);
  });
});
