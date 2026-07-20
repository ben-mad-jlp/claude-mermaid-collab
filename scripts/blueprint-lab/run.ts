/**
 * blueprint-lab orchestrator — runs emit.ts then score.ts as child processes (both scripts
 * are sealed: this file must not import their private internals, only shell out to them and
 * read back their persisted results/run.json + results/score.json), then writes a
 * human-readable results/report.md (acceptance table, rejection-mode breakdown, match-rate
 * summary) and computes a GATE verdict (PASS/ESCALATE) from the aggregate stats.
 *
 * This is a lab-harness measurement script — it does not wire into leaf-executor.ts, the
 * daemon pipeline, or diff-contract.ts, and running it never mutates those files or any live
 * todo/mission state. The GATE verdict is lab-only: it is never consumed by a real daemon
 * decision, only printed/reported here.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CORPUS, type CorpusCase } from './corpus';

const OUT = join(import.meta.dir, 'results');
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const GATE_MIN_ACCEPT_RATE = 0.7;
const GATE_MIN_MATCH_RATE = 0.6;

interface RunSummary {
  total: number;
  parsed: number;
  unparsed: string[];
}

interface FileMatchStats {
  declaredCount: number;
  actualCount: number;
  matched: string[];
  undeclaredActual: string[];
  declaredButUntouched: string[];
  matchRate: number;
}

interface CaseScore {
  id: string;
  leafKindExpected: string;
  leafKindActual: string | null;
  leafKindMismatch: boolean;
  validation: string;
  fileMatch: FileMatchStats | null;
}

interface AggregateStats {
  total: number;
  validationCounts: Record<string, number>;
  meanMatchRate: number;
  totalMatched: number;
  totalUndeclaredActual: number;
  totalDeclaredButUntouched: number;
  leafKindMismatchCount: number;
}

interface ScoreFile {
  scores: CaseScore[];
  aggregate: AggregateStats;
}

interface GateVerdict {
  verdict: 'PASS' | 'ESCALATE';
  reason: string;
  recommendation?: string;
}

function runChildOrThrow(scriptRelPath: string, args: string[]) {
  const res = spawnSync('bun', ['run', scriptRelPath, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    throw new Error(`${scriptRelPath} exited with status ${res.status}`);
  }
}

function computeGateVerdict(agg: AggregateStats): GateVerdict {
  const acceptRate = agg.total > 0 ? (agg.validationCounts['accept'] ?? 0) / agg.total : 0;

  if (acceptRate >= GATE_MIN_ACCEPT_RATE && agg.meanMatchRate >= GATE_MIN_MATCH_RATE) {
    return {
      verdict: 'PASS',
      reason: `acceptRate=${(acceptRate * 100).toFixed(1)}% >= ${(GATE_MIN_ACCEPT_RATE * 100).toFixed(0)}% and meanMatchRate=${(agg.meanMatchRate * 100).toFixed(1)}% >= ${(GATE_MIN_MATCH_RATE * 100).toFixed(0)}%`,
    };
  }

  if (acceptRate < GATE_MIN_ACCEPT_RATE) {
    // Find the dominant rejection bucket (excluding 'accept') to pick a recommendation.
    let dominantKey: string | null = null;
    let dominantCount = -1;
    for (const [key, count] of Object.entries(agg.validationCounts)) {
      if (key === 'accept') continue;
      if (count > dominantCount) {
        dominantKey = key;
        dominantCount = count;
      }
    }
    const reason = `acceptRate=${(acceptRate * 100).toFixed(1)}% < ${(GATE_MIN_ACCEPT_RATE * 100).toFixed(0)}% threshold`;
    if (dominantKey === 'parse-null') {
      return {
        verdict: 'ESCALATE',
        reason,
        recommendation: 'prose+normalize fallback — the primary node still authors first; add a fallback pass that normalizes free-text blueprint prose into the v2 shape when the primary node fails to emit a parseable fence.',
      };
    }
    if (dominantKey && dominantKey.startsWith('missing:')) {
      return {
        verdict: 'ESCALATE',
        reason,
        recommendation: `repair loop — re-prompt the node with the specific missing requirement kind named (${dominantKey.slice('missing:'.length)}), one bounded retry.`,
      };
    }
    return { verdict: 'ESCALATE', reason };
  }

  // acceptRate is fine but meanMatchRate failed — syntactically valid, factually wrong contracts.
  return {
    verdict: 'ESCALATE',
    reason: `meanMatchRate=${(agg.meanMatchRate * 100).toFixed(1)}% < ${(GATE_MIN_MATCH_RATE * 100).toFixed(0)}% threshold (acceptRate was OK)`,
    recommendation: 'redesign — the node is emitting syntactically valid but factually wrong contracts; this is a prompt/shape issue, not a parsing issue.',
  };
}

function buildReport(run: RunSummary, score: ScoreFile, gate: GateVerdict): string {
  const corpusById = new Map(CORPUS.map((c: CorpusCase) => [c.id, c]));
  const model = process.env.BLUEPRINT_MODEL || 'sonnet';
  const effort = process.env.BLUEPRINT_EFFORT || 'medium';

  const lines: string[] = [];
  lines.push('# blueprint-lab report');
  lines.push('');
  lines.push(`- total cases: ${run.total}`);
  lines.push(`- parsed: ${run.parsed}`);
  lines.push(`- unparsed: ${run.unparsed.length} (${run.unparsed.join(', ') || 'none'})`);
  lines.push(`- blueprint model=${model} effort=${effort}`);
  lines.push('');

  lines.push('## Acceptance table');
  lines.push('');
  lines.push('| id | title | leafKind expected | leafKind actual | validation | file match rate |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of score.scores) {
    const title = corpusById.get(s.id)?.spec.title ?? '';
    const matchRate = s.fileMatch ? `${(s.fileMatch.matchRate * 100).toFixed(1)}%` : 'n/a';
    lines.push(`| ${s.id} | ${title} | ${s.leafKindExpected} | ${s.leafKindActual ?? 'n/a'} | ${s.validation} | ${matchRate} |`);
  }
  lines.push('');

  lines.push('## Rejection-mode breakdown');
  lines.push('');
  lines.push('| mode | count | percentage |');
  lines.push('| --- | --- | --- |');
  for (const [key, count] of Object.entries(score.aggregate.validationCounts)) {
    const pct = score.aggregate.total > 0 ? ((count / score.aggregate.total) * 100).toFixed(1) : '0.0';
    lines.push(`| ${key} | ${count} | ${pct}% |`);
  }
  lines.push('');

  lines.push('## Match-rate summary');
  lines.push('');
  lines.push(`- mean file-match rate: ${(score.aggregate.meanMatchRate * 100).toFixed(1)}%`);
  lines.push(`- total matched: ${score.aggregate.totalMatched}`);
  lines.push(`- total undeclared-actual: ${score.aggregate.totalUndeclaredActual}`);
  lines.push(`- total declared-but-untouched: ${score.aggregate.totalDeclaredButUntouched}`);
  lines.push(`- leafKind mismatches: ${score.aggregate.leafKindMismatchCount}/${score.aggregate.total}`);
  lines.push('');

  lines.push('## GATE verdict');
  lines.push('');
  lines.push(`**${gate.verdict}** — ${gate.reason}`);
  if (gate.recommendation) {
    lines.push('');
    lines.push(`Recommendation: ${gate.recommendation}`);
  }
  lines.push('');

  return lines.join('\n');
}

function main() {
  const forwardedArgs = process.argv.slice(2);

  runChildOrThrow('scripts/blueprint-lab/emit.ts', forwardedArgs);
  runChildOrThrow('scripts/blueprint-lab/score.ts', []);

  const run: RunSummary = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8'));
  const score: ScoreFile = JSON.parse(readFileSync(join(OUT, 'score.json'), 'utf8'));

  const gate = computeGateVerdict(score.aggregate);
  const report = buildReport(run, score, gate);
  writeFileSync(join(OUT, 'report.md'), report);

  console.log('');
  console.log(`=== GATE VERDICT: ${gate.verdict} ===`);
  console.log(gate.reason);
  if (gate.recommendation) console.log(`recommendation: ${gate.recommendation}`);
  console.log(`report written to ${join(OUT, 'report.md')}`);

  process.exitCode = gate.verdict === 'PASS' ? 0 : 1;
}
main();
