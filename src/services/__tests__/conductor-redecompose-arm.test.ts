import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stable supervisor dir (criterion_approach store + worker-ledger live there)
const SUP_DIR = mkdtempSync(join(tmpdir(), 'conductor-redecompose-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import {
  runRedecomposeArm,
  findServingEpicForCriterion,
  type RedecomposeArmDeps,
} from '../conductor-redecompose-arm';
import { _resetMissionDbCache, listCriteria, listCriteriaWithActions, getMission, getMissionRollup } from '../mission-store';
import { forgeMission } from '../../mcp/tools/mission-forge';
import { createTodo, updateTodo, listTodos } from '../todo-store';
import { setOrchestratorLevel } from '../orchestrator-config';
import { addWatchedProject, setConductorEnabled } from '../supervisor-store';
import { recordNode } from '../worker-ledger';
import { _closeApproachDb } from '../criterion-approach-store';
import { EPIC_CHURN_REJECT_THRESHOLD } from '../harness-caps';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'conductor-redecompose-'));
  _resetMissionDbCache(project);
  _closeApproachDb();
  addWatchedProject(project);
  setConductorEnabled(project, true);
  setOrchestratorLevel(project, 'on');
});

/** Forge an approved+active mission with ONE serving epic. */
async function seedMission() {
  const forged = await forgeMission(project, {
    session: 's1',
    title: 'Test mission',
    criteria: ['criterion 1', 'criterion 2'],
  });
  const criteria = listCriteria(project, forged.missionId);
  return { forged, criteria };
}

/** Create a serving epic for a criterion with N rejected + M accepted leaves, recording runs. */
async function createServingEpicWithRuns(
  missionId: string,
  criterionId: string,
  rejectedCount: number,
  acceptedCount: number,
) {
  const epic = await createTodo(project, {
    ownerSession: 's1',
    title: '[EPIC] serving epic',
    kind: 'epic',
    parentId: missionId,
    servesCriterionIds: [criterionId],
  });
  await updateTodo(project, epic.id, { status: 'ready' });

  // Record rejected runs
  for (let i = 0; i < rejectedCount; i++) {
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: `rejected leaf ${i}`,
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, leaf.id, { acceptanceStatus: 'rejected' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      nodeKind: 'outcome',
      nodesSpent: 0,
      leafOutcome: 'rejected',
      outcomeDetail: JSON.stringify({ reason: `test rejection ${i}` }),
    });
  }

  // Record accepted runs
  for (let i = 0; i < acceptedCount; i++) {
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: `accepted leaf ${i}`,
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, leaf.id, { acceptanceStatus: 'accepted' });
    recordNode({
      project,
      todoId: leaf.id,
      epicId: epic.id,
      leafId: leaf.id,
      session: 's1',
      nodeKind: 'outcome',
      nodesSpent: 0,
      leafOutcome: 'accepted',
      outcomeDetail: JSON.stringify({ reason: null }),
    });
  }

  return epic;
}

describe('findServingEpicForCriterion', () => {
  test('returns the newest epic serving a criterion', async () => {
    const { forged, criteria } = await seedMission();
    const crit = criteria[0];

    const epic1 = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] old epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });

    // Small delay to ensure createdAt differs
    await new Promise((r) => setTimeout(r, 10));

    const epic2 = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] newer epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });

    const todos = listTodos(project, { includeCompleted: true });
    const found = findServingEpicForCriterion(todos, forged.missionId, crit.id);
    expect(found?.id).toBe(epic2.id);
  });

  test('skips dropped epics', async () => {
    const { forged, criteria } = await seedMission();
    const crit = criteria[0];

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] epic',
      kind: 'epic',
      parentId: forged.missionId,
      servesCriterionIds: [crit.id],
    });
    await updateTodo(project, epic.id, { status: 'dropped' });

    const todos = listTodos(project, { includeCompleted: true });
    const found = findServingEpicForCriterion(todos, forged.missionId, crit.id);
    expect(found).toBeUndefined();
  });
});

