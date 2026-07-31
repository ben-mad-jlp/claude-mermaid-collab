import { describe, expect, test } from 'bun:test';
import { classifyGateFailure, gateFailureSignature } from '../gate-base-attribution';

describe('classifyGateFailure', () => {
  test('classifies an untouched-file tsc diagnostic as epic-base-red', () => {
    const output = 'src/foo/untouched.ts(10,5): error TS2322: Type mismatch.';
    const result = classifyGateFailure({
      command: 'npx tsc --noEmit',
      output,
      ownChangeSet: ['src/foo/mine.ts'],
    });
    expect(result.kind).toBe('epic-base-red');
    expect(result.failingFiles).toContain('src/foo/untouched.ts');
  });

  test('classifies a change-set-file diagnostic as own', () => {
    const output = 'src/foo/mine.ts(10,5): error TS2322: Type mismatch.';
    const result = classifyGateFailure({
      command: 'npx tsc --noEmit',
      output,
      ownChangeSet: ['src/foo/mine.ts'],
    });
    expect(result.kind).toBe('own');
    expect(result.failingFiles).toContain('src/foo/mine.ts');
  });

  test('classifies unparseable output as unattributable', () => {
    const result = classifyGateFailure({
      command: 'npx tsc --noEmit',
      output: 'Something broke',
      ownChangeSet: ['src/foo/mine.ts'],
    });
    expect(result.kind).toBe('unattributable');
    expect(result.failingFiles).toEqual([]);
  });

  test('classifies a null change-set as unattributable', () => {
    const output = 'src/foo/mine.ts(10,5): error TS2322: Type mismatch.';
    const result = classifyGateFailure({
      command: 'npx tsc --noEmit',
      output,
      ownChangeSet: null,
    });
    expect(result.kind).toBe('unattributable');
  });
});

describe('gateFailureSignature', () => {
  test('gateFailureSignature is identical for the same file set in a different order', () => {
    const a = gateFailureSignature('cmd', ['b.ts', 'a.ts', 'c.ts']);
    const b = gateFailureSignature('cmd', ['c.ts', 'a.ts', 'b.ts']);
    expect(a).toBe(b);
  });
});
