#!/usr/bin/env bun
/**
 * Repair lapsed (TTL-expired) live quarantine rows: re-run each row's resolved test file
 * `--runs` times and decide its fate from fresh evidence rather than leaving it lapsed in
 * limbo — de-flake (retire) on all-green, re-quarantine (fresh TTL) on any fail or on an
 * unrunnable row.
 *
 * Usage: bun run scripts/repair-lapsed-quarantine.ts [--apply] [--runs=N] [--concurrency=N] [--sha=SHA] [project-root]
 * Default: --dry-run (no writes). Pass --apply to commit changes.
 * If project-root is omitted, defaults to process.cwd().
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { listQuarantineHandler, quarantineTestHandler } from '../src/mcp/tools/quarantine';
import { retireQuarantineDeflaked } from '../src/services/flaky-quarantine';

export const DEFAULT_RUNS = 5;
/** The gate's fast-lane width — a quiet-box run cannot honestly decide a 1-of-N load-sensitivity signature. */
export const DEFAULT_CONCURRENCY = 6;

export interface LapsedRow {
  test: string;
  testFile: string | null;
  quarantinedAtSha: string;
  evidence: { runs: number; passRuns: number; failRuns: number };
  ttlExpiresAt: number;
  seededFrom: string | null;
}

export interface RerunOutcome {
  runs: number;
  passRuns: number;
  failRuns: number;
  error?: string;
}

export type QuarantineRerunner = (
  project: string,
  testFile: string,
  runs: number,
  concurrency: number,
) => Promise<RerunOutcome>;

export interface Decision {
  test: string;
  outcome: 'de-flaked' | 're-quarantined';
  runs: number;
  passRuns: number;
  failRuns: number;
  reason: string;
}

export interface LapsedRepairResult {
  lapsed: number;
  resolved: number;
  decisions: Decision[];
}

interface ListLapsedDeps {
  listQuarantine?: typeof listQuarantineHandler;
}

/**
 * Enumerate lapsed (expired) quarantine rows through the shipped read surface —
 * listQuarantineHandler with includeExpired:true, keeping only rows the handler itself
 * marks expired. Its resolved `testFile` is reused verbatim; this never re-derives it.
 */
export async function listLapsedQuarantineRows(
  project: string,
  deps: ListLapsedDeps = {},
): Promise<LapsedRow[]> {
  const listQuarantineFn = deps.listQuarantine ?? listQuarantineHandler;
  const raw = await listQuarantineFn({ project, includeExpired: true });
  const parsed = JSON.parse(raw) as {
    rows: Array<{
      test: string;
      testFile: string | null;
      quarantinedAtSha: string;
      evidence: { runs: number; passRuns: number; failRuns: number };
      ttlExpiresAt: number;
      seededFrom: string | null;
      expired: boolean;
    }>;
  };
  return parsed.rows
    .filter((r) => r.expired === true)
    .map((r) => ({
      test: r.test,
      testFile: r.testFile,
      quarantinedAtSha: r.quarantinedAtSha,
      evidence: r.evidence,
      ttlExpiresAt: r.ttlExpiresAt,
      seededFrom: r.seededFrom,
    }));
}

async function runOneAttempt(project: string, testFile: string): Promise<number> {
  const isUi = testFile.startsWith('ui/');
  const proc = isUi
    ? Bun.spawn(['npm', 'run', 'test:ci', '--', testFile.slice('ui/'.length)], {
        cwd: path.join(project, 'ui'),
        stdout: 'pipe',
        stderr: 'pipe',
      })
    : Bun.spawn(['bun', 'test', testFile], { cwd: project, stdout: 'pipe', stderr: 'pipe' });
  return await proc.exited;
}

/** The repo's real per-file gate invocation, run `runs` times with `concurrency` copies
 *  in flight (the same runner shape scripts/test-backend.ts spawns for the fast lane). */
export const defaultQuarantineRerunner: QuarantineRerunner = async (project, testFile, runs, concurrency) => {
  let passRuns = 0;
  let failRuns = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < runs) {
      cursor++;
      const code = await runOneAttempt(project, testFile);
      if (code === 0) passRuns++;
      else failRuns++;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, () => worker()));
  return { runs, passRuns, failRuns };
};

export interface RepairOpts {
  apply: boolean;
  runs?: number;
  concurrency?: number;
  sha: string;
  runner?: QuarantineRerunner;
}

interface RepairDeps extends ListLapsedDeps {
  quarantineTest?: typeof quarantineTestHandler;
  retireDeflaked?: typeof retireQuarantineDeflaked;
}

/**
 * Decide every lapsed row into exactly one of two outcomes:
 * - all re-runs green ⇒ de-flake (retireQuarantineDeflaked)
 * - any re-run fails, or the row is unrunnable (no resolvable test file / a runner error)
 *   ⇒ re-quarantine (quarantineTestHandler) with a fresh TTL.
 * Every lapsed row appears in `decisions` — never dropped, never a third outcome.
 * Under `apply:false` the runner still measures but no write path is invoked.
 */
