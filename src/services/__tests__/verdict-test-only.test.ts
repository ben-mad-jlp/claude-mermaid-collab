import { describe, test, expect } from 'bun:test';
import { classifyVerdictTestOnly, parseCitedPaths, extractToCloseText } from '../verdict-test-only';

describe('classifyVerdictTestOnly', () => {
  test('classifyVerdictTestOnly returns testOnly true when all evidencePaths are test paths', () => {
    const result = classifyVerdictTestOnly({
      evidence: null,
      evidencePaths: ['src/services/__tests__/verdict-test-only.test.ts', 'src/foo.test.ts'],
    });
    expect(result.testOnly).toBe(true);
    expect(result.reason).toBe('all-cited-paths-are-tests');
    expect(result.nonTestPaths).toEqual([]);
    expect(result.testPaths.sort()).toEqual(
      ['src/services/__tests__/verdict-test-only.test.ts', 'src/foo.test.ts'].sort()
    );
  });

  test('classifyVerdictTestOnly returns false with reason product-path-cited for a non-test evidencePaths entry', () => {
    const result = classifyVerdictTestOnly({
      evidence: null,
      evidencePaths: ['src/services/conductor-pass.ts', 'src/foo.test.ts'],
    });
    expect(result.testOnly).toBe(false);
    expect(result.reason).toBe('product-path-cited');
    expect(result.nonTestPaths).toEqual(['src/services/conductor-pass.ts']);
    expect(result.testPaths).toEqual(['src/foo.test.ts']);
  });

  test('classifyVerdictTestOnly returns false with reason no-cited-paths for an empty evidencePaths array', () => {
    const result = classifyVerdictTestOnly({ evidence: null, evidencePaths: [] });
    expect(result.testOnly).toBe(false);
    expect(result.reason).toBe('no-cited-paths');
    expect(result.testPaths).toEqual([]);
    expect(result.nonTestPaths).toEqual([]);
  });

  test('classifyVerdictTestOnly returns false when evidence prose cites a product path even if evidencePaths is test-only', () => {
    const result = classifyVerdictTestOnly({
      evidence: 'Verified via conductor-pass.ts:470 which drives the escalated loop.',
      evidencePaths: ['src/foo.test.ts'],
    });
    expect(result.testOnly).toBe(false);
    expect(result.reason).toBe('product-path-cited');
    expect(result.nonTestPaths).toContain('conductor-pass.ts');
  });

  test('classifyVerdictTestOnly returns false with reason no-cited-paths for undefined evidencePaths and no parseable evidence', () => {
    const result = classifyVerdictTestOnly({ evidence: 'no paths mentioned here at all', evidencePaths: undefined });
    expect(result.testOnly).toBe(false);
    expect(result.reason).toBe('no-cited-paths');
  });
});

describe('parseCitedPaths', () => {
  test('returns [] for null/empty evidence', () => {
    expect(parseCitedPaths(null)).toEqual([]);
    expect(parseCitedPaths('')).toEqual([]);
  });
});

describe('extractToCloseText', () => {
  test('extractToCloseText returns the tail starting at a case-insensitive TO CLOSE marker', () => {
    const result = extractToCloseText('Some evidence here. to close: verify the gate passes.');
    expect(result).toBe('to close: verify the gate passes.');
  });

  test('extractToCloseText returns the trimmed full evidence when no marker is present, and null for null/empty evidence', () => {
    expect(extractToCloseText('  just some evidence text  ')).toBe('just some evidence text');
    expect(extractToCloseText(null)).toBe(null);
    expect(extractToCloseText('')).toBe(null);
    expect(extractToCloseText('   ')).toBe(null);
  });
});
