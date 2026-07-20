/**
 * blueprint-lab score runner — reads emit.ts's results/run.json (one EmitResult per corpus
 * case: a parsed DiffContract or null) and, per case:
 *   1. runs validateContractForKind against the contract's own leafKind, recording 'accept',
 *      a 'missing:<field>' rejection mode, or 'parse-null' when the contract failed to parse.
 *   2. computes DECLARED touchpoints (filesToCreate + filesToEdit + every symbol-present
 *      requirement's `file`) vs the corpus case's ACTUAL diff.touchedFiles, reporting matched /
 *      undeclared-actual / declared-but-untouched sets and a match rate.
 * Reads emit.ts's persisted output only — does not spawn any node or modify corpus.ts /
 * emit.ts / diff-contract.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateContractForKind, type DiffContract, type DiffLeafKind, type DiffRequirementKind } from '../../src/services/diff-contract';
import { CORPUS, type CorpusCase } from './corpus';

const OUT = join(import.meta.dir, 'results');
const RUN_JSON = join(OUT, 'run.json');

export interface EmitResult {
  id: string;
  leafKindExpected: DiffLeafKind;
  contract: DiffContract | null;
  rawText: string;
}
interface RunSummary {
  total: number;
  parsed: number;
  unparsed: string[];
  results: EmitResult[];
}

function loadRun(): RunSummary {
  return JSON.parse(readFileSync(RUN_JSON, 'utf8'));
}

export type ValidationMode = 'parse-null' | 'accept' | `missing:${DiffRequirementKind}`;

export function classifyValidation(r: EmitResult): ValidationMode {
  if (!r.contract) return 'parse-null';
  const v = validateContractForKind(r.contract, r.contract.leafKind);
  return v.underspecified ? `missing:${v.missingField}` : 'accept';
}

function declaredFiles(c: DiffContract): Set<string> {
  const s = new Set<string>();
  for (const f of c.filesToCreate) s.add(f);
  for (const f of c.filesToEdit) s.add(f);
  for (const r of c.requirements) if (r.kind === 'symbol-present') s.add(r.file);
  return s;
}

export interface FileMatchStats {
  declaredCount: number;
  actualCount: number;
  matched: string[];
  undeclaredActual: string[];
  declaredButUntouched: string[];
  matchRate: number; // matched.length / actualCount, 0 when actualCount === 0
}

export function scoreFileMatch(declared: Set<string>, actual: string[]): FileMatchStats {
  const actualSet = new Set(actual);
  const matched = [...declared].filter((f) => actualSet.has(f)).sort();
  const undeclaredActual = actual.filter((f) => !declared.has(f)).sort();
  const declaredButUntouched = [...declared].filter((f) => !actualSet.has(f)).sort();
  return {
    declaredCount: declared.size,
    actualCount: actualSet.size,
    matched,
    undeclaredActual,
    declaredButUntouched,
    matchRate: actualSet.size > 0 ? matched.length / actualSet.size : 0,
  };
}

export interface CaseScore {
  id: string;
  leafKindExpected: DiffLeafKind;
  leafKindActual: DiffLeafKind | null;
  leafKindMismatch: boolean;
  validation: ValidationMode;
  fileMatch: FileMatchStats | null; // null when contract is null (nothing declared)
}

export function scoreCase(r: EmitResult, corpusById: Map<string, CorpusCase>): CaseScore {
  const validation = classifyValidation(r);
  const c = corpusById.get(r.id);
  const actualFiles = c ? c.diff.touchedFiles : [];
  const fileMatch = r.contract ? scoreFileMatch(declaredFiles(r.contract), actualFiles) : null;
  return {
    id: r.id,
    leafKindExpected: r.leafKindExpected,
    leafKindActual: r.contract ? r.contract.leafKind : null,
    leafKindMismatch: r.contract ? r.contract.leafKind !== r.leafKindExpected : false,
    validation,
    fileMatch,
  };
}

export interface AggregateStats {
  total: number;
  validationCounts: Record<string, number>;
  meanMatchRate: number;
  totalMatched: number;
  totalUndeclaredActual: number;
  totalDeclaredButUntouched: number;
  leafKindMismatchCount: number;
}

export function aggregate(scores: CaseScore[]): AggregateStats {
  const validationCounts: Record<string, number> = {};
  let totalMatched = 0, totalUndeclaredActual = 0, totalDeclaredButUntouched = 0;
  let matchRateSum = 0, matchRateN = 0, leafKindMismatchCount = 0;
  for (const s of scores) {
    validationCounts[s.validation] = (validationCounts[s.validation] ?? 0) + 1;
    if (s.leafKindMismatch) leafKindMismatchCount++;
    if (s.fileMatch) {
      totalMatched += s.fileMatch.matched.length;
      totalUndeclaredActual += s.fileMatch.undeclaredActual.length;
      totalDeclaredButUntouched += s.fileMatch.declaredButUntouched.length;
      matchRateSum += s.fileMatch.matchRate;
      matchRateN++;
    }
  }
  return {
    total: scores.length,
    validationCounts,
    meanMatchRate: matchRateN > 0 ? matchRateSum / matchRateN : 0,
    totalMatched,
    totalUndeclaredActual,
    totalDeclaredButUntouched,
    leafKindMismatchCount,
  };
}

function main() {
  const run = loadRun();
  const corpusById = new Map(CORPUS.map((c) => [c.id, c]));
  const scores = run.results.map((r) => scoreCase(r, corpusById));
  const agg = aggregate(scores);
  writeFileSync(join(OUT, 'score.json'), JSON.stringify({ scores, aggregate: agg }, null, 2));
  console.log(`scored ${scores.length} case(s)`);
  console.log('validation counts:', agg.validationCounts);
  console.log(`mean file-match rate: ${(agg.meanMatchRate * 100).toFixed(1)}%`);
  console.log(`leafKind mismatches: ${agg.leafKindMismatchCount}/${scores.length}`);
}
if (import.meta.main) main();
