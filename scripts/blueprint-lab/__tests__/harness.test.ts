/**
 * Offline, hermetic harness tests: exercises parseDiffContract/validateContractForKind
 * (src/services/diff-contract) plus score.ts's classifyValidation/scoreFileMatch and run.ts's
 * computeGateVerdict against inline DiffContract/AggregateStats literals — no corpus.ts, no
 * fixture .md files, no spawned node.
 */
import { describe, it, expect } from 'bun:test';
import { parseDiffContract, validateContractForKind, type DiffContract } from '../../../src/services/diff-contract';
import { classifyValidation, scoreFileMatch, type EmitResult } from '../score';
import { computeGateVerdict, type AggregateStats } from '../run';

const acceptContract: DiffContract = {
  schemaVersion: 2,
  estimatedFiles: 1,
  estimatedTasks: 1,
  nonEnumerableFanout: false,
  filesToCreate: [],
  filesToEdit: ['src/util/time.ts'],
  tasks: [{ id: 't1', files: ['src/util/time.ts'], description: 'add helper' }],
  leafKind: 'feature',
  requirements: [
    { kind: 'symbol-present', file: 'src/util/time.ts', symbol: 'formatDuration', description: 'new formatter' },
    { kind: 'named-test', testFile: 'src/util/__tests__/time.test.ts', testName: 'formats ms', mechanical: true },
  ],
  outOfScope: [],
};

describe('parseDiffContract + validateContractForKind classification', () => {
  it('classifies a fully-specified feature contract as accept', () => {
    expect(validateContractForKind(acceptContract, 'feature')).toEqual({ underspecified: false });
  });

  it('classifies a feature contract missing symbol-present', () => {
    const contract: DiffContract = {
      ...acceptContract,
      requirements: [
        { kind: 'named-test', testFile: 'src/util/__tests__/time.test.ts', testName: 'formats ms', mechanical: true },
      ],
    };
    expect(validateContractForKind(contract, 'feature')).toEqual({ underspecified: true, missingField: 'symbol-present' });
  });

  it('classifies a feature contract missing named-test', () => {
    const contract: DiffContract = {
      ...acceptContract,
      requirements: [
        { kind: 'symbol-present', file: 'src/util/time.ts', symbol: 'formatDuration', description: 'new formatter' },
      ],
    };
    expect(validateContractForKind(contract, 'feature')).toEqual({ underspecified: true, missingField: 'named-test' });
  });

  it('parseDiffContract returns null for text with no json fence', () => {
    expect(parseDiffContract('just prose, no fence')).toBeNull();
  });

  it('parseDiffContract returns null for a schemaVersion 1 fence', () => {
    expect(parseDiffContract('prose\n```json\n{"schemaVersion":1}\n```')).toBeNull();
  });

  it('classifyValidation from score.ts maps a null contract to parse-null', () => {
    const r: EmitResult = { id: 'c1', leafKindExpected: 'feature', contract: null, rawText: '' };
    expect(classifyValidation(r)).toBe('parse-null');
  });

  it('classifyValidation maps an accepted contract to accept', () => {
    const r: EmitResult = { id: 'c1', leafKindExpected: 'feature', contract: acceptContract, rawText: '' };
    expect(classifyValidation(r)).toBe('accept');
  });
});

describe('scoreFileMatch', () => {
  it('computes matched, undeclaredActual, declaredButUntouched and matchRate correctly', () => {
    const result = scoreFileMatch(new Set(['a.ts', 'b.ts']), ['a.ts', 'c.ts']);
    expect(result.matched).toEqual(['a.ts']);
    expect(result.undeclaredActual).toEqual(['c.ts']);
    expect(result.declaredButUntouched).toEqual(['b.ts']);
    expect(result.matchRate).toBe(0.5);
  });

  it('matchRate is 0 when actual is empty', () => {
    const result = scoreFileMatch(new Set(['a.ts']), []);
    expect(result.matchRate).toBe(0);
    expect(result.declaredButUntouched).toEqual(['a.ts']);
  });
});

describe('computeGateVerdict', () => {
  it('returns PASS when acceptRate and meanMatchRate both clear threshold', () => {
    const agg: AggregateStats = {
      total: 10,
      validationCounts: { accept: 8, 'parse-null': 2 },
      meanMatchRate: 0.7,
      totalMatched: 0,
      totalUndeclaredActual: 0,
      totalDeclaredButUntouched: 0,
      leafKindMismatchCount: 0,
    };
    expect(computeGateVerdict(agg).verdict).toBe('PASS');
  });

  it('returns ESCALATE with prose+normalize recommendation when parse-null dominates a low accept rate', () => {
    const agg: AggregateStats = {
      total: 10,
      validationCounts: { accept: 3, 'parse-null': 7 },
      meanMatchRate: 0.9,
      totalMatched: 0,
      totalUndeclaredActual: 0,
      totalDeclaredButUntouched: 0,
      leafKindMismatchCount: 0,
    };
    const verdict = computeGateVerdict(agg);
    expect(verdict.verdict).toBe('ESCALATE');
    expect(verdict.recommendation).toContain('prose+normalize');
  });

  it('returns ESCALATE with repair-loop recommendation when missing:<kind> dominates a low accept rate', () => {
    const agg: AggregateStats = {
      total: 10,
      validationCounts: { accept: 3, 'missing:symbol-present': 7 },
      meanMatchRate: 0.9,
      totalMatched: 0,
      totalUndeclaredActual: 0,
      totalDeclaredButUntouched: 0,
      leafKindMismatchCount: 0,
    };
    const verdict = computeGateVerdict(agg);
    expect(verdict.verdict).toBe('ESCALATE');
    expect(verdict.recommendation).toContain('repair loop');
    expect(verdict.recommendation).toContain('symbol-present');
  });

  it('returns ESCALATE with redesign recommendation when acceptRate is fine but meanMatchRate fails', () => {
    const agg: AggregateStats = {
      total: 10,
      validationCounts: { accept: 9 },
      meanMatchRate: 0.2,
      totalMatched: 0,
      totalUndeclaredActual: 0,
      totalDeclaredButUntouched: 0,
      leafKindMismatchCount: 0,
    };
    const verdict = computeGateVerdict(agg);
    expect(verdict.verdict).toBe('ESCALATE');
    expect(verdict.recommendation).toContain('redesign');
  });
});
