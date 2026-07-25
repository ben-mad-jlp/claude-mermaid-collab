import { test, expect } from 'bun:test';
import { buildCriterionDiagnosis } from '../criterion-diagnosis';
import type { ApproachAttempt, ApproachRung } from '../criterion-approach-store';

test('buildCriterionDiagnosis: renders body with all sections and recommendation', () => {
  const attempts: ApproachAttempt[] = [
    {
      id: 'a1',
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'fresh-blueprint',
      epicId: 'e1',
      outcome: 'attempted',
      detail: 'Tried fresh approach',
      attemptedAt: 1000,
    },
    {
      id: 'a2',
      criterionId: 'c1',
      missionId: 'm1',
      project: '/p',
      rung: 'tier-bump',
      epicId: 'e2',
      outcome: 'failed',
      detail: 'Tier bump did not help',
      attemptedAt: 2000,
    },
  ];

  const missing: ApproachRung[] = ['re-decompose'];
  const distinctReasons = ['reason one', 'reason two'];

  const result = buildCriterionDiagnosis({
    criterionText: 'MyTestCriterion',
    servedEpicCount: 3,
    attempts,
    distinctReasons,
    missing,
  });

  expect(result.body).toContain('MyTestCriterion');
  expect(result.body).toContain('3');
  expect(result.body).toContain('Rungs tried:');
  expect(result.body).toContain('fresh-blueprint');
  expect(result.body).toContain('tier-bump');
  expect(result.body).toContain('Rungs not yet tried:');
  expect(result.body).toContain('re-decompose');
  expect(result.body).toContain('Distinct rejection reasons:');
  expect(result.body).toContain('reason one');
  expect(result.body).toContain('reason two');
  expect(result.body).toContain('Recommendation:');

  // Should NOT be a count-only string
  expect(result.body).not.toBe('3 epics served');

  // Body should be multi-line with at least 5 distinct lines (header, rungs, missing, reasons, recommendation)
  expect(result.body.split('\n').length).toBeGreaterThan(4);
});

test('buildCriterionDiagnosis: empty attempts renders no-rungs-recorded', () => {
  const result = buildCriterionDiagnosis({
    criterionText: 'Test',
    servedEpicCount: 1,
    attempts: [],
    distinctReasons: [],
    missing: ['fresh-blueprint'],
  });

  expect(result.body).toContain('(no rungs recorded)');
});

test('buildCriterionDiagnosis: exhausted ladder renders appropriate message', () => {
  const result = buildCriterionDiagnosis({
    criterionText: 'Test',
    servedEpicCount: 5,
    attempts: [
      {
        id: 'a1',
        criterionId: 'c1',
        missionId: 'm1',
        project: '/p',
        rung: 'fresh-blueprint',
        epicId: null,
        outcome: 'attempted',
        detail: 'Failed',
        attemptedAt: 1000,
      },
    ],
    distinctReasons: ['reason1'],
    missing: [],
  });

  expect(result.body).toContain('(none — ladder exhausted)');
  expect(result.recommendation).toContain('exhausted');
  expect(result.recommendation).toContain('human decision');
});

test('buildCriterionDiagnosis: returns next rung in recommendation when ladder not exhausted', () => {
  const result = buildCriterionDiagnosis({
    criterionText: 'Test',
    servedEpicCount: 2,
    attempts: [],
    distinctReasons: [],
    missing: ['fresh-blueprint', 'tier-bump'],
  });

  expect(result.recommendation).toContain('fresh-blueprint');
  expect(result.recommendation).toContain('next rung');
});

test('buildCriterionDiagnosis: no-recorded-reasons renders appropriate line', () => {
  const result = buildCriterionDiagnosis({
    criterionText: 'Test',
    servedEpicCount: 1,
    attempts: [],
    distinctReasons: [],
    missing: [],
  });

  expect(result.body).toContain('(none recorded)');
});