export async function repairLapsedQuarantine(
  project: string,
  opts: RepairOpts,
  deps: RepairDeps = {},
): Promise<LapsedRepairResult> {
  const runs = opts.runs ?? DEFAULT_RUNS;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const runner = opts.runner ?? defaultQuarantineRerunner;
  const quarantineTestFn = deps.quarantineTest ?? quarantineTestHandler;
  const retireDeflakedFn = deps.retireDeflaked ?? retireQuarantineDeflaked;

  const lapsed = await listLapsedQuarantineRows(project, deps);
  const decisions: Decision[] = [];

  for (const row of lapsed) {
    if (!row.testFile) {
      if (opts.apply) {
        await quarantineTestFn({
          project,
          test: row.test,
          sha: row.quarantinedAtSha,
          ttlHours: 72,
          reason: 'repair-lapsed-quarantine: unrunnable (no resolvable test file); re-quarantined with existing evidence',
        });
      }
      decisions.push({
        test: row.test,
        outcome: 're-quarantined',
        runs: row.evidence.runs,
        passRuns: row.evidence.passRuns,
        failRuns: row.evidence.failRuns,
        reason: 'unrunnable: no resolvable test file',
      });
      continue;
    }

    let outcome: RerunOutcome;
    try {
      outcome = await runner(project, row.testFile, runs, concurrency);
    } catch (err) {
      outcome = { runs: 0, passRuns: 0, failRuns: 0, error: err instanceof Error ? err.message : String(err) };
    }

    if (outcome.error) {
      if (opts.apply) {
        await quarantineTestFn({
          project,
          test: row.test,
          sha: row.quarantinedAtSha,
          ttlHours: 72,
          reason: `repair-lapsed-quarantine: unrunnable (${outcome.error}); re-quarantined with existing evidence`,
        });
      }
      decisions.push({
        test: row.test,
        outcome: 're-quarantined',
        runs: row.evidence.runs,
        passRuns: row.evidence.passRuns,
        failRuns: row.evidence.failRuns,
        reason: `unrunnable: ${outcome.error}`,
      });
      continue;
    }

    if (outcome.failRuns > 0) {
      if (opts.apply) {
        await quarantineTestFn({
          project,
          test: row.test,
          sha: opts.sha,
          ttlHours: 72,
          reason: `repair-lapsed-quarantine: re-run flipped (${outcome.passRuns}/${outcome.runs} passed) — re-quarantined`,
        });
      }
      decisions.push({
        test: row.test,
        outcome: 're-quarantined',
        runs: outcome.runs,
        passRuns: outcome.passRuns,
        failRuns: outcome.failRuns,
        reason: `re-run flipped: ${outcome.passRuns}/${outcome.runs} passed`,
      });
    } else {
      if (opts.apply) {
        await retireDeflakedFn(project, row.test, {
          runs: outcome.runs,
          passRuns: outcome.passRuns,
          failRuns: outcome.failRuns,
          sha: opts.sha,
        });
      }
      decisions.push({
        test: row.test,
        outcome: 'de-flaked',
        runs: outcome.runs,
        passRuns: outcome.passRuns,
        failRuns: outcome.failRuns,
        reason: `all ${outcome.runs} re-runs green`,
      });
    }
  }

  return { lapsed: lapsed.length, resolved: decisions.length, decisions };
}

/** Nonzero when zero rows were resolved, or the resolved count didn't cover every lapsed
 *  row — so "repaired zero rows" (or a partial repair) can never read as success. */
export function repairExitCode(r: LapsedRepairResult): number {
  return r.resolved === 0 || r.resolved !== r.lapsed ? 1 : 0;
}

async function main() {
  const argv = process.argv.slice(2);
  let apply = false;
  let runs = DEFAULT_RUNS;
  let concurrency = DEFAULT_CONCURRENCY;
  let shaArg: string | null = null;
  let project = process.cwd();

  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg.startsWith('--runs=')) runs = Number(arg.slice('--runs='.length));
    else if (arg.startsWith('--concurrency=')) concurrency = Number(arg.slice('--concurrency='.length));
    else if (arg.startsWith('--sha=')) shaArg = arg.slice('--sha='.length);
    else if (!arg.startsWith('-')) project = arg;
  }

  const sha = shaArg ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project }).toString().trim();

  console.log(`\nRepair lapsed quarantine rows`);
  console.log(`   project: ${project}`);
  console.log(`   mode: ${apply ? 'apply' : 'dry-run'}`);
  console.log(`   runs=${runs} concurrency=${concurrency} sha=${sha}`);
  console.log('');

  const result = await repairLapsedQuarantine(project, { apply, runs, concurrency, sha });

  console.log(`Lapsed rows: ${result.lapsed}`);
  for (const d of result.decisions) {
    const label = d.outcome === 'de-flaked' ? 'DE-FLAKED' : 'RE-QUARANTINED';
    console.log(`  ${label} ${d.test}: ${d.reason} (runs=${d.runs} pass=${d.passRuns} fail=${d.failRuns})`);
  }

  console.log('');
  console.log(`Resolved: ${result.resolved}/${result.lapsed}`);
  console.log(apply ? 'REPAIR APPLIED' : 'DRY-RUN COMPLETE (pass --apply to write)');

  process.exit(repairExitCode(result));
}

if (import.meta.main) {
  main();
}
