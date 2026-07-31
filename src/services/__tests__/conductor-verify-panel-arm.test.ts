import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'verify-panel-arm-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runVerifyPanelArm } from '../conductor-verify-panel-arm';
import { runConductorPass } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, listEscalations } from '../supervisor-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { listCriteria, setCriterionMet, _resetMissionDbCache } from '../mission-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { createTodo, updateTodo } from '../todo-store';
import { recordNode } from '../worker-ledger';
import { enqueueRecheck } from '../mission-store';
import { CONDUCTOR_VERIFY_BATCH_MAX } from '../harness-caps';

let project: string;
let invokeCalls: number;

const okInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'ok' } as any;
};

const mockPanelRunner = async (project: string, criterionId: string, _deps: any) => {
  invokeCalls++;
  // Return met verdict (all three lenses PASS by majority)
  return { skipped: undefined, hold: false, met: true, invocations: 3 };
};

const mockPanelRunnerNotMet = async (project: string, criterionId: string, _deps: any) => {
  invokeCalls++;
  // Return not-met verdict (majority FAIL)
  return { skipped: undefined, hold: false, met: false, invocations: 3 };
};

const mockPanelRunnerSkipped = async (project: string, criterionId: string, _deps: any) => {
  invokeCalls++;
  // Return skipped (unchanged-sha)
  return { skipped: 'unchanged-sha', hold: false, met: false, invocations: 0 };
};

