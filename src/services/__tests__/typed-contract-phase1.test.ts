import { describe, test, expect } from 'bun:test';
import { contractCoversCitability, type DiffContract, type DiffRequirement } from '../diff-contract';

/** Phase-1 typed-contract activation (bug e2fc870a): the blueprint prompt now emits schemaVersion 2,
 *  and contractCoversCitability is the record-only parity helper. These pin the helper's contract:
 *  a mechanically-citable requirement (symbol-present / named-test / threshold) covers citability;
 *  a contract carrying only LLM-judged requirements (observable / invariant) does NOT. */

const base: Omit<DiffContract, 'requirements'> = {
  schemaVersion: 2,
  estimatedFiles: 1,
  estimatedTasks: 1,
  nonEnumerableFanout: false,
  filesToCreate: [],
  filesToEdit: ['src/x.ts'],
  tasks: [{ id: 't1', files: ['src/x.ts'], description: 'do x' }],
  leafKind: 'feature',
  outOfScope: [],
};
const withReqs = (requirements: DiffRequirement[]): DiffContract => ({ ...base, requirements });

const symbolPresent: DiffRequirement = { kind: 'symbol-present', id: 'r1', file: 'src/x.ts', symbol: 'foo', description: 'foo exists' };
const namedTest: DiffRequirement = { kind: 'named-test', id: 'r2', testFile: 'src/x.test.ts', testName: 'foo works', mechanical: true };
const threshold: DiffRequirement = { kind: 'threshold', id: 'r3', source: 'grep-count', metric: 'callers', comparison: 'eq', value: 0, mechanical: true };
const observable: DiffRequirement = { kind: 'observable', id: 'r4', description: 'the UI updates' };
const invariant: DiffRequirement = { kind: 'invariant', id: 'r5', description: 'existing behavior preserved' };

describe('contractCoversCitability', () => {
  test('a mechanically-citable requirement covers citability', () => {
    expect(contractCoversCitability(withReqs([symbolPresent]))).toBe(true);
    expect(contractCoversCitability(withReqs([namedTest]))).toBe(true);
    expect(contractCoversCitability(withReqs([threshold]))).toBe(true);
    // mixed: at least one citable ⇒ true
    expect(contractCoversCitability(withReqs([observable, symbolPresent]))).toBe(true);
  });

  test('only LLM-judged (observable/invariant) requirements do NOT cover citability', () => {
    expect(contractCoversCitability(withReqs([observable]))).toBe(false);
    expect(contractCoversCitability(withReqs([invariant]))).toBe(false);
    expect(contractCoversCitability(withReqs([observable, invariant]))).toBe(false);
    expect(contractCoversCitability(withReqs([]))).toBe(false);
  });
});
