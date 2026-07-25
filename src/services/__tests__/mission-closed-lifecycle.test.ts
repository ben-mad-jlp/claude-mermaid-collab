import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetMissionDbCache,
  upsertMission,
  addCriterion,
  setCriterionVerdict,
  listCriteria,
  unverifyCriteriaForLandedPaths,
  listPendingRechecks,
  getMission,
  isMissionTerminal,
  deactivateIfTerminal,
} from '../mission-store';
import { createTodo, _closeProject } from '../todo-store';

describe('mission closed lifecycle', () => {
  let projectDir: string;
  let projectId: string;
  let closedMissionTodoId: string;
  let liveMissionTodoId: string;
  let closedCriterionId: string;
  let liveCriterionId: string;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'mission-closed-lifecycle-test-'));
    projectId = projectDir;
    process.env.MERMAID_SUPERVISOR_DIR = projectDir;
    _resetMissionDbCache();

    // CLOSED mission: single criterion, met + verified against a shared evidence path —
    // the only criterion, so setCriterionVerdict flips the mission to converged and
    // deactivateIfTerminal stamps closedAt.
    const closedNode = await createTodo(projectId, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] Closed Mission',
      kind: 'mission',
    });
    closedMissionTodoId = closedNode.id;
    upsertMission(projectId, closedMissionTodoId);
    const closedCriterion = addCriterion(projectId, closedMissionTodoId, 'closed criterion');
    closedCriterionId = closedCriterion.id;
    setCriterionVerdict(projectId, closedCriterionId, {
      met: true,
      evidence: 'closed evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'sha-closed',
      evidencePaths: ['src/shared.ts'],
    });

    // LIVE mission: two criteria, one met against the SAME shared evidence path, one
    // unmet — keeps the mission non-terminal (active, status !== 'converged').
    const liveNode = await createTodo(projectId, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] Live Mission',
      kind: 'mission',
    });
    liveMissionTodoId = liveNode.id;
    upsertMission(projectId, liveMissionTodoId);
    const liveCriterion = addCriterion(projectId, liveMissionTodoId, 'live criterion');
    liveCriterionId = liveCriterion.id;
    // Add the unmet gap BEFORE meeting the first criterion — otherwise the mission
    // briefly reads converged (single met criterion) and setCriterionVerdict's
    // deactivateIfTerminal call stamps closedAt before the second criterion exists.
    addCriterion(projectId, liveMissionTodoId, 'unmet gap');
    setCriterionVerdict(projectId, liveCriterionId, {
      met: true,
      evidence: 'live evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'sha-live',
      evidencePaths: ['src/shared.ts'],
    });
  });

  afterEach(() => {
    _closeProject(projectId);
    _resetMissionDbCache(projectId);
    delete process.env.MERMAID_SUPERVISOR_DIR;
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  test('the single-criterion mission closes and freezes terminality', () => {
    const closed = getMission(projectId, closedMissionTodoId);
    expect(closed?.closedAt).not.toBeNull();
    expect(typeof closed?.closedAt).toBe('number');
    expect(closed?.status).toBe('closed');
    expect(isMissionTerminal(closed!)).toBe(true);

    const before = getMission(projectId, closedMissionTodoId)!.closedAt;
    deactivateIfTerminal(projectId, closedMissionTodoId);
    const after = getMission(projectId, closedMissionTodoId)!.closedAt;
    expect(after).toBe(before);
  });

  test('the two-criterion mission with an unmet gap stays live', () => {
    const live = getMission(projectId, liveMissionTodoId);
    expect(live?.closedAt).toBeNull();
    expect(live?.status).not.toBe('converged');
    expect(live?.status).not.toBe('closed');
    expect(isMissionTerminal(live!)).toBe(false);
  });

  test('unverifyCriteriaForLandedPaths skips the closed mission and only affects the live one', () => {
    const affected = unverifyCriteriaForLandedPaths(projectId, ['src/shared.ts']);

    expect(affected).toHaveLength(1);
    expect(affected[0]?.criterionId).toBe(liveCriterionId);
    expect(affected[0]?.todoId).toBe(liveMissionTodoId);

    // Closed mission's criterion is untouched.
    const closedCriteria = listCriteria(projectId, closedMissionTodoId);
    const closedTarget = closedCriteria.find((c) => c.id === closedCriterionId);
    expect(closedTarget?.met).toBe(true);
    expect(closedTarget?.verifiedAt).not.toBeNull();

    // Live mission's criterion is un-verified.
    const liveCriteria = listCriteria(projectId, liveMissionTodoId);
    const liveTarget = liveCriteria.find((c) => c.id === liveCriterionId);
    expect(liveTarget?.met).toBe(false);
    expect(liveTarget?.verifiedAt).toBeNull();

    // No recheck enqueued for the closed mission's criterion.
    const rechecks = listPendingRechecks(projectId);
    expect(rechecks.some((r) => r.criterionId === closedCriterionId)).toBe(false);
    expect(rechecks.some((r) => r.criterionId === liveCriterionId)).toBe(true);
  });
});