describe('runRedecomposeArm', () => {
  test('churning epic triggers one plan with decompositionHint and drops the epic', async () => {
    const { forged, criteria } = await seedMission();
    const crit = criteria[0];
    const rejectedThreshold = EPIC_CHURN_REJECT_THRESHOLD;

    const epic = await createServingEpicWithRuns(
      forged.missionId,
      crit.id,
      rejectedThreshold, // >= threshold to churn
      0,
    );

    const planCalls: any[] = [];
    const updateCalls: any[] = [];

    const deps: RedecomposeArmDeps = {
      planMissionCriterion: async (project, opts) => {
        planCalls.push({ project, opts });
      },
      updateTodo: async (project, id, patch) => {
        updateCalls.push({ project, id, patch });
        return updateTodo(project, id, patch);
      },
    };

    const result = await runRedecomposeArm(project, forged.missionId, 's1', deps);

    expect(result.redecomposed).toContain(crit.id);
    expect(planCalls.length).toBe(1);
    expect(planCalls[0].opts.criterionIds).toEqual([crit.id]);
    expect(planCalls[0].opts.decompositionHint).toBeTruthy();
    expect(planCalls[0].opts.decompositionHint).toContain('smaller');

    const updateDropCall = updateCalls.find((c) => c.id === epic.id);
    expect(updateDropCall?.patch.status).toBe('dropped');
  });

  test('re-running with identical state does not re-plan (hasAttemptedRung gate)', async () => {
    const { forged, criteria } = await seedMission();
    const crit = criteria[0];
    const rejectedThreshold = EPIC_CHURN_REJECT_THRESHOLD;

    const epic = await createServingEpicWithRuns(
      forged.missionId,
      crit.id,
      rejectedThreshold,
      0,
    );

    let planCallCount = 0;

    const deps: RedecomposeArmDeps = {
      planMissionCriterion: async (project, opts) => {
        planCallCount++;
        // Create a replacement epic with churning runs so it remains actionable for the second run
        if (opts.criterionIds?.includes(crit.id)) {
          await createServingEpicWithRuns(
            forged.missionId,
            crit.id,
            rejectedThreshold,
            0, // also churning
          );
        }
      },
      updateTodo: updateTodo,
    };

    const result1 = await runRedecomposeArm(project, forged.missionId, 's1', deps);
    expect(result1.redecomposed).toContain(crit.id);
    expect(planCallCount).toBe(1);

    // Re-run with identical state. The replacement epic is also churning, so it would normally
    // trigger re-decompose again. However, hasAttemptedRung gates it before that check.
    const result2 = await runRedecomposeArm(project, forged.missionId, 's1', deps);
    expect(result2.skipped.some((s) => s.why === 'rung-already-attempted')).toBe(true);
    expect(planCallCount).toBe(1); // Still 1, not incremented
  });

  test('epic with accepted run is not churning (no-op)', async () => {
    const { forged, criteria } = await seedMission();
    const crit = criteria[0];
    const rejectedThreshold = EPIC_CHURN_REJECT_THRESHOLD;

    await createServingEpicWithRuns(
      forged.missionId,
      crit.id,
      rejectedThreshold, // >= threshold but...
      1, // ...has 1 accepted run, so not churning
    );

    let planCallCount = 0;

    const deps: RedecomposeArmDeps = {
      planMissionCriterion: async () => {
        planCallCount++;
      },
    };

    const result = await runRedecomposeArm(project, forged.missionId, 's1', deps);

    expect(result.redecomposed).toHaveLength(0);
    expect(result.skipped.some((s) => s.why === 'not-churning')).toBe(true);
    expect(planCallCount).toBe(0);
  });

  test('servedEpicCount increments after drop-and-re-serve', async () => {
    const { forged, criteria } = await seedMission();
    const crit = criteria[0];
    const rejectedThreshold = EPIC_CHURN_REJECT_THRESHOLD;

    // Create first serving epic with churn
    const epic1 = await createServingEpicWithRuns(
      forged.missionId,
      crit.id,
      rejectedThreshold,
      0,
    );

    // Check servedEpicCount before (use listCriteriaWithActions which includes servedEpicCount)
    const critsBefore = listCriteriaWithActions(project, forged.missionId);
    const countBefore = critsBefore.find((c) => c.id === crit.id)?.servedEpicCount ?? 0;

    // Run the arm with a mocked planner that creates a replacement epic
    const deps: RedecomposeArmDeps = {
      planMissionCriterion: async (project, opts) => {
        // Simulate planner creating a new serving epic
        if (opts.criterionIds?.includes(crit.id)) {
          await createTodo(project, {
            ownerSession: 's1',
            title: '[EPIC] replacement epic (redecomposed)',
            kind: 'epic',
            parentId: opts.missionId ?? forged.missionId,
            servesCriterionIds: [crit.id],
          });
        }
      },
      updateTodo: updateTodo,
    };

    await runRedecomposeArm(project, forged.missionId, 's1', deps);

    // Check servedEpicCount after
    const critsAfter = listCriteriaWithActions(project, forged.missionId);
    const countAfter = critsAfter.find((c) => c.id === crit.id)?.servedEpicCount ?? 0;

    // The dropped epic + the new epic both count (dropped epics are NOT excluded)
    expect(countAfter).toBe(countBefore + 1);
  });
});
