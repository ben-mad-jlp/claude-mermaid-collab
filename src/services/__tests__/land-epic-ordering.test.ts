/**
 * Drives landEpic end-to-end against a real seeded todo/escalation, stubbing every
 * LandStageDeps stage to record callOrder — proving the actual sequencer order
 * (coordinator-land.ts:1200-1252), not just that the interface shape exists.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'land-order-'));
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

describe('landEpic stage ordering — driven against real seeded todos', () => {
  let project: string;
  let epic: Todo;
  let child: Todo;
  let escalationId: string;
  let callOrder: string[];

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), 'land-order-repo-'));
    execFileSync('git', ['init'], { cwd: project });
    _closeProject(project);

    // Avoid a real (network-bound) digest regeneration firing off the tail of a
    // successful landEpic — refreshProjectDigestOnLand defaults digest-enabled
    // to true for an unwatched project.
    addWatchedProject(project);
    setProjectDigestEnabled(project, false);

    epic = (await createTodo(project, {
      allowOrphan: true,
      title: '[EPIC] land-order',
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
      session: 'test-session',
      kind: 'epic-ready-to-land',
      todoId: child.id,
      questionText: 'ready',
    });
    escalationId = escalation.id;

    callOrder = [];
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  it('happy path calls every stage exactly once, in the sequencer order', async () => {
    const stubDeps = makeStubDeps(callOrder);
    const outcome = await landEpic(project, escalationId, undefined, stubDeps);

    expect(callOrder).toEqual([
      'checkDirtyTree',
      'runStewardPrecheck',
      'checkStaleness',
      'runProofStage',
      'checkOpenChildren',
      'runMerge',
      'finalizeLandRecord',
      'teardownEpic',
      'runPostLandGuard',
    ]);
    expect(outcome.ok).toBe(true);
    expect(outcome.landed).toBe(true);
  });

  it('finalizeLandRecord always precedes teardownEpic', async () => {
    const stubDeps = makeStubDeps(callOrder);
    await landEpic(project, escalationId, undefined, stubDeps);

    expect(callOrder.indexOf('finalizeLandRecord')).toBeLessThan(callOrder.indexOf('teardownEpic'));
  });

  it('runPostLandGuard is the terminal stage', async () => {
    const stubDeps = makeStubDeps(callOrder);
    await landEpic(project, escalationId, undefined, stubDeps);

    expect(callOrder[callOrder.length - 1]).toBe('runPostLandGuard');
  });

  it('a not-ok runProofStage short-circuits before runMerge/finalize/teardown', async () => {
    const stubDeps = makeStubDeps(callOrder, {
      runProofStage: async () => {
        callOrder.push('runProofStage');
        return { ok: false, landed: false, reason: 'proof-failed', epicId: 'x', epicBranch: 'y' } as any;
      },
    });
    const outcome = await landEpic(project, escalationId, undefined, stubDeps);

    expect(callOrder).toEqual(['checkDirtyTree', 'runStewardPrecheck', 'checkStaleness', 'runProofStage']);
    expect(callOrder).not.toContain('runMerge');
    expect(callOrder).not.toContain('finalizeLandRecord');
    expect(callOrder).not.toContain('teardownEpic');
    expect(outcome.reason).toBe('proof-failed');
  });

  it('a not-ok checkStaleness short-circuits before the proof and merge stages', async () => {
    const stubDeps = makeStubDeps(callOrder, {
      checkStaleness: async () => {
        callOrder.push('checkStaleness');
        return { ok: false, landed: false, reason: 'stale', epicId: 'x', epicBranch: 'y' } as any;
      },
    });
    await landEpic(project, escalationId, undefined, stubDeps);

    expect(callOrder).toEqual(['checkDirtyTree', 'runStewardPrecheck', 'checkStaleness']);
    expect(callOrder).not.toContain('runProofStage');
    expect(callOrder).not.toContain('checkOpenChildren');
    expect(callOrder).not.toContain('runMerge');
    expect(callOrder).not.toContain('finalizeLandRecord');
    expect(callOrder).not.toContain('teardownEpic');
    expect(callOrder).not.toContain('runPostLandGuard');
  });
});
