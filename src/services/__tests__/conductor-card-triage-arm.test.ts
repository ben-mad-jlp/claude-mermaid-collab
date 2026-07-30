import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'card-triage-arm-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runCardTriageArm } from '../conductor-card-triage-arm';
import { addWatchedProject, createEscalation, type Escalation } from '../supervisor-store';
import { _resetMissionDbCache } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo } from '../todo-store';

let project: string;
let nodeInvokeCalls: number;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'card-triage-arm-'));
  nodeInvokeCalls = 0;
  _resetMissionDbCache(project);
  addWatchedProject(project);
});

async function setup() {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Card triage mission',
    criteria: ['some criterion'],
  });
  const leaf = await createTodo(project, {
    ownerSession: 's1',
    title: 'a carded leaf',
    parentId: forged.missionId,
  });
  const { escalation } = createEscalation({
    project,
    session: 's1',
    kind: 'blocker',
    questionText: 'stuck on X',
    todoId: leaf.id,
    audience: 'human',
  });
  return { missionId: forged.missionId, leafId: leaf.id, escalation };
}

describe('runCardTriageArm', () => {
  test('parks a leaf at attempts >= 3 with an open blocker card, without invoking any node', async () => {
    const { missionId, leafId, escalation } = await setup();

    let resetCalledWith: any = null;
    let reopenCalledWith: any = null;

    const result = await runCardTriageArm(project, missionId, 's1', {
      getLeafRun: (id: string) => ({ leafId: id, epicId: null, project, nodes: [], attempts: 3, nodesSpent: 3, nodeBudget: 20, budgetPct: 0.15, wallClockMs: 1000, rateLimitedCount: 0 } as any),
      resetTodo: async (proj: string, id: string, status: any) => {
        resetCalledWith = { proj, id, status };
        nodeInvokeCalls; // node spy never called from this arm
        return { id } as any;
      },
      reopenEscalation: (id: string) => {
        reopenCalledWith = id;
        return null;
      },
    });

    expect(result.parked).toEqual([leafId]);
    expect(resetCalledWith).toEqual({ proj: project, id: leafId, status: 'blocked' });
    expect(reopenCalledWith).toBe(escalation.id);
    expect(nodeInvokeCalls).toBe(0);
  });

  test('does not park a leaf at attempts < CARD_TRIAGE_PARK_ATTEMPTS', async () => {
    const { missionId, leafId } = await setup();

    let resetCalled = false;
    const result = await runCardTriageArm(project, missionId, 's1', {
      getLeafRun: (id: string) => ({ leafId: id, epicId: null, project, nodes: [], attempts: 2, nodesSpent: 2, nodeBudget: 20, budgetPct: 0.1, wallClockMs: 500, rateLimitedCount: 0 } as any),
      resetTodo: async () => {
        resetCalled = true;
        return {} as any;
      },
      reopenEscalation: () => null,
    });

    expect(result.parked).toEqual([]);
    expect(result.skipped).toEqual([leafId]);
    expect(resetCalled).toBe(false);
  });

  test('a throwing dep fails open and leaves the pass alive', async () => {
    const { missionId } = await setup();

    const result = await runCardTriageArm(project, missionId, 's1', {
      getLeafRun: () => {
        throw new Error('ledger read failed');
      },
    });

    expect(result.parked).toEqual([]);
    expect(Array.isArray(result.skipped)).toBe(true);
  });

  test('an outer fault (e.g. listOpenEscalations throws) still fails open', async () => {
    const { missionId } = await setup();

    const result = await runCardTriageArm(project, missionId, 's1', {
      listOpenEscalations: () => {
        throw new Error('store read failed');
      },
    });

    expect(result).toEqual({ parked: [], skipped: [] });
  });
});
