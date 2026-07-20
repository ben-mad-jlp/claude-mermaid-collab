import { describe, it, expect } from 'bun:test';
import {
  parseDiffContract, renderContract, DIFF_LEAF_KINDS,
  type DiffContract,
} from '../diff-contract';

describe('parseDiffContract / renderContract round-trip', () => {
  it('round-trips a representative contract (all 3 requirement kinds + splitDecision)', () => {
    const contract: DiffContract = {
      schemaVersion: 2,
      estimatedFiles: 2,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: ['src/services/diff-contract.ts'],
      filesToEdit: ['src/services/leaf-executor.ts'],
      tasks: [
        { id: 'diff-contract-v2', files: ['src/services/diff-contract.ts'], description: 'define v2 contract' },
      ],
      splitDecision: { split: false, reason: 'coupled primitive', items: [] },
      leafKind: 'feature',
      requirements: [
        { kind: 'symbol-present', file: 'src/services/diff-contract.ts', symbol: 'DiffContract', description: 'v2 type exists' },
        { kind: 'named-test', testFile: 'src/services/__tests__/diff-contract.test.ts', testName: 'round-trips a representative contract', mechanical: true },
        { kind: 'threshold', source: 'grep-count', metric: 'DIFF_LEAF_KINDS.length', comparison: 'eq', value: 5, mechanical: true },
      ],
      outOfScope: ['wiring into leaf-executor.ts'],
    };

    const rendered = renderContract(contract);
    expect(rendered).toContain('```json');
    const parsed = parseDiffContract(rendered);
    expect(parsed).toEqual(contract);
  });

  it('drops a malformed requirement instead of failing the whole parse', () => {
    const raw = {
      schemaVersion: 2,
      estimatedFiles: 1,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: [],
      filesToEdit: [],
      tasks: [],
      leafKind: 'fix',
      requirements: [
        { kind: 'symbol-present', file: 'a.ts', symbol: 'Foo', description: 'exists' },
        { kind: 'named-test', testFile: 'a.test.ts', testName: 'x', mechanical: false }, // invalid: mechanical must be true
        { kind: 'threshold', source: 'shell-exec', metric: 'x', comparison: 'gte', value: 1, mechanical: true }, // invalid source
        { kind: 'unknown-kind' },
      ],
      outOfScope: [],
    };
    const src = '```json\n' + JSON.stringify(raw) + '\n```';
    const parsed = parseDiffContract(src);
    expect(parsed).not.toBeNull();
    expect(parsed?.requirements).toEqual([
      { kind: 'symbol-present', file: 'a.ts', symbol: 'Foo', description: 'exists' },
    ]);
  });

  it('returns null when schemaVersion is not 2 (v1 manifest floors)', () => {
    const raw = { schemaVersion: 1, estimatedFiles: 1, estimatedTasks: 1, nonEnumerableFanout: false, filesToCreate: [], filesToEdit: [], tasks: [] };
    const src = '```json\n' + JSON.stringify(raw) + '\n```';
    expect(parseDiffContract(src)).toBeNull();
  });

  it('returns null when leafKind is missing or invalid', () => {
    const base = { schemaVersion: 2, estimatedFiles: 1, estimatedTasks: 1, nonEnumerableFanout: false, filesToCreate: [], filesToEdit: [], tasks: [], requirements: [], outOfScope: [] };
    expect(parseDiffContract('```json\n' + JSON.stringify(base) + '\n```')).toBeNull();
    expect(parseDiffContract('```json\n' + JSON.stringify({ ...base, leafKind: 'not-a-kind' }) + '\n```')).toBeNull();
  });

  it('returns null (never throws) on malformed JSON or no fence', () => {
    expect(parseDiffContract('```json\n{ not valid json\n```')).toBeNull();
    expect(parseDiffContract('no fence here at all')).toBeNull();
    expect(parseDiffContract(undefined)).toBeNull();
  });

  it('falls through to a later source when an earlier one fails', () => {
    const good = {
      schemaVersion: 2, estimatedFiles: 0, estimatedTasks: 0, nonEnumerableFanout: false,
      filesToCreate: [], filesToEdit: [], tasks: [], leafKind: 'infra', requirements: [], outOfScope: [],
    };
    const badSrc = '```json\n{ broken\n```';
    const goodSrc = '```json\n' + JSON.stringify(good) + '\n```';
    const parsed = parseDiffContract(badSrc, goodSrc);
    expect(parsed?.leafKind).toBe('infra');
  });

  it('DIFF_LEAF_KINDS lists all 5 members', () => {
    expect([...DIFF_LEAF_KINDS].sort()).toEqual(['feature', 'fix', 'infra', 'refactor', 'test']);
  });
});
