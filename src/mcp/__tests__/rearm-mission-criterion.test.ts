import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addCriterion, reArmCriterion, listCriteria, setCriterionVerdict,
  bumpCriterionServeAttempt, bumpCriterionVerifyAttempt, listCriterionVerdictHistory,
  _resetMissionDbCache,
} from '../../services/mission-store.js';
import { handleMissionTool } from '../mission-tools.js';
import { listSupervisorAudit, _closeDb as closeSupervisorDb } from '../../services/supervisor-store.js';
import { _closeProject } from '../../services/todo-store.js';
import { CRITERION_SERVE_ATTEMPT_CAP, CRITERION_VERIFY_ATTEMPT_CAP } from '../../services/harness-caps.js';

let project: string;
const session = 'test-session-123';
let missionTodoId: string;
let criterionId: string;

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'rearm-mission-criterion-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;

  // Import addSessionTodo to create a mission node
  const { addSessionTodo } = await import('../tools/session-todos.js');
  const missionNode = await addSessionTodo(project, session, 'Test Mission', undefined, { kind: 'mission' });
  missionTodoId = missionNode.id;

  // Add a criterion to the mission
  const crit = addCriterion(project, missionTodoId, 'Test Criterion');
  criterionId = crit.id;
});

afterEach(() => {
  _resetMissionDbCache(project);
  _closeProject(project);
  closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('rearm_mission_criterion', () => {
  test('clears exhausted serve/verify attempt counters and preserves text/evidence/evidencePaths/history', async () => {
    // Exhaust the serve cap
    for (let i = 0; i < CRITERION_SERVE_ATTEMPT_CAP; i++) {
      bumpCriterionServeAttempt(project, criterionId);
    }

    // Exhaust the verify cap
    for (let i = 0; i < CRITERION_VERIFY_ATTEMPT_CAP; i++) {
      bumpCriterionVerifyAttempt(project, criterionId);
    }

    // Set a verdict so we have evidence/history to preserve
    setCriterionVerdict(project, criterionId, {
      met: false,
      evidence: 'Test evidence',
      verifiedBy: 'test-verifier',
      verifiedAtSha: 'abc1234def5678',
      evidencePaths: ['src/file.ts', 'test/file.test.ts'],
    });

    // Verify the counters are exhausted before re-arming
    const beforeRearm = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(beforeRearm?.serveAttemptCount).toBe(CRITERION_SERVE_ATTEMPT_CAP);
    expect(beforeRearm?.verifyAttemptCount).toBe(CRITERION_VERIFY_ATTEMPT_CAP);
    expect(beforeRearm?.evidence).toBe('Test evidence');
    expect(beforeRearm?.verifiedBy).toBe('test-verifier');
    expect(beforeRearm?.evidencePaths).toEqual(['src/file.ts', 'test/file.test.ts']);

    // Re-arm the criterion via MCP
    const result = await handleMissionTool('rearm_mission_criterion', {
      project,
      session,
      criterionId,
      reason: 'Test re-arm',
      actor: 'test-operator',
    });

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.criterionId).toBe(criterionId);
    expect(parsed.reArmCount).toBe(1);
    expect(parsed.clearedServeAttempts).toBe(CRITERION_SERVE_ATTEMPT_CAP);
    expect(parsed.clearedVerifyAttempts).toBe(CRITERION_VERIFY_ATTEMPT_CAP);

    // Verify the counters are zeroed after re-arming
    const afterRearm = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(afterRearm?.serveAttemptCount).toBe(0);
    expect(afterRearm?.verifyAttemptCount).toBe(0);
    expect(afterRearm?.reArmCount).toBe(1);

    // Verify evidence/paths are preserved
    expect(afterRearm?.evidence).toBe('Test evidence');
    expect(afterRearm?.verifiedBy).toBe('test-verifier');
    expect(afterRearm?.verifiedAtSha).toBe('abc1234def5678');
    expect(afterRearm?.evidencePaths).toEqual(['src/file.ts', 'test/file.test.ts']);
  });

  test('reArmCount increments on each call, visible across repeated use', async () => {
    // First re-arm
    const result1 = await handleMissionTool('rearm_mission_criterion', {
      project,
      session,
      criterionId,
      reason: 'First re-arm',
    });

    const parsed1 = JSON.parse(result1!);
    expect(parsed1.reArmCount).toBe(1);

    let crit = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(crit?.reArmCount).toBe(1);

    // Second re-arm
    const result2 = await handleMissionTool('rearm_mission_criterion', {
      project,
      session,
      criterionId,
      reason: 'Second re-arm',
    });

    const parsed2 = JSON.parse(result2!);
    expect(parsed2.reArmCount).toBe(2);

    crit = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(crit?.reArmCount).toBe(2);

    // Third re-arm
    const result3 = await handleMissionTool('rearm_mission_criterion', {
      project,
      session,
      criterionId,
      reason: 'Third re-arm',
    });

    const parsed3 = JSON.parse(result3!);
    expect(parsed3.reArmCount).toBe(3);

    crit = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(crit?.reArmCount).toBe(3);
  });

  test('refuses an already-met criterion with criterion-already-met and records no audit entry', async () => {
    // Set the criterion as met
    setCriterionVerdict(project, criterionId, {
      met: true,
      evidence: 'Criterion is met',
      verifiedBy: 'test-verifier',
      verifiedAtSha: 'abc1234def5678',
    });

    // Verify it's met
    const crit = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(crit?.met).toBe(true);

    // Capture the current audit entries before the failed call
    const auditBefore = listSupervisorAudit({ project });
    const countBefore = auditBefore.length;

    // Attempt to re-arm a met criterion — should fail
    let threwError = false;
    try {
      await handleMissionTool('rearm_mission_criterion', {
        project,
        session,
        criterionId,
        reason: 'Try to re-arm met',
        actor: 'test-operator',
      });
    } catch (err) {
      threwError = true;
      expect((err as Error).message).toMatch(/criterion-already-met/);
    }

    expect(threwError).toBe(true);

    // Verify no new audit entry was written
    const auditAfter = listSupervisorAudit({ project });
    expect(auditAfter.length).toBe(countBefore);

    // Verify the criterion's reArmCount was not mutated
    const critAfter = listCriteria(project, missionTodoId).find((c) => c.id === criterionId);
    expect(critAfter?.reArmCount).toBe(0);
  });
});
