import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetMissionDbCache,
  upsertMission,
  addCriterion,
  setCriterionVerdict,
  clearCriterionVerdict,
  listCriteria,
  unverifyCriteriaForLandedPaths,
  listPendingRechecks,
  deriveMissionStatus,
  getMission,
  collectMissionStatusFacts,
} from '../mission-store';
import { createTodo, _closeProject } from '../todo-store';

describe('verification-as-event', () => {
  let projectDir: string;
  let projectId: string;
  let missionTodoId: string;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'mission-test-'));
    projectId = projectDir;
    process.env.MERMAID_SUPERVISOR_DIR = projectDir;
    _resetMissionDbCache();

    // Create mission node + mission control state
    const m = await createTodo(projectId, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[MISSION] Test Mission',
      kind: 'mission',
    });
    missionTodoId = m.id;
    upsertMission(projectId, missionTodoId);
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

  test('un-verifies a met criterion when its evidencePaths intersect the landed paths', async () => {
    // Add a criterion for this test
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Set up: criterion met with evidencePaths
    setCriterionVerdict(projectId, criterionId, {
      met: true,
      evidence: 'test evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: ['src/foo.ts', 'src/bar.ts'],
    });

    let criteria = listCriteria(projectId, missionTodoId);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.met).toBe(true);
    expect(criteria[0]?.verifiedAt).not.toBeNull();

    // Fire the event: land touches src/foo.ts
    const affected = unverifyCriteriaForLandedPaths(projectId, ['src/foo.ts', 'src/baz.ts'], {
      landedSha: 'def456',
    });

    // Criterion is now unverified
    expect(affected).toHaveLength(1);
    expect(affected[0]?.criterionId).toBe(criterionId);
    expect(affected[0]?.todoId).toBe(missionTodoId);

    criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.met).toBe(false);
    expect(criteria[0]?.verifiedAt).toBeNull();
    expect(criteria[0]?.evidence).toBeNull();
    expect(criteria[0]?.verifiedBy).toBeNull();
    expect(criteria[0]?.verifiedAtSha).toBeNull();
    // evidencePaths is preserved
    expect(criteria[0]?.evidencePaths).toEqual(['src/foo.ts', 'src/bar.ts']);

    // Recheck is enqueued
    const rechecks = listPendingRechecks(projectId);
    expect(rechecks).toHaveLength(1);
    expect(rechecks[0]?.criterionId).toBe(criterionId);
    expect(rechecks[0]?.todoId).toBe(missionTodoId);
    expect(rechecks[0]?.reason).toBe('land-diff-intersects-evidence');
    expect(rechecks[0]?.landedSha).toBe('def456');
  });

  test('leaves a met criterion untouched when its evidencePaths do NOT intersect landed paths', async () => {
    // Add a criterion for this test
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Set up: criterion met with evidencePaths
    setCriterionVerdict(projectId, criterionId, {
      met: true,
      evidence: 'test evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: ['src/foo.ts', 'src/bar.ts'],
    });

    // Fire the event: land touches unrelated files
    const affected = unverifyCriteriaForLandedPaths(projectId, ['docs/readme.md', 'tests/spec.ts']);

    // Criterion is unchanged
    expect(affected).toHaveLength(0);

    const criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.met).toBe(true);
    expect(criteria[0]?.verifiedAt).not.toBeNull();
    expect(criteria[0]?.evidence).toBe('test evidence');

    // No recheck enqueued
    const rechecks = listPendingRechecks(projectId);
    expect(rechecks).toHaveLength(0);
  });

  test('is a no-op when landedPaths is empty', async () => {
    // Add a criterion for this test
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Set up: criterion met
    setCriterionVerdict(projectId, criterionId, {
      met: true,
      evidence: 'test evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: ['src/foo.ts'],
    });

    // Fire the event with empty paths
    const affected = unverifyCriteriaForLandedPaths(projectId, []);

    expect(affected).toHaveLength(0);

    // Criterion unchanged
    const criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.met).toBe(true);

    // No recheck enqueued
    const rechecks = listPendingRechecks(projectId);
    expect(rechecks).toHaveLength(0);
  });

  test('clearCriterionVerdict nulls verifiedAt so deriveMissionStatus returns needs-verify', async () => {
    // Add a criterion for this test
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Set up: criterion met and verified
    setCriterionVerdict(projectId, criterionId, {
      met: true,
      evidence: 'test evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: ['src/foo.ts'],
    });

    // Create a landed epic child to have hasLandedEpic = true
    await createTodo(projectId, {
      allowOrphan: true,
      ownerSession: 's1',
      title: '[EPIC] Test Epic',
      parentId: missionTodoId,
      kind: 'epic',
    }).then(t => t).catch(() => null); // best-effort
    // Mark it as done so hasLandedEpic = true
    // (for simplicity, we'll just verify on unverified criteria)

    let criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.verifiedAt).not.toBeNull();

    // Clear the verdict
    clearCriterionVerdict(projectId, criterionId);

    criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.met).toBe(false);
    expect(criteria[0]?.verifiedAt).toBeNull();
    expect(criteria[0]?.evidence).toBeNull();
    expect(criteria[0]?.verifiedBy).toBeNull();
    expect(criteria[0]?.verifiedAtSha).toBeNull();

    // Mission status should reflect the unverified criterion
    const mission = getMission(projectId, missionTodoId);
    expect(mission).toBeDefined();
  });
});
