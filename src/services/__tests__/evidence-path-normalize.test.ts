import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _resetMissionDbCache,
  upsertMission,
  addCriterion,
  setCriterionVerdict,
  unverifyCriteriaForLandedPaths,
  listCriteria,
} from '../mission-store';
import { listOpenEscalations } from '../supervisor-store';
import { createTodo, _closeProject } from '../todo-store';

describe('evidence-path-normalize', () => {
  let projectDir: string;
  let projectId: string;
  let missionTodoId: string;
  let supervisorDir: string;

  beforeEach(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'evidence-normalize-test-'));
    projectId = projectDir;
    // Use a persistent supervisor dir across all tests to avoid database connection issues
    supervisorDir ||= mkdtempSync(join(tmpdir(), 'evidence-normalize-supervisor-'));
    process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
    _resetMissionDbCache();

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
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    // Keep MERMAID_SUPERVISOR_DIR and supervisorDir for next test to avoid db connection issues
  });

  test('Test A: normalize absolute and ./-prefixed paths, land matches stored normalized paths', async () => {
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Set verdict with both absolute and ./-prefixed paths
    setCriterionVerdict(projectId, criterionId, {
      met: true,
      evidence: 'test evidence',
      verifiedBy: 'test-judge',
      verifiedAtSha: 'abc123',
      evidencePaths: [join(projectDir, 'src/foo.ts'), './src/bar.ts'],
    });

    // Verify paths are stored as repo-relative (no ./ prefix, no absolute path)
    let criteria = listCriteria(projectId, missionTodoId);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.evidencePaths).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(criteria[0]?.met).toBe(true);

    // Land touches src/foo.ts — should match normalized path and clear the criterion
    const affected = unverifyCriteriaForLandedPaths(projectId, ['src/foo.ts'], {
      landedSha: 'sha1',
    });

    expect(affected).toHaveLength(1);
    expect(affected[0]?.criterionId).toBe(criterionId);

    // Criterion is now unverified
    criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.met).toBe(false);
    expect(criteria[0]?.verifiedAt).toBeNull();
  });

  test('Test B: reopenCount increments and churn card fires once when threshold is crossed', async () => {
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Loop 6 times: verify + land to trigger reopens
    for (let i = 0; i < 6; i++) {
      setCriterionVerdict(projectId, criterionId, {
        met: true,
        evidence: 'test evidence',
        verifiedBy: 'test-judge',
        verifiedAtSha: `sha${i}`,
        evidencePaths: [join(projectDir, 'src/foo.ts')],
      });

      unverifyCriteriaForLandedPaths(projectId, ['src/foo.ts'], {
        landedSha: `sha${i}`,
      });
    }

    // Check reopenCount reached 6
    let criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.reopenCount).toBe(6);
    expect(criteria[0]?.lastReopenSha).toBe('sha5');

    // Verify exactly one mission-criterion-churn escalation is open for this project (deduped)
    const escalations = listOpenEscalations().filter(e => e.kind === 'mission-criterion-churn' && e.project === projectId);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.questionText).toContain('has been re-opened by 5+ lands');
  });

  test('Test C: below threshold → no churn card', async () => {
    const c = addCriterion(projectId, missionTodoId, 'Test acceptance criterion');
    const criterionId = c.id;

    // Loop 2 times: verify + land to trigger reopens (below threshold of 5)
    for (let i = 0; i < 2; i++) {
      setCriterionVerdict(projectId, criterionId, {
        met: true,
        evidence: 'test evidence',
        verifiedBy: 'test-judge',
        verifiedAtSha: `sha${i}`,
        evidencePaths: [join(projectDir, 'src/foo.ts')],
      });

      unverifyCriteriaForLandedPaths(projectId, ['src/foo.ts'], {
        landedSha: `sha${i}`,
      });
    }

    // Check reopenCount is 2
    const criteria = listCriteria(projectId, missionTodoId);
    expect(criteria[0]?.reopenCount).toBe(2);

    // Verify NO mission-criterion-churn escalation is open for this project
    const escalations = listOpenEscalations().filter(e => e.kind === 'mission-criterion-churn' && e.project === projectId);
    expect(escalations).toHaveLength(0);
  });
});
