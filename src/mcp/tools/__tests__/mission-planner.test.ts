import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUP_DIR = mkdtempSync(join(tmpdir(), 'mission-planner-sup-'));
process.env.MERMAID_SUPERVISOR_DIR = SUP_DIR;

import { planMissionCriterion, parseEpicSpec, buildPlannerPrompt } from '../mission-planner';
import { forgeMission } from '../mission-forge';
import { listCriteria, _resetMissionDbCache } from '../../../services/mission-store';
import { getTodo, listTodos, deriveTodoViews, _closeProject as closeTodos } from '../../../services/todo-store';
import { _closeProject as closeDecisions } from '../../../services/decision-record-store';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'mission-planner-')); _resetMissionDbCache(project); });
afterEach(() => { _resetMissionDbCache(project); closeTodos(project); closeDecisions(project); rmSync(project, { recursive: true, force: true }); });

const EPIC_SPEC = {
  title: 'Harden the review-gate falsifiability heuristic',
  description: 'Make the doubt classifier clause-aware.',
  leaves: [
    { title: 'clause-split the doubt classifier', description: 'edit isNonFalsifiableReviewDoubt in leaf-executor.ts', files: ['src/services/leaf-executor.ts'] },
    { title: 'add regression tests', description: 'encode the mixed-finding cases', files: ['src/services/__tests__/leaf-executor.test.ts'], dependsOn: ['$0'] },
  ],
};
const mockInvoke = (spec: unknown = EPIC_SPEC) => async () => ({ ok: true, rateLimited: false, text: '```json\n' + JSON.stringify(spec) + '\n```' } as any);

async function approvedMission() {
  const forged = await forgeMission(project, { session: 's1', title: 'The reviewer never over-rejects', criteria: ['doubt over a green gate abstains', 'a real defect still gates'] });
  const crits = listCriteria(project, forged.missionId);
  return { missionId: forged.missionId, criterionId: crits[0].id, secondId: crits[1].id };
}

describe('planMissionCriterion — planner node → epic + leaves, ready', () => {
  test('creates a mission-homed epic serving the criteria, with READY leaves', async () => {
    const { missionId, criterionId } = await approvedMission();
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, { invoke: mockInvoke() });

    // Epic homed under the mission, serving the criterion.
    const epic = getTodo(project, r.epicId);
    expect(epic?.kind).toBe('epic');
    expect(epic?.parentId).toBe(missionId);
    expect(epic?.servesCriterionIds ?? []).toContain(criterionId);
    expect(r.modelUsed).toBe('opus');

    // Two work leaves created under the epic, promoted to READY (claimable by the daemon).
    expect(r.leafIds).toHaveLength(2);
    const views = deriveTodoViews(project, listTodos(project, { includeCompleted: true }));
    const leaves = views.filter((t) => r.leafIds.includes(t.id));
    expect(leaves.every((l) => l.parentId === r.epicId)).toBe(true);
    expect(leaves.every((l) => l.derivedStatus === 'ready' || l.derivedStatus === 'blocked')).toBe(true); // 2nd is dep-blocked until 1st
    // the second leaf depends on the first.
    const second = views.find((t) => t.id === r.leafIds[1]);
    expect(second?.dependsOn).toContain(r.leafIds[0]);
  });

  test('one epic can serve several criteria', async () => {
    const { missionId, criterionId, secondId } = await approvedMission();
    const r = await planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId, secondId] }, { invoke: mockInvoke() });
    const epic = getTodo(project, r.epicId);
    expect(epic?.servesCriterionIds ?? []).toEqual(expect.arrayContaining([criterionId, secondId]));
  });

  test('a planner node with no parseable spec throws (nothing created)', async () => {
    const { missionId, criterionId } = await approvedMission();
    await expect(
      planMissionCriterion(project, { session: 's1', missionId, criterionIds: [criterionId] }, {
        invoke: async () => ({ ok: true, rateLimited: false, text: 'I could not plan it' } as any),
      }),
    ).rejects.toThrow(/no parseable epic-spec JSON/i);
  });

  test('unknown criterionIds throw before spawning', async () => {
    const { missionId } = await approvedMission();
    let invoked = 0;
    await expect(
      planMissionCriterion(project, { session: 's1', missionId, criterionIds: ['nope'] }, { invoke: async () => { invoked++; return {} as any; } }),
    ).rejects.toThrow(/none of the criterionIds match/i);
    expect(invoked).toBe(0);
  });
});

describe('parseEpicSpec + buildPlannerPrompt (pure)', () => {
  test('parses a spec and requires title + at least one leaf', () => {
    const s = parseEpicSpec('```json\n{"title":"E","leaves":[{"title":"L1"},{"title":""}]}\n```');
    expect(s.title).toBe('E');
    expect(s.leaves).toHaveLength(1);
    expect(() => parseEpicSpec('{"title":"E","leaves":[]}')).toThrow(/no leaves/i);
    expect(() => parseEpicSpec('{"leaves":[{"title":"L"}]}')).toThrow(/title/i);
  });
  test('prompt lists the criteria and forbids creating/editing', () => {
    const p = buildPlannerPrompt('/proj', 'm1', [{ id: 'c1', text: 'the thing works' }]);
    expect(p).toContain('c1');
    expect(p).toContain('the thing works');
    expect(p).toContain('Do NOT create anything');
  });
});