const mockPanelRunnerThrow = async (project: string, criterionId: string, _deps: any) => {
  invokeCalls++;
  throw new Error('panel runner failed');
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'verify-panel-arm-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

describe('runVerifyPanelArm', () => {
  test('a stakes-routed criterion is paneled automatically by the pass', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Paneled verify',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    // Trigger high-stakes: enqueue a recheck (reopened-by-land)
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    // Create a serving epic so action === 'verify'
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'ready' });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      status: 'ready',
    });

    // Mark as landed so action === 'verify'
    await updateTodo(project, leaf.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    // Run the pass with mocked panel runner that returns met
    invokeCalls = 0;
    const r = await runConductorPass(project, {
      invoke: async () => { throw new Error('no node should be spawned'); },
      verifyPanelArm: async () => {
        // Mock: simulate that the panel ran and verdicts were recorded (paneled)
        return { paneled: [crit.id], held: [], skipped: [] };
      },
    });

    expect(r.ran).toBe(true);
    expect(r.reason).toBe('verify-paneled');
    expect(r.verifyPaneled).toBe(1);
    expect(r.verifyHeld).toBe(0);
    expect(invokeCalls).toBe(0); // Panel ran and returned early — node was NOT spawned
  });

  test('an infra-degraded panel result lands in skipped, not held', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Infra-degraded verify',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    invokeCalls = 0;
    const mockPanelRunnerInfraDegraded = async (project: string, criterionId: string, _deps: any) => {
      invokeCalls++;
      return { skipped: undefined, hold: true, met: false, invocations: 3, outcome: 'infra-degraded' as const };
    };

    const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
      runPanel: mockPanelRunnerInfraDegraded,
    });

    expect(result.skipped).toEqual([crit.id]);
    expect(result.held).toEqual([]);
    expect(result.paneled).toEqual([]);
  });

  test('a non-stakes criterion is still paneled, with N=1 lens', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Non-paneled verify',
      criteria: ['regular criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    // Create a serving epic so action === 'verify', but NO high-stakes trigger
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    // Run verify panel arm: the criterion is action=verify, panel===false (no high-stakes) —
    // still goes through the SAME plumbing with checkerCount===1, not skipped entirely.
    invokeCalls = 0;
    const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
      runPanel: mockPanelRunner,
    });

    expect(result.paneled).toEqual([crit.id]);
    expect(result.held).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(invokeCalls).toBe(1); // Panel runner IS called now (N=1 lens)
  });

  test('an arm fault degrades to a no-op pass', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Fault degradation',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    // Trigger high-stakes
    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'ready' });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      status: 'ready',
    });

    await updateTodo(project, leaf.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    // Panel arm throws: fail-open behavior → defaults to all empty arrays → falls through
    invokeCalls = 0;
    const r = await runConductorPass(project, {
      invoke: okInvoke, // Node will be called since arm fault defaults to all empty
      verifyPanelArm: async () => {
        throw new Error('arm fault');
      },
    });

    // The pass should NOT crash; arm fault is caught and execution continues
    expect(r.ran).toBe(true);
    // verifyPaneled/verifyHeld should be absent when arm faults (falls through)
    expect(r.verifyPaneled).toBeUndefined();
    expect(r.verifyHeld).toBeUndefined();
    // The node is called because arm fault defaults to all empty (no early return)
    expect(invokeCalls).toBe(1);
  });

  test('a panel run that yields only skipped falls through to normal pass logic', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Skipped paneled verify',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'ready' });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      status: 'ready',
    });

    await updateTodo(project, leaf.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    // Panel runner returns skipped (unchanged-sha): all empty → falls through to normal pass logic
    invokeCalls = 0;
    const r = await runConductorPass(project, {
      invoke: okInvoke, // Node will be called since all results are skipped
      verifyPanelArm: async () => {
        // All criteria skipped (unchanged-sha) → no paneled/held → no early return
        return { paneled: [], held: [], skipped: [crit.id] };
      },
    });

    // No early return from verify-paneled — falls through to normal pass (which tries to invoke)
    expect(r.reason).not.toBe('verify-paneled');
    expect(r.verifyPaneled).toBeUndefined();
    expect(invokeCalls).toBe(1); // Node is called because all results are skipped
  });

  test('a low-stakes verify criterion runs the panel with N=1 lens and never invokes the conductor node', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Low-stakes verify',
      criteria: ['regular criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    // No high-stakes trigger (no enqueueRecheck, no card, no serve-burn) → panel===false,
    // checkerCount===1.
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    let capturedLensCount: number | undefined;
    const spiedRunPanel = async (_p: string, _cid: string, deps: any) => {
      capturedLensCount = deps.lensCount;
      return { skipped: undefined, hold: false, met: true, invocations: deps.lensCount ?? 3 };
    };

    invokeCalls = 0;
    const nodeInvokeSpy = async () => { throw new Error('conductor node should never be invoked'); };

    const r = await runConductorPass(project, {
      invoke: nodeInvokeSpy,
      verifyPanelArm: async () => {
        const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
          runPanel: spiedRunPanel,
        });
        return result;
      },
    });

    expect(capturedLensCount).toBe(1);
    expect(r.ran).toBe(true);
    expect(r.verifyPaneled).toBe(1);
    expect(invokeCalls).toBe(0);
  });

  test('a high-stakes verify criterion still runs the full three-lens panel', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'High-stakes verify',
      criteria: ['high-stakes criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    enqueueRecheck(project, { criterionId: crit.id, todoId: forged.missionId, reason: 'land-diff-intersects-evidence', landedSha: 'abc123' });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    let capturedLensCount: number | undefined;
    const spiedRunPanel = async (_p: string, _cid: string, deps: any) => {
      capturedLensCount = deps.lensCount;
      return { skipped: undefined, hold: false, met: true, invocations: deps.lensCount ?? 3 };
    };

    const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
      runPanel: spiedRunPanel,
    });

    expect(capturedLensCount).toBe(3);
    expect(result.paneled).toEqual([crit.id]);
  });

  test('a degraded single-lens run lands in skipped, not held', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Degraded low-stakes verify',
      criteria: ['regular criterion'],
    });
    const crit = listCriteria(project, forged.missionId)[0];

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'the leaf',
      parentId: epic.id,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
    await updateTodo(project, epic.id, { status: 'done' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      leafOutcome: 'completed',
    });

    const mockPanelRunnerInfraDegradedN1 = async (_p: string, _cid: string, deps: any) => {
      expect(deps.lensCount).toBe(1);
      return { skipped: undefined, hold: true, met: false, invocations: 1, outcome: 'infra-degraded' as const };
    };

    const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
      runPanel: mockPanelRunnerInfraDegradedN1,
    });

    expect(result.skipped).toEqual([crit.id]);
    expect(result.held).toEqual([]);
    expect(result.paneled).toEqual([]);
  });

  test('bounds runPanel invocations to CONDUCTOR_VERIFY_BATCH_MAX and returns carried ids for the remainder', async () => {
    const criteriaTitles = Array.from({ length: CONDUCTOR_VERIFY_BATCH_MAX + 1 }, (_, i) => `verify criterion ${i}`);
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Batch-bounded verify',
      criteria: criteriaTitles,
    });
    const crits = listCriteria(project, forged.missionId);
    expect(crits.length).toBe(CONDUCTOR_VERIFY_BATCH_MAX + 1);

    for (const crit of crits) {
      const epic = await createTodo(project, {
        ownerSession: 's1',
        title: `[EPIC] serving epic for ${crit.id}`,
        kind: 'epic',
        parentId: forged.missionId,
        servesCriterionIds: [crit.id],
      });
      const leaf = await createTodo(project, {
        ownerSession: 's1',
        title: 'the leaf',
        parentId: epic.id,
        servesCriterionIds: [crit.id],
      });
      await updateTodo(project, leaf.id, { status: 'done', acceptanceStatus: 'accepted' });
      await updateTodo(project, epic.id, { status: 'done' });
      recordNode({
        project,
        todoId: leaf.id,
        epicId: epic.id,
        leafId: leaf.id,
        session: 's1',
        leafOutcome: 'completed',
      });
    }

    let panelCallCount = 0;
    const countingRunPanel = async (_p: string, _cid: string, _deps: any) => {
      panelCallCount++;
      return { skipped: undefined, hold: false, met: true, invocations: 1 };
    };

    const result = await runVerifyPanelArm(project, forged.missionId, 's1', {
      runPanel: countingRunPanel,
    });

    expect(panelCallCount).toBe(CONDUCTOR_VERIFY_BATCH_MAX);
    expect(result.carried).toEqual([crits[CONDUCTOR_VERIFY_BATCH_MAX].id]);
    expect(result.paneled.length + result.held.length + result.skipped.length).toBe(CONDUCTOR_VERIFY_BATCH_MAX);
  });
});
