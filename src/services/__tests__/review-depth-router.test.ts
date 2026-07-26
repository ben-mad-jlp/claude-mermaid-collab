import { describe, test, expect } from 'bun:test';
import { routeReviewDepth, type DiffRisk, REVIEW_HEAVY_LOC, REVIEW_HEAVY_FILES, REVIEW_LIGHT_LOC } from '../review-depth-router';

describe('routeReviewDepth', () => {
  test('docs-only small diff with lightPathEnabled: true yields light', () => {
    const risk: DiffRisk = {
      files: ['docs/README.md', 'docs/guide.md'],
      addedLines: 20,
      deletedLines: 10,
    };
    const { depth } = routeReviewDepth(risk, { lightPathEnabled: true });
    expect(depth).toBe('light');
  });

  test('hot path (leaf-executor.ts) single-line touch with lightPathEnabled: true yields heavy, never light', () => {
    const risk: DiffRisk = {
      files: ['src/services/leaf-executor.ts'],
      addedLines: 1,
      deletedLines: 0,
    };
    const { depth } = routeReviewDepth(risk, { lightPathEnabled: true });
    expect(depth).toBe('heavy');
    expect(depth).not.toBe('light');
  });

  test('hot path (coordinator-core.ts) touch yields heavy, not light', () => {
    const risk: DiffRisk = {
      files: ['src/services/coordinator-core.ts'],
      addedLines: 5,
      deletedLines: 2,
    };
    const { depth } = routeReviewDepth(risk);
    expect(depth).not.toBe('light');
    expect(depth).toBe('heavy');
  });

  test('900-LOC non-hot-path diff yields heavy', () => {
    const risk: DiffRisk = {
      files: ['ui/src/Foo.tsx'],
      addedLines: 600,
      deletedLines: 300,
    };
    const { depth } = routeReviewDepth(risk);
    expect(depth).toBe('heavy');
  });

  test('3-file 50-LOC ordinary diff yields standard', () => {
    const risk: DiffRisk = {
      files: ['src/util/a.ts', 'src/util/b.ts', 'src/util/c.ts'],
      addedLines: 30,
      deletedLines: 20,
    };
    const { depth } = routeReviewDepth(risk);
    expect(depth).toBe('standard');
  });

  test('docs-only diff with lightPathEnabled omitted or false yields standard', () => {
    const risk: DiffRisk = {
      files: ['docs/index.md'],
      addedLines: 15,
      deletedLines: 5,
    };
    const resultNoOpt = routeReviewDepth(risk);
    expect(resultNoOpt.depth).toBe('standard');

    const resultFalse = routeReviewDepth(risk, { lightPathEnabled: false });
    expect(resultFalse.depth).toBe('standard');
  });
});
