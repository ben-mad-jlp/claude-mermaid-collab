import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  validateBugfixFiling,
  validateFeatureFiling,
  BugfixFilingRefusedError,
  FeatureFilingRefusedError,
  type BugfixFilingInput,
  type FeatureFilingInput,
} from '../typed-filing-request';
import { ensureBucket, bucketTypeOfTitle } from '../bucket-registry';
import { getTodo, _closeProject } from '../todo-store';

function freshProject(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'typed-filing-'));
  mkdirSync(join(dir, '.collab'), { recursive: true });
  return dir;
}

const projects: string[] = [];
afterEach(() => {
  for (const p of projects.splice(0)) {
    _closeProject(p);
    rmSync(p, { recursive: true, force: true });
  }
});

describe('typed-filing-request: bugfix validation', () => {
  test('bugfix: a missing required field refuses', () => {
    const input: BugfixFilingInput = {
      observedFailure: '',
      evidence: 'file.ts:42',
      fixedMeans: 'the function must return early',
    };

    const result = validateBugfixFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('missing-required-field');
  });

  test('bugfix: a whitespace-only required field refuses', () => {
    const input: BugfixFilingInput = {
      observedFailure: '   ',
      evidence: 'file.ts:42',
      fixedMeans: 'the function must return early',
    };

    const result = validateBugfixFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('missing-required-field');
  });

  test('bugfix: observedFailure with no failure-shaped content refuses with no-failure-shape', () => {
    const input: BugfixFilingInput = {
      observedFailure: 'the component is not working in normal usage',
      evidence: 'src/component.ts:100',
      fixedMeans: 'the function must return early',
    };

    const result = validateBugfixFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('no-failure-shape');
  });

  test('bugfix: evidence with no named anchor refuses with no-named-anchor', () => {
    const input: BugfixFilingInput = {
      observedFailure: 'the handler throws an error when called',
      evidence: 'this error appeared in the logs',
      fixedMeans: 'the function must return early',
    };

    const result = validateBugfixFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('no-named-anchor');
  });

  test('bugfix: fixedMeans with no falsifiable predicate refuses with no-falsifiable-predicate', () => {
    const input: BugfixFilingInput = {
      observedFailure: 'the handler throws an error',
      evidence: 'src/handler.ts:75',
      fixedMeans: 'we added a try-catch block',
    };

    const result = validateBugfixFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('no-falsifiable-predicate');
  });

  test('bugfix: a well-formed filing has refusal null', () => {
    const input: BugfixFilingInput = {
      observedFailure: 'the handler throws an error on invalid input',
      evidence: 'src/handler.ts:75 in processRequest',
      fixedMeans: 'the function must validate input before processing',
    };

    const result = validateBugfixFiling(input);
    expect(result.refusal).toBeNull();
    expect(result.warnings).toEqual([]);
  });
});

describe('typed-filing-request: feature validation', () => {
  test('feature: a missing outcome refuses', () => {
    const input: FeatureFilingInput = {
      outcome: '',
    };

    const result = validateFeatureFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('missing-required-field');
  });

  test('feature: a whitespace-only outcome refuses', () => {
    const input: FeatureFilingInput = {
      outcome: '   ',
    };

    const result = validateFeatureFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('missing-required-field');
  });

  test('feature: outcome with no user-visible subject and verb refuses with no-user-visible-outcome', () => {
    const input: FeatureFilingInput = {
      outcome: 'we improved the performance of the system',
    };

    const result = validateFeatureFiling(input);
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain('no-user-visible-outcome');
  });

  test('feature: a well-formed filing has refusal null', () => {
    const input: FeatureFilingInput = {
      outcome: 'the user now sees a status card in the panel showing progress',
    };

    const result = validateFeatureFiling(input);
    expect(result.refusal).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  test('feature: outcome with named anchor and verb passes', () => {
    const input: FeatureFilingInput = {
      outcome: 'myComponent.tsx:50 now displays a success message to the user',
    };

    const result = validateFeatureFiling(input);
    expect(result.refusal).toBeNull();
  });

  test('feature: outcome with surface term and verb passes', () => {
    const input: FeatureFilingInput = {
      outcome: 'the conductor now shows the mission status on the dashboard',
    };

    const result = validateFeatureFiling(input);
    expect(result.refusal).toBeNull();
  });
});

describe('typed-filing-request: error classes', () => {
  test('the refusal error classes carry bugfix-filing-refused and feature-filing-refused', () => {
    const bugfixErr = new BugfixFilingRefusedError('missing-required-field: test');
    expect(bugfixErr.code).toBe('bugfix-filing-refused');
    expect(bugfixErr.message).toContain('file_bugfix:');

    const featureErr = new FeatureFilingRefusedError('missing-required-field: test');
    expect(featureErr.code).toBe('feature-filing-refused');
    expect(featureErr.message).toContain('file_feature:');
  });
});

describe('typed-filing-request: feature bucket integration', () => {
  test('ensureBucket resolves a singleton epic titled Feature requests', async () => {
    const project = freshProject();
    projects.push(project);

    const id1 = await ensureBucket(project, 'feature');
    const id2 = await ensureBucket(project, 'feature');

    expect(id1).toBe(id2);

    const todo = getTodo(project, id1);
    expect(todo?.kind).toBe('epic');
    expect(todo?.bucketType).toBe('feature');
    expect(todo?.title).toBe('Feature requests');
  });

  test('bucketTypeOfTitle recognises Feature requests as feature', () => {
    expect(bucketTypeOfTitle('Feature requests')).toBe('feature');
    expect(bucketTypeOfTitle('[EPIC] Feature requests')).toBe('feature');
    expect(bucketTypeOfTitle('feature requests')).toBe('feature');
  });
});
