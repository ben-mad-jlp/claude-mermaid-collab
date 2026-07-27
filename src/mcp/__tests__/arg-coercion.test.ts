// Tests for shared coerceArrayArg function used across MCP argument boundaries.
import { describe, test, expect } from 'bun:test';
import { coerceArrayArg } from '../arg-coercion';

describe('coerceArrayArg', () => {
  describe('panelVerdicts param', () => {
    const paramName = 'panelVerdicts';
    const sampleArray = [
      { lens: 'evidence-exists', met: true, reason: 'found it' },
      { lens: 'regression-red-when-neutered', met: false, reason: 'test stayed green' },
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

    test('null stays undefined', () => {
      expect(coerceArrayArg(null, paramName)).toBeUndefined();
    });

    test('unparseable string throws with paramName and "unparseable"', () => {
      expect(() => coerceArrayArg('{not json', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws with paramName and "must be an array"', () => {
      expect(() => coerceArrayArg('42', paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
      expect(() => coerceArrayArg(JSON.stringify({ a: 1 }), paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
      expect(() => coerceArrayArg({ lens: 'x' }, paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('options param', () => {
    const paramName = 'options';
    const sampleArray = [
      { id: 'opt1', label: 'Option 1', detail: 'Details' },
      { id: 'opt2', label: 'Option 2' },
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

    test('unparseable string throws with paramName and "unparseable"', () => {
      expect(() => coerceArrayArg('[bad', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws with paramName and "must be an array"', () => {
      expect(() => coerceArrayArg('"just a string"', paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('mergedGraph param', () => {
    const paramName = 'mergedGraph';
    const sampleArray = [
      { id: 'todo1', title: 'Work item 1' },
      { id: 'todo2', title: 'Work item 2' },
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

    test('unparseable string throws with paramName and "unparseable"', () => {
      expect(() => coerceArrayArg('{invalid json', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws with paramName and "must be an array"', () => {
      expect(() => coerceArrayArg('null', paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });

  describe('newConstraints param', () => {
    const paramName = 'newConstraints';
    const sampleArray = [
      { kind: 'constraint1', value: 'val1' },
      { kind: 'constraint2', value: 'val2' },
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
      expect(() => coerceArrayArg('not valid', paramName)).toThrow(
        new RegExp(`${paramName}.*unparseable`, 'i'),
      );
    });

    test('non-array parsed value throws with paramName and "must be an array"', () => {
      expect(() => coerceArrayArg('true', paramName)).toThrow(
        new RegExp(`${paramName}.*must be an array`, 'i'),
      );
    });
  });
});
