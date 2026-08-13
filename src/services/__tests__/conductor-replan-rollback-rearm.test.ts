/**
 * conductor-replan-rollback-rearm — proves the discover-with-no-live-epic bypass detects
 * rolled-back deltas and re-arms the conductor even when the fingerprint is unchanged.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-replan-rollback-rearm-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass, type ConductorPassDeps } from '../conductor-pass';
import { CONDUCTOR_SERVE_RETRY_CAP } from '../harness-caps';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { _resetMissionDbCache, getMission, listCriteriaWithActions } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { setOrchestratorLevel } from '../orchestrator-config';
import { openPassRow, finalizePassRow } from '../conductor-pass-journal';
import { buildServeSignature, buildPassSignature } from '../conductor-signature';
import { createTodo, updateTodo } from '../todo-store';

let project: string;
let invokeCalls: number;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-replan-rollback-rearm-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

const tick = (over: ConductorPassDeps = {}) => runConductorPass(project, { invoke: emptyServeInvoke, ...over });

const emptyServeInvoke = async () => {
  invokeCalls++;
  return { ok: true, rateLimited: false, text: 'looked but did nothing' } as any;
};

describe('discover-with-no-live-epic debounce bypass', () => {
  test('a discover criterion with no live serving epic re-arms on an unchanged fingerprint', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Epic filed and dropped, then refiled',
      criteria: ['a measurement'],
    });
    const missionId = forged.missionId;

    // First pass: no serving epic exists yet, criterion derives 'discover', node runs and files
    // an epic (mocked as invoked but not really filed since we use emptyServeInvoke).
    const first = await tick();
    expect(first.reason).toBe('node-failed');
    expect(invokeCalls).toBe(1);

    // Compute the current fingerprint from the mission state. This is the key: a rolled-back
    // replan restores the exact same signature, so we'll seed the journal with this value.
    const mission = getMission(project, missionId)!;
    const status = mission.status!;
    const actions = listCriteriaWithActions(project, missionId).map((a) => ({
      action: a.action,
      id: a.id,
      rejectedParked: a.rejectedParkedCount,
    }));
    const serveFp = buildServeSignature({ status, actions, hardCardIds: [] });
    const fp = buildPassSignature(serveFp, []);

    // Seed the journal with a successful pass on this exact fingerprint (simulate a prior
    // productive pass with passFp === current fp).
    const startedAt = Date.now();
    const journalId = openPassRow(project, missionId, startedAt) as string;
    finalizePassRow(journalId, {
      endedAt: startedAt + 500,
      serveFp,
      passFp: fp,
      selfFp: fp,
      outcome: 'conducted',
      ran: true,
    });

    // Without the bypass, the next pass would debounce because the fingerprint hasn't changed.
    // But with the bypass, detect the unserved gap (discover + no live epic) and re-arm.
    const invokesBeforeRearm = invokeCalls;
    const second = await tick();
    expect(second.reason).not.toBe('debounced');
    // The bypass allows the serve path to run, so the invoke stub gets called.
    expect(invokeCalls).toBeGreaterThan(invokesBeforeRearm);
  });

  test('a criterion with a LIVE serving epic still debounces on an unchanged fingerprint', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Epic building',
      criteria: ['a measurement'],
    });
    const missionId = forged.missionId;

    // First pass: file an epic (mocked).
    const first = await tick();
    expect(first.reason).toBe('node-failed');

    // Get the criterion id so we can create a serving epic.
    const criteria = listCriteriaWithActions(project, missionId);
    expect(criteria.length).toBe(1);
    const criterionId = criteria[0].id;

    // Create a live epic under the mission that serves this criterion. A childless epic
    // created just now is live (within CHILDLESS_SERVE_GRACE_MS).
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] serving epic',
      parentId: missionId,
      kind: 'epic',
      servesCriterionIds: [criterionId],
    });

    // Recompute the fingerprint. Since the epic is now live (childless and just created),
    // the action should be 'building', not 'discover', changing the signature.
    _resetMissionDbCache(project);
    const mission = getMission(project, missionId)!;
    const status = mission.status!;
    const actions = listCriteriaWithActions(project, missionId).map((a) => ({
      action: a.action,
      id: a.id,
      rejectedParked: a.rejectedParkedCount,
    }));
    const serveFp = buildServeSignature({ status, actions, hardCardIds: [] });
    const fp = buildPassSignature(serveFp, []);

    // Verify the action changed to 'building' and the epic is live.
    const updated = listCriteriaWithActions(project, missionId)[0];
    expect(updated.action).toBe('building');
    expect(updated.servingEpicLive).toBe(true);

    // Seed the journal with a successful pass on this fingerprint.
    const startedAt = Date.now() + 1000;
    const journalId = openPassRow(project, missionId, startedAt) as string;
    finalizePassRow(journalId, {
      endedAt: startedAt + 500,
      serveFp,
      passFp: fp,
      selfFp: fp,
      outcome: 'conducted',
      ran: true,
    });

    // Now the next pass should debounce because there is NO unserved gap (the serving epic is
    // live).
    const invokesBeforeControl = invokeCalls;
    const control = await tick();
    expect(control.reason).toBe('debounced');
    expect(invokeCalls).toBe(invokesBeforeControl);
  });

  test('the bypass does not reach the serve retry cap: priorFails at CONDUCTOR_SERVE_RETRY_CAP still debounces', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Capped discover',
      criteria: ['a measurement'],
    });
    const missionId = forged.missionId;

    // First pass: get the serveFp.
    const first = await tick();
    expect(first.reason).toBe('node-failed');

    const mission = getMission(project, missionId)!;
    const status = mission.status!;
    const actions = listCriteriaWithActions(project, missionId).map((a) => ({
      action: a.action,
      id: a.id,
      rejectedParked: a.rejectedParkedCount,
    }));
    const serveFp = buildServeSignature({ status, actions, hardCardIds: [] });

    // Seed CONDUCTOR_SERVE_RETRY_CAP - 1 failed journal rows so the contiguous run reaches
    // CONDUCTOR_SERVE_RETRY_CAP (including the first real pass above).
    let startedAt = Date.now() + 1000;
    for (let i = 0; i < CONDUCTOR_SERVE_RETRY_CAP - 1; i++) {
      const id = openPassRow(project, missionId, startedAt) as string;
      finalizePassRow(id, {
        endedAt: startedAt + 500,
        serveFp,
        outcome: 'node-failed',
        ran: true,
      });
      startedAt += 1000;
    }

    // Even though there's an unserved gap (discover, no live epic), the priorFails >= cap
    // takes precedence and the pass debounces.
    const capped = await tick();
    expect(capped.reason).toBe('debounced');
  });

  test('a discover criterion whose OPEN serving epic is base-red still debounces', async () => {
    const forged = await forgeMission(project, {
      session: 's1',
      title: 'Base-red inert epic',
      criteria: ['a measurement'],
    });
    const missionId = forged.missionId;

    // First pass: no serving epic yet, criterion derives 'discover', node runs.
    const first = await tick();
    expect(first.reason).toBe('node-failed');
    expect(invokeCalls).toBe(1);

    // Get the criterion and create a live serving epic (childless = live by grace period).
    const criteria = listCriteriaWithActions(project, missionId);
    expect(criteria.length).toBe(1);
    const criterionId = criteria[0].id;

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] base-red but live',
      parentId: missionId,
      kind: 'epic',
      servesCriterionIds: [criterionId],
    });

    // Add one rejected leaf so the epic is 'open' (not 'landed').
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'rejected leaf',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, leaf.id, { acceptanceStatus: 'rejected' });

    // Recompute the fingerprint. Action is still 'discover' because the epic is not live
    // (has children, so grace period doesn't apply; no pending/in-progress runs yet).
    _resetMissionDbCache(project);
    const mission = getMission(project, missionId)!;
    const status = mission.status!;
    const actions = listCriteriaWithActions(project, missionId).map((a) => ({
      action: a.action,
      id: a.id,
      rejectedParked: a.rejectedParkedCount,
    }));
    const serveFp = buildServeSignature({ status, actions, hardCardIds: [] });
    const fp = buildPassSignature(serveFp, []);

    // Verify servingEpicState is 'open' and servingEpicLive is false.
    const updated = listCriteriaWithActions(project, missionId)[0];
    expect(updated.servingEpicState).toBe('open');
    expect(updated.servingEpicLive).toBe(false);
    expect(updated.action).toBe('discover');

    // Seed the journal with a successful pass on this fingerprint.
    const startedAt = Date.now() + 1000;
    const journalId = openPassRow(project, missionId, startedAt) as string;
    finalizePassRow(journalId, {
      endedAt: startedAt + 500,
      serveFp,
      passFp: fp,
      selfFp: fp,
      outcome: 'conducted',
      ran: true,
    });

    // The next pass should debounce because the serving epic is 'open' (not 'none').
    // The narrow bypass triggers only on 'none', so the fingerprint debounce applies.
    const invokesBeforeDebounce = invokeCalls;
    const debounced = await tick();
    expect(debounced.reason).toBe('debounced');
    expect(invokeCalls).toBe(invokesBeforeDebounce);
  });
});
