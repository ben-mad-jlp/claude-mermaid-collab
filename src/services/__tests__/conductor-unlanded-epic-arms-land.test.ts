import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'unlanded-epic-arm-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { runConductorPass } from '../conductor-pass';
import { addWatchedProject, setConductorEnabled, listOpenEscalations } from '../supervisor-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { listCriteria, _resetMissionDbCache } from '../mission-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { createTodo, updateTodo, listTodos } from '../todo-store';
import { recordNode } from '../worker-ledger';
import { runUnlandedEpicLandArm, type UnlandedEpicArmDeps } from '../conductor-unlanded-epic-arm';

let project: string;

/** Fixture: a mission with a criterion served by a done epic that's not landed in git. */
async function forgeUnlandedDoneFixture(): Promise<{ missionId: string; epicId: string; critId: string }> {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Unlanded epic mission',
    criteria: ['criterion served by unlanded done epic'],
  });
  const crit = listCriteria(project, forged.missionId)[0];

  const epic = await createTodo(project, {
    ownerSession: 's1',
    title: '[EPIC] unlanded-done-epic',
    kind: 'epic',
    parentId: forged.missionId,
    servesCriterionIds: [crit.id],
  });

  // Create a child leaf, mark it done so the epic becomes done.
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

  // Mark the epic as done.
  await updateTodo(project, epic.id, { status: 'done' });

  return { missionId: forged.missionId, epicId: epic.id, critId: crit.id };
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'unlanded-epic-arm-'));
  _resetMissionDbCache(project);
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

describe('runUnlandedEpicLandArm', () => {
  test('arms the land path for a done-but-unlanded serving epic instead of a new epic', async () => {
    const { missionId, epicId, critId } = await forgeUnlandedDoneFixture();

    // Verify the criterion derives 'discover' before the pass.
    const beforeCriteria = listCriteria(project, missionId);
    expect(beforeCriteria[0].id).toBe(critId);

    // Count epics before the pass.
    const beforeEpics = listTodos(project, { includeCompleted: true }).filter(
      (t) => t.parentId === missionId && t.kind === 'epic',
    );
    const epicCountBefore = beforeEpics.length;

    // Capture wake-block actions to verify armed criteria are excluded.
    const capturedActions: Array<{ id: string; action: string }> = [];
    const buildWakeBlockSpy = (input: any) => {
      if (input.actions) {
        capturedActions.push(...input.actions);
      }
      return '';
    };

    // Run the conductor pass with stubbed git probe (epic is 'not-landed').
    const armDeps: UnlandedEpicArmDeps = {
      isEpicLandedInGit: async () => 'not-landed',
      detectTrunkBranch: async () => 'master',
    };

    let landArmCalls = 0;
    const result = await runConductorPass(project, {
      invoke: (async () => {
        throw new Error('conductor node should not be invoked; land arm should handle it');
      }) as any,
      buildWakeBlock: buildWakeBlockSpy,
      verifyPanelArm: (async () => ({ paneled: [], held: [], skipped: [] })) as any,
      landArm: (async () => {
        landArmCalls++;
        // The land arm finds and lands the epic we just carded
        return { landed: ['card-1'], skipped: [] };
      }) as any,
      unlandedEpicArm: (async (p: string, m: string, s: string) =>
        runUnlandedEpicLandArm(p, m, s, armDeps)) as any,
    });

    // Verify exactly one open `epic-ready-to-land` card with todoId === epicId.
    const cards = listOpenEscalations().filter((e) => e.project === project && e.kind === 'epic-ready-to-land');
    expect(cards).toHaveLength(1);
    expect(cards[0].todoId).toBe(epicId);

    // Verify the mission's epic-kind child count is the same.
    const afterEpics = listTodos(project, { includeCompleted: true }).filter(
      (t) => t.parentId === missionId && t.kind === 'epic',
    );
    expect(afterEpics.length).toBe(epicCountBefore);

    // Verify the armed criterion is not in the wake-block actions.
    const actionIds = capturedActions.map((a) => a.id);
    expect(actionIds).not.toContain(critId);
  });

  test('mints no card when the git land probe is indeterminate', async () => {
    const { missionId, epicId, critId } = await forgeUnlandedDoneFixture();

    const capturedActions: Array<{ id: string; action: string }> = [];
    const buildWakeBlockSpy = (input: any) => {
      if (input.actions) {
        capturedActions.push(...input.actions);
      }
      return '';
    };

    // Run the pass with git probe returning 'indeterminate'.
    const armDeps: UnlandedEpicArmDeps = {
      isEpicLandedInGit: async () => 'indeterminate',
      detectTrunkBranch: async () => 'master',
    };

    await runConductorPass(project, {
      invoke: (async () => {
        // The criterion is not armed, so the pass will still need a node. Return a no-op.
        return { ok: true, output: '', outputs: [] };
      }) as any,
      buildWakeBlock: buildWakeBlockSpy,
      verifyPanelArm: (async () => ({ paneled: [], held: [], skipped: [] })) as any,
      landArm: (async () => ({ landed: [], skipped: [] })) as any,
      unlandedEpicArm: (async (p: string, m: string, s: string) =>
        runUnlandedEpicLandArm(p, m, s, armDeps)) as any,
    });

    // Verify zero `epic-ready-to-land` escalations.
    const cards = listOpenEscalations().filter((e) => e.project === project && e.kind === 'epic-ready-to-land');
    expect(cards).toHaveLength(0);

    // Criterion should still be in the wake-block actions (not armed).
    const actionIds = capturedActions.map((a) => a.id);
    expect(actionIds).toContain(critId);
  });
});
