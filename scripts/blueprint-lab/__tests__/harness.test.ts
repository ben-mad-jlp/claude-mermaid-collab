/**
 * Offline, hermetic harness tests: exercises parseDiffContract/validateContractForKind
 * (src/services/diff-contract) plus score.ts's classifyValidation/scoreFileMatch and run.ts's
 * computeGateVerdict against inline DiffContract/AggregateStats literals — no corpus.ts, no
 * fixture .md files, no spawned node.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'bun:test';
import { parseDiffContract, validateContractForKind, renderContract, type DiffContract } from '../../../src/services/diff-contract';
import { classifyValidation, scoreFileMatch, type EmitResult } from '../score';
import { computeGateVerdict, buildReport, type AggregateStats, type RunSummary, type ScoreFile, type GateVerdict } from '../run';
import { emitWithRepair } from '../emit';

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
    { kind: 'symbol-present', id: 'r1', file: 'src/util/time.ts', symbol: 'formatDuration', description: 'new formatter' },
    { kind: 'named-test', id: 'r2', testFile: 'src/util/__tests__/time.test.ts', testName: 'formats ms', mechanical: true },
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
        { kind: 'named-test', id: 'r2', testFile: 'src/util/__tests__/time.test.ts', testName: 'formats ms', mechanical: true },
      ],
    };
    expect(validateContractForKind(contract, 'feature')).toEqual({ underspecified: true, missingField: 'symbol-present' });
  });

  it('classifies a feature contract missing named-test', () => {
    const contract: DiffContract = {
      ...acceptContract,
      requirements: [
        { kind: 'symbol-present', id: 'r1', file: 'src/util/time.ts', symbol: 'formatDuration', description: 'new formatter' },
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

const underspecFeature: DiffContract = {
  ...acceptContract,
  requirements: [
    { kind: 'symbol-present', id: 'r1', file: 'src/util/time.ts', symbol: 'formatDuration', description: 'new formatter' },
  ], // missing named-test → underspecified for 'feature'
};

const fakeCase = {
  id: 'c1', commitSha: 'deadbeef', leafKind: 'feature',
  spec: { title: 'add formatDuration', description: 'ms formatter', files: ['src/util/time.ts'] },
  diff: { baseSha: 'base', touchedFiles: ['src/util/time.ts'], changedSymbols: ['formatDuration'] },
} as any; // CorpusCase-shaped literal

const reply = (text: string) => ({ text, raw: '', stderrTail: '' });

describe('emitWithRepair', () => {
  it('drives exactly one repair re-spawn on an underspecified first emission and scores the repaired-valid contract', async () => {
    const prompts: string[] = [];
    let call = 0;
    const spawn = async (p: string) => {
      prompts.push(p);
      return reply(call++ === 0 ? `first\n${renderContract(underspecFeature)}` : `repaired\n${renderContract(acceptContract)}`);
    };
    const out = await emitWithRepair(fakeCase, spawn);
    expect(out.repairSpawns).toBe(1);
    expect(prompts.length).toBe(2);
    expect(validateContractForKind(out.contract!, out.contract!.leafKind)).toEqual({ underspecified: false });
    expect(out.contract!.requirements.some((r) => r.kind === 'named-test')).toBe(true);
  });

  it('does not re-spawn when the first emission is already fully specified', async () => {
    let call = 0;
    const spawn = async () => { call++; return reply(`ok\n${renderContract(acceptContract)}`); };
    const out = await emitWithRepair(fakeCase, spawn);
    expect(out.repairSpawns).toBe(0);
    expect(call).toBe(1);
  });

  it('falls back to the original contract when the repair re-spawn fails to parse', async () => {
    let call = 0;
    const spawn = async () => reply(call++ === 0 ? `first\n${renderContract(underspecFeature)}` : 'no fence at all');
    const out = await emitWithRepair(fakeCase, spawn);
    expect(out.repairSpawns).toBe(1);
    expect(validateContractForKind(out.contract!, out.contract!.leafKind)).toEqual({ underspecified: true, missingField: 'named-test' });
  });
});

describe('corpus-pin.json', () => {
  it('has at least 10 unique ids', () => {
    const raw = readFileSync(join(import.meta.dir, '../corpus-pin.json'), 'utf8');
    const pin = JSON.parse(raw) as { baselineCommit: string; ids: string[] };
    expect(pin.ids.length).toBeGreaterThanOrEqual(10);
    expect(new Set(pin.ids).size).toBe(pin.ids.length);
  });
});

describe('buildReport provenance + baseline sections', () => {
  it('includes corpus provenance, baseline comparison, and preserves the GATE verdict section', () => {
    const run: RunSummary = { total: 2, parsed: 2, unparsed: [] };
    const score: ScoreFile = {
      scores: [
        {
          id: 'c1',
          leafKindExpected: 'feature',
          leafKindActual: 'feature',
          leafKindMismatch: false,
          validation: 'accept',
          fileMatch: null,
        },
      ],
      aggregate: {
        total: 2,
        validationCounts: { accept: 1, 'parse-null': 1 },
        meanMatchRate: 0.5,
        totalMatched: 0,
        totalUndeclaredActual: 0,
        totalDeclaredButUntouched: 0,
        leafKindMismatchCount: 0,
      },
    };
    const gate: GateVerdict = { verdict: 'ESCALATE', reason: 'test' };

    const report = buildReport(run, score, gate);

    expect(report).toContain('## Corpus provenance');
    expect(report.includes('MATCH') || report.includes('MISMATCH')).toBe(true);
    expect(report).toContain('## Baseline comparison (crit 7 @ 7f473bf8)');
    expect(report).toContain('48.1%');

    const gateSectionIdx = report.indexOf('## GATE verdict');
    expect(gateSectionIdx).toBeGreaterThan(-1);
    const afterGateHeader = report.slice(gateSectionIdx).split('\n').filter((l) => l.trim().length > 0);
    // afterGateHeader[0] is the header itself; the first content line follows
    expect(afterGateHeader[1].startsWith('**')).toBe(true);
  });
});
