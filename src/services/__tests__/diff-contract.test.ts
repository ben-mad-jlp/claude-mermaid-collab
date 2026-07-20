import { describe, it, expect } from 'bun:test';
import {
  parseDiffContract, renderContract, DIFF_LEAF_KINDS, validateContractForKind, CONTRACT_STRICTNESS_MATRIX,
  type DiffContract,
} from '../diff-contract';
import { parseSizeManifest, buildBlueprintRepairPrompt } from '../leaf-executor';
import type { Todo } from '../todo-store';

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
        { kind: 'symbol-present', id: 'r-sym', file: 'src/services/diff-contract.ts', symbol: 'DiffContract', description: 'v2 type exists' },
        { kind: 'named-test', id: 'r-test', testFile: 'src/services/__tests__/diff-contract.test.ts', testName: 'round-trips a representative contract', mechanical: true },
        { kind: 'threshold', id: 'r-thr', source: 'grep-count', metric: 'DIFF_LEAF_KINDS.length', comparison: 'eq', value: 5, mechanical: true },
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
        { kind: 'symbol-present', id: 'r-1', file: 'a.ts', symbol: 'Foo', description: 'exists' },
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
      { kind: 'symbol-present', id: 'r-1', file: 'a.ts', symbol: 'Foo', description: 'exists' },
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

  it('returns null for a real v1-shaped outputText (schemaVersion 1)', () => {
    const v1 = {
      schemaVersion: 1,
      estimatedFiles: 2,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: [],
      filesToEdit: ['a.ts'],
      tasks: [{ id: 't1', files: ['a.ts'], description: 'x' }],
    };
    const src = '```json\n' + JSON.stringify(v1) + '\n```';
    expect(parseDiffContract(src)).toBeNull();
  });

  it('returns null for a truncated fence sliced from valid renderContract output', () => {
    const contract: DiffContract = {
      schemaVersion: 2, estimatedFiles: 1, estimatedTasks: 1, nonEnumerableFanout: false,
      filesToCreate: [], filesToEdit: [], tasks: [], leafKind: 'infra', requirements: [], outOfScope: [],
    };
    const rendered = renderContract(contract);
    const truncated = rendered.slice(0, rendered.length - 20);
    expect(parseDiffContract(truncated)).toBeNull();
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

describe('validateContractForKind / CONTRACT_STRICTNESS_MATRIX', () => {
  const base: DiffContract = {
    schemaVersion: 2, estimatedFiles: 1, estimatedTasks: 1, nonEnumerableFanout: false,
    filesToCreate: [], filesToEdit: [], tasks: [], leafKind: 'feature', requirements: [], outOfScope: [],
  };

  it('reports missingField for a required cell with zero requirements of that kind', () => {
    const result = validateContractForKind(base, 'feature');
    expect(result).toEqual({ underspecified: true, missingField: 'symbol-present' });
  });

  it('passes when every required cell for the leafKind has at least one requirement', () => {
    const ok: DiffContract = {
      ...base,
      requirements: [
        { kind: 'symbol-present', id: 'r-sym', file: 'a.ts', symbol: 'Foo', description: 'x' },
        { kind: 'named-test', id: 'r-test', testFile: 'a.test.ts', testName: 'y', mechanical: true },
      ],
    };
    expect(validateContractForKind(ok, 'feature')).toEqual({ underspecified: false });
  });

  it('refactor only requires symbol-present, not named-test', () => {
    const refactor: DiffContract = {
      ...base, leafKind: 'refactor',
      requirements: [{ kind: 'symbol-present', id: 'r-sym', file: 'a.ts', symbol: 'Foo', description: 'x' }],
    };
    expect(validateContractForKind(refactor, 'refactor')).toEqual({ underspecified: false });
  });

  it('test leafKind only requires named-test, not symbol-present', () => {
    const testKind: DiffContract = {
      ...base, leafKind: 'test',
      requirements: [{ kind: 'named-test', id: 'r-test', testFile: 'a.test.ts', testName: 'y', mechanical: true }],
    };
    expect(validateContractForKind(testKind, 'test')).toEqual({ underspecified: false });
  });

  it('an absent optional threshold cell is never reported as missingField', () => {
    const feature: DiffContract = {
      ...base,
      requirements: [
        { kind: 'symbol-present', id: 'r-sym', file: 'a.ts', symbol: 'Foo', description: 'x' },
        { kind: 'named-test', id: 'r-test', testFile: 'a.test.ts', testName: 'y', mechanical: true },
      ],
    };
    expect(validateContractForKind(feature, 'feature')).toEqual({ underspecified: false });

    const refactor: DiffContract = {
      ...base, leafKind: 'refactor',
      requirements: [{ kind: 'symbol-present', id: 'r-sym', file: 'a.ts', symbol: 'Foo', description: 'x' }],
    };
    expect(validateContractForKind(refactor, 'refactor')).toEqual({ underspecified: false });

    const testKind: DiffContract = {
      ...base, leafKind: 'test',
      requirements: [{ kind: 'named-test', id: 'r-test', testFile: 'a.test.ts', testName: 'y', mechanical: true }],
    };
    expect(validateContractForKind(testKind, 'test')).toEqual({ underspecified: false });

    const infra: DiffContract = {
      ...base, leafKind: 'infra',
      requirements: [{ kind: 'symbol-present', id: 'r-sym', file: 'a.ts', symbol: 'Foo', description: 'x' }],
    };
    expect(validateContractForKind(infra, 'infra')).toEqual({ underspecified: false });
  });

  it('rejects an unfalsifiable requirement at compile time', () => {
    const badMechanical: import('../diff-contract').NamedTestRequirement = {
      kind: 'named-test', id: 'r-bad', testFile: 'a.test.ts', testName: 'x',
      // @ts-expect-error mechanical must be literal true — false is not assignable
      mechanical: false,
    };
    const badSource: import('../diff-contract').ThresholdRequirement = {
      kind: 'threshold', id: 'r-bad',
      // @ts-expect-error 'shell-exec' is not a member of ThresholdRequirement['source']
      source: 'shell-exec',
      metric: 'x', comparison: 'eq', value: 1, mechanical: true,
    };
    expect(true).toBe(true); // presence of the two @ts-expect-error lines above is the assertion
    void badMechanical;
    void badSource;
  });

  it('round-trips a contract with observable and invariant requirements', () => {
    const contract: DiffContract = {
      schemaVersion: 2,
      estimatedFiles: 1,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: [],
      filesToEdit: ['a.ts'],
      tasks: [],
      leafKind: 'feature',
      requirements: [
        { kind: 'observable', id: 'obs-1', description: 'the feature behaves predictably' },
        { kind: 'invariant', id: 'inv-1', description: 'backwards compatibility maintained' },
      ],
      outOfScope: [],
    };
    const rendered = renderContract(contract);
    const parsed = parseDiffContract(rendered);
    expect(parsed).toEqual(contract);
  });

  it('drops a requirement with missing or blank id', () => {
    const raw = {
      schemaVersion: 2,
      estimatedFiles: 1,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: [],
      filesToEdit: [],
      tasks: [],
      leafKind: 'feature',
      requirements: [
        { kind: 'observable', description: 'no id' },
        { kind: 'symbol-present', id: '', file: 'a.ts', symbol: 'F', description: 'blank id' },
        { kind: 'invariant', id: 'inv-1', description: 'has id' },
      ],
      outOfScope: [],
    };
    const src = '```json\n' + JSON.stringify(raw) + '\n```';
    const parsed = parseDiffContract(src);
    expect(parsed).not.toBeNull();
    expect(parsed?.requirements).toEqual([
      { kind: 'invariant', id: 'inv-1', description: 'has id' },
    ]);
  });

  it('matrix exhaustiveness: observable and invariant are optional for all leafKinds', () => {
    for (const leafKind of DIFF_LEAF_KINDS) {
      const row = CONTRACT_STRICTNESS_MATRIX[leafKind];
      expect(row.observable).toBe('optional');
      expect(row.invariant).toBe('optional');
      const keys = Object.keys(row).sort();
      expect(keys).toEqual(['invariant', 'named-test', 'observable', 'symbol-present', 'threshold']);
    }
  });
});

describe('parseSizeManifest v1/v2 parity', () => {
  it('a v1 fence and an equivalent v2 fence produce equal v1-key results', () => {
    const common = {
      estimatedFiles: 2,
      estimatedTasks: 1,
      nonEnumerableFanout: false,
      filesToCreate: ['a.ts'],
      filesToEdit: ['b.ts'],
      tasks: [{ id: 't1', files: ['b.ts'], description: 'x' }],
    };
    const v1Fence = '```json\n' + JSON.stringify({ schemaVersion: 1, ...common }) + '\n```';
    const v2Fence = '```json\n' + JSON.stringify({
      schemaVersion: 2, ...common, leafKind: 'feature', requirements: [], outOfScope: [],
    }) + '\n```';

    const v1Result = parseSizeManifest(v1Fence);
    const v2Result = parseSizeManifest(v2Fence);
    expect(v1Result).not.toBeNull();
    expect(v2Result).not.toBeNull();
    expect({ ...v1Result, schemaVersion: 0 }).toEqual({ ...v2Result, schemaVersion: 0 });
  });
});

describe('buildBlueprintRepairPrompt cites the missing field', () => {
  it('quotes the missingField from validateContractForKind in the repair prompt', () => {
    const base: DiffContract = {
      schemaVersion: 2, estimatedFiles: 1, estimatedTasks: 1, nonEnumerableFanout: false,
      filesToCreate: [], filesToEdit: [], tasks: [], leafKind: 'feature', requirements: [], outOfScope: [],
    };
    const result = validateContractForKind(base, 'feature');
    expect(result.underspecified).toBe(true);
    const missingField = result.underspecified ? result.missingField : '';

    const leaf = { id: 'leaf-1', title: 't', description: 'd' } as unknown as Todo;
    const prompt = buildBlueprintRepairPrompt(leaf, 'some blueprint text', missingField);
    expect(prompt).toContain(`"${missingField}"`);
  });
});
