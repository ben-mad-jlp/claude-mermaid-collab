import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'land-arm-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorLandArm, type LandArmDeps } from '../conductor-land-arm';
import { runConductorPass } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { listCriteria, _resetMissionDbCache } from '../mission-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { createTodo, updateTodo } from '../todo-store';
import { recordNode } from '../worker-ledger';
import { enqueueRecheck } from '../mission-store';

let project: string;
let invokeCalls: number;

const CARD_ID = 'card-land-1';

/** A green land-ready fixture: mission → serving epic (with a done leaf so the criterion's
 *  action is `verify`) → an open `epic-ready-to-land` card pointing at the epic. */
async function forgeLandReadyFixture(): Promise<{ missionId: string; epicId: string; critId: string }> {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Landable mission',
    criteria: ['the criterion this epic serves'],
  });
  const crit = listCriteria(project, forged.missionId)[0];
  enqueueRecheck(project, {
    criterionId: crit.id,
    todoId: forged.missionId,
    reason: 'land-diff-intersects-evidence',
    landedSha: 'abc123',
  });
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
  return { missionId: forged.missionId, epicId: epic.id, critId: crit.id };
}

function landCard(epicId: string): any[] {
  return [{ id: CARD_ID, project, status: 'open', kind: 'epic-ready-to-land', todoId: epicId }];
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'land-arm-'));
  invokeCalls = 0;
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

describe('runConductorLandArm', () => {
  test('a green land-ready card lands with zero conductor-node invocations', async () => {
    const { missionId, epicId, critId } = await forgeLandReadyFixture();

    const landCalls: string[] = [];
    const armDeps: LandArmDeps = {
      listOpenEscalations: (() => landCard(epicId)) as any,
      checkOwnership: (() => ({ ok: true, ownership: 'owned' })) as any,
      landReadiness: (async () => ({ green: true, blockers: [] })) as any,
      listCriteriaWithActions: (() => [{ id: critId, verifiedAt: 1700000000000 }]) as any,
      landEpic: (async (_p: string, escalationId: string) => {
        landCalls.push(escalationId);
        return { ok: true, landed: true };
      }) as any,
    };

    const r = await runConductorPass(project, {
      invoke: async () => {
        invokeCalls++;
        throw new Error('no node should be spawned');
      },
      verifyPanelArm: (async () => ({ paneled: [], held: [], skipped: [] })) as any,
      landArm: ((p: string, m: string, s: string) => runConductorLandArm(p, m, s, armDeps)) as any,
    });

    expect(r.ran).toBe(true);
    expect(r.reason).toBe('landed');
    expect(r.missionId).toBe(missionId);
    expect(landCalls).toEqual([CARD_ID]);
    expect(invokeCalls).toBe(0);
  });

  test('a blocked readiness verdict lands nothing and leaves the card open', async () => {
    const { missionId, epicId, critId } = await forgeLandReadyFixture();

    const landCalls: string[] = [];
    const result = await runConductorLandArm(project, missionId, 's1', {
      listOpenEscalations: (() => landCard(epicId)) as any,
      checkOwnership: (() => ({ ok: true, ownership: 'owned' })) as any,
      landReadiness: (async () => ({
        green: false,
        blockers: [{ code: 'gate-failed', message: 'base gate red' }],
      })) as any,
      listCriteriaWithActions: (() => [{ id: critId, verifiedAt: 1700000000000 }]) as any,
      landEpic: (async (_p: string, escalationId: string) => {
        landCalls.push(escalationId);
        return { ok: true, landed: true };
      }) as any,
    });

    expect(result.landed).toEqual([]);
    expect(result.skipped).toContain(CARD_ID);
    expect(landCalls).toEqual([]);
  });

  test('a missing criterion verdict lands nothing and leaves the card open', async () => {
    const { missionId, epicId, critId } = await forgeLandReadyFixture();

    const landCalls: string[] = [];
    const result = await runConductorLandArm(project, missionId, 's1', {
      listOpenEscalations: (() => landCard(epicId)) as any,
      checkOwnership: (() => ({ ok: true, ownership: 'owned' })) as any,
      landReadiness: (async () => ({ green: true, blockers: [] })) as any,
      // The served criterion carries NO recorded verdict.
      listCriteriaWithActions: (() => [{ id: critId, verifiedAt: null }]) as any,
      landEpic: (async (_p: string, escalationId: string) => {
        landCalls.push(escalationId);
        return { ok: true, landed: true };
      }) as any,
    });

    expect(result.landed).toEqual([]);
    expect(result.skipped).toContain(CARD_ID);
    expect(landCalls).toEqual([]);
  });
});
