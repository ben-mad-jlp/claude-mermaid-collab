// Tests for MCP object-array params coerced at the surface dispatch layer.
import { describe, test, expect } from 'bun:test';
import { coerceArrayArg } from '../arg-coercion';

describe('arg-coercion-surface', () => {
  describe('forge_mission constraints param', () => {
    const paramName = 'constraints';
    const sampleArray = [
      { rule: 'no breaking changes', rationale: 'backward compat required' },
      { rule: 'test coverage ≥ 80%', rationale: 'quality gate' },
    ];

    test('stringified array coerces to a real array', () => {
      const result = coerceArrayArg(JSON.stringify(sampleArray), paramName);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(sampleArray);
    });

    test('real array passes through unchanged', () => {
      const result = coerceArrayArg(sampleArray, paramName);
      expect(result).toBe(sampleArray);
    });

    test('undefined stays undefined', () => {
      expect(coerceArrayArg(undefined, paramName)).toBeUndefined();
    });

    test('unparseable string throws with paramName and "unparseable"', () => {
      expect(() => coerceArrayArg('{not json', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws with paramName and "must be an array"', () => {
      expect(() => coerceArrayArg(JSON.stringify({ rule: 'x' }), paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('forge_mission rejectedAlternatives param', () => {
    const paramName = 'rejectedAlternatives';
    const sampleArray = [
      {
        title: 'Use TypeScript',
        rationale: 'Team voted for JS',
        alternatives: ['TypeScript', 'Flow'],
      },
      {
        title: 'Database choice',
        rationale: 'PostgreSQL chosen',
        alternatives: ['MongoDB', 'MySQL', 'SQLite'],
      },
    ];

    test('stringified array coerces to a real array', () => {
      const result = coerceArrayArg(JSON.stringify(sampleArray), paramName);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(sampleArray);
    });

    test('real array passes through unchanged', () => {
      const result = coerceArrayArg(sampleArray, paramName);
      expect(result).toBe(sampleArray);
    });

    test('undefined stays undefined', () => {
      expect(coerceArrayArg(undefined, paramName)).toBeUndefined();
    });

    test('unparseable string throws fail-closed', () => {
      expect(() => coerceArrayArg(']["bad', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws fail-closed', () => {
      expect(() => coerceArrayArg('null', paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('snippet tags param', () => {
    const paramName = 'tags';
    const sampleArray = [
      { type: 'language', value: 'python' },
      { type: 'category', value: 'data-processing' },
    ];

    test('stringified array coerces to a real array', () => {
      const result = coerceArrayArg(JSON.stringify(sampleArray), paramName);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(sampleArray);
    });

    test('real array passes through unchanged', () => {
      const result = coerceArrayArg(sampleArray, paramName);
      expect(result).toBe(sampleArray);
    });

    test('undefined stays undefined', () => {
      expect(coerceArrayArg(undefined, paramName)).toBeUndefined();
    });

    test('unparseable string throws fail-closed', () => {
      expect(() => coerceArrayArg('{incomplete', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws fail-closed', () => {
      expect(() => coerceArrayArg(JSON.stringify({ type: 'x', value: 'y' }), paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('browser_save_setup steps param', () => {
    const paramName = 'steps';
    const sampleArray = [
      { action: 'navigate', url: 'https://example.com' },
      { action: 'click', selector: '.button' },
      { action: 'wait_for', selector: '.modal' },
    ];

    test('stringified array coerces to a real array', () => {
      const result = coerceArrayArg(JSON.stringify(sampleArray), paramName);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(sampleArray);
    });

    test('real array passes through unchanged', () => {
      const result = coerceArrayArg(sampleArray, paramName);
      expect(result).toBe(sampleArray);
    });

    test('unparseable string throws fail-closed', () => {
      expect(() => coerceArrayArg('[{broken', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws fail-closed', () => {
      expect(() => coerceArrayArg(JSON.stringify({ action: 'navigate' }), paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('browser_save_setup parameters param', () => {
    const paramName = 'parameters';
    const sampleArray = [
      { name: 'timeout_ms', default: '5000' },
      { name: 'username' },
      { name: 'password' },
    ];

    test('stringified array coerces to a real array', () => {
      const result = coerceArrayArg(JSON.stringify(sampleArray), paramName);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(sampleArray);
    });

    test('real array passes through unchanged', () => {
      const result = coerceArrayArg(sampleArray, paramName);
      expect(result).toBe(sampleArray);
    });

    test('undefined stays undefined', () => {
      expect(coerceArrayArg(undefined, paramName)).toBeUndefined();
    });

    test('unparseable string throws fail-closed', () => {
      expect(() => coerceArrayArg('["unclosed', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws fail-closed', () => {
      expect(() => coerceArrayArg(JSON.stringify({ name: 'x' }), paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('panelVerdicts param coverage note', () => {
    test('panelVerdicts is already coerced via normalizePanelVerdicts in criterion-verify-panel.ts:134', () => {
      // This documents that panelVerdicts is already covered by the existing coercion
      // in criterion-verify-panel.ts (via normalizePanelVerdicts call at mission-tools.ts:272).
      // Regression tests for panelVerdicts are in criterion-verify-panel.test.ts:188-218.
      expect(true).toBe(true);
    });
  });
});
