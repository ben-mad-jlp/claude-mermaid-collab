import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-planner-unlanded-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { planMissionCriterion, assertNoUnlandedDoneServingEpic, ServeIntegrityError } from '../mission-planner';
import { forgeMission } from '../mission-forge';
import { listCriteria, _resetMissionDbCache } from '../../../services/mission-store';
import { updateTodo, listTodos, _closeProject as closeTodos } from '../../../services/todo-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';
import type { UnlandedEpicArmDeps } from '../../../services/conductor-unlanded-epic-arm.js';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'mission-planner-unlanded-')); _resetMissionDbCache(project); });
afterEach(() => { _resetMissionDbCache(project); closeTodos(project); closeDecisions(project); rmSync(project, { recursive: true, force: true }); });

const EPIC_SPEC = {
  title: 'Harden the review-gate falsifiability heuristic',
  description: 'Make the doubt classifier clause-aware.',
  leaves: [
    { title: 'clause-split the doubt classifier', description: 'edit isNonFalsifiableReviewDoubt in leaf-executor.ts', files: ['src/services/leaf-executor.ts'] },
  ],
};
const mockInvoke = (spec: unknown = EPIC_SPEC) => async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(spec) + '\n```' } as any);

async function approvedMission() {
  const forged = await forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['doubt over a green gate abstains', 'a real defect still gates'] });
  const crits = listCriteria(project, forged.missionId);
  return { missionId: forged.missionId, criterionId: crits[0].id, secondId: crits[1].id };
}

/** Mark every descendant leaf of an epic done, then the epic itself — so the epic settles
 *  (status: 'done') without tripping the container-has-open-children guard. */
async function settleEpicDone(project: string, epicId: string) {
  const todos = listTodos(project, { includeCompleted: true });
  for (const t of todos) {
    if (t.parentId === epicId && t.status !== 'done' && t.status !== 'dropped') {
      await updateTodo(project, t.id, { status: 'done' });
    }
  }
  await updateTodo(project, epicId, { status: 'done' });
}

const NOT_LANDED_DEPS: UnlandedEpicArmDeps = {
  isEpicLandedInGit: async () => 'not-landed',
  detectTrunkBranch: async () => 'master',
};
const LANDED_DEPS: UnlandedEpicArmDeps = {
  isEpicLandedInGit: async () => 'landed',
  detectTrunkBranch: async () => 'master',
};

describe('planner refuses to re-serve a criterion whose done epic is merely unlanded', () => {
  test('refuses with code unlanded-done-epic when the settled serving epic probes not-landed', async () => {
    const { missionId, criterionId } = await approvedMission();

    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });
    await settleEpicDone(project, r1.epicId);

    let invoked = 0;
    let caught: unknown;
    try {
      await planMissionCriterion(
        project,
        { session: 's1', missionId, criterionIds: [criterionId] },
        { invoke: async () => { invoked++; return {} as any; }, unlandedArmDeps: NOT_LANDED_DEPS },
      );
      throw new Error('expected refusal');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ServeIntegrityError);
    const err = caught as ServeIntegrityError;
    expect(err.code).toBe('unlanded-done-epic');
    expect(err.servingEpicId).toBe(r1.epicId);
    expect(err.message).toMatch(/land/i);
    expect(invoked).toBe(0);

    const todos = listTodos(project, { includeCompleted: true });
    const epics = todos.filter((t) => t.kind === 'epic' && t.parentId === missionId);
    expect(epics.length).toBe(1);
  });

  test('proceeds when the git probe reports the serving epic landed', async () => {
    const { missionId, criterionId } = await approvedMission();

    const r1 = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });
    await settleEpicDone(project, r1.epicId);

    await expect(
      assertNoUnlandedDoneServingEpic(project, missionId, [criterionId], LANDED_DEPS),
    ).resolves.toBeUndefined();

    let caught: unknown;
    try {
      await planMissionCriterion(
        project,
        { session: 's1', missionId, criterionIds: [criterionId] },
        { invoke: mockInvoke(), unlandedArmDeps: LANDED_DEPS },
      );
    } catch (e) {
      caught = e;
    }
    if (caught) {
      expect((caught as ServeIntegrityError).code).not.toBe('unlanded-done-epic');
    }
  });

  test('proceeds when no settled serving epic exists', async () => {
    const { missionId, criterionId } = await approvedMission();
    let probed = 0;
    const deps: UnlandedEpicArmDeps = {
      isEpicLandedInGit: async () => { probed++; return 'not-landed'; },
      detectTrunkBranch: async () => 'master',
    };

    await expect(
      assertNoUnlandedDoneServingEpic(project, missionId, [criterionId], deps),
    ).resolves.toBeUndefined();
    expect(probed).toBe(0);
  });
});
