#!/usr/bin/env bun
/**
 * Backend test runner (Bun-native).
 *
 * Backend tests share on-disk state (SQLite DBs / temp dirs at fixed paths), so
 * they require per-FILE process isolation — running them all in one `bun test`
 * process bleeds state across files and produces a shifting set of failures
 * (each file passes alone). `bun test` has no per-file isolation flag, so we
 * spawn one `bun test <file>` process per file, with bounded concurrency.
 *
 * Scope: every *.test.ts under src/ that imports `bun:test`. Legacy vitest-only
 * backend tests (no `bun:test` import) are intentionally NOT run here — the
 * backend suite is Bun-only. The UI suite remains on vitest (ui/).
 *
 * Usage: bun run scripts/test-backend.ts [--concurrency=N] [pathFilter]
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { QUARANTINE_SEGMENT } from '../src/services/quarantine.ts';
import { partitionTestLanes } from '../src/services/nested-runner-lane.ts';
import path from 'path';
import { extractFailingTests } from '../src/services/gate-runner';

const ROOT = path.resolve(import.meta.dir, '..');

export const DEFAULT_TEST_ROOTS = [path.join(ROOT, 'src'), path.join(ROOT, 'desktop', 'src')];

export interface BaselineFileEntryV2 {
  file: string;
  failingTests: string[];
  count: number;
}
export interface BaselineV2 {
  generatedAt: string;
  schema: 2;
  files: BaselineFileEntryV2[];
}
export interface LegacyBaseline {
  generatedAt?: string;
  failing: string[];
}

/** Diff a set of currently-failed backend test files against a (possibly legacy) baseline,
 *  reporting net-new failing files, net-fixed files, and per-file failing-test COUNT GROWTH
 *  on files that were already baselined (so a baselined file gaining new failures isn't
 *  silently absorbed as "still just failing"). */
export function diffAgainstBaseline(
  failed: { file: string; output: string }[],
  baseline: BaselineV2 | LegacyBaseline,
): {
  netNew: { file: string; output: string }[];
  netFixed: string[];
  countGrowth: { file: string; baselineCount: number; currentCount: number; newNames: string[] }[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const isV2 = 'schema' in baseline && (baseline as BaselineV2).schema === 2;

  let baselineFileNames: string[];
  let entries: BaselineFileEntryV2[];
  const legacyFiles = new Set<string>();
  if (isV2) {
    const v2 = baseline as BaselineV2;
    baselineFileNames = v2.files.map((f) => f.file);
    entries = v2.files;
  } else {
    const legacy = baseline as LegacyBaseline;
    baselineFileNames = legacy.failing ?? [];
    entries = baselineFileNames.map((file) => {
      warnings.push(
        `baseline: legacy file-shaped entry for ${file} — count growth cannot be checked (regenerate with --write-baseline)`,
      );
      legacyFiles.add(file);
      return { file, failingTests: [], count: 0 };
    });
  }

  const baselineMap = new Map(entries.map((e) => [e.file, e]));
  const currentFileSet = new Set(failed.map((f) => f.file));

  const netNew = failed.filter((f) => !baselineMap.has(f.file));
  const netFixed = baselineFileNames.filter((f) => !currentFileSet.has(f));

  const countGrowth: { file: string; baselineCount: number; currentCount: number; newNames: string[] }[] = [];
  for (const f of failed) {
    const entry = baselineMap.get(f.file);
    if (!entry) continue;
    if (legacyFiles.has(f.file)) continue;
    const currentTests = extractFailingTests(f.output);
    const hasNewName = entry.failingTests.length > 0 && currentTests.some((n) => !entry.failingTests.includes(n));
    const grew = currentTests.length > entry.count || hasNewName;
    if (grew) {
      countGrowth.push({
        file: f.file,
        baselineCount: entry.count,
        currentCount: currentTests.length,
        newNames: currentTests.filter((n) => !entry.failingTests.includes(n)),
      });
    }
  }

  return { netNew, netFixed, countGrowth, warnings };
}

/** Type for injectable test runner (allows testing without real process spawning). */
export type BackendTestRunner = (file: string, timeoutMs: number) => Promise<{ code: number; output: string }>;

/**
 * Walk test roots and partition files into fast (bounded concurrency), serial (single-threaded),
 * and nested (sequential for nested runners) lanes. Applies the same filter substring behavior
 * main() has, and returns all three partitions separately without merging.
 */
export function collectBackendTestFiles(
  roots: string[] = DEFAULT_TEST_ROOTS,
  filter?: string | readonly string[],
): { fast: string[]; serial: string[]; nested: string[] } {
  let files = roots.flatMap((root) => findBunTestFiles(root)).sort();
  const filters = filter == null ? [] : Array.isArray(filter) ? filter : [filter];
  if (filters.length) files = files.filter((f) => filters.some((sel) => f.includes(sel)));

  const { fast, serial, nested } = partitionTestLanes(files, (f) => readFileSync(f, 'utf8'));
  return { fast, serial, nested };
}

/**
 * Run test files through three lanes: fast (bounded concurrency pool), serial (sequential at PER_TEST_TIMEOUT_MS),
 * and nested (sequential at nestedTimeoutMs). Skips whichever lanes opts.lane excludes, but always returns
 * ranFast/ranSerial/ranNested counts.
 */
export async function runLanes(opts: {
  lane: 'fast' | 'nested' | 'serial' | 'all';
  fast: string[];
  serial: string[];
  nested: string[];
  concurrency: number;
  timeoutMs: number;
  nestedTimeoutMs: number;
  runner: BackendTestRunner;
}): Promise<{
  failed: { file: string; output: string }[];
  ranFast: string[];
  ranSerial: string[];
  ranNested: string[];
}> {
  const failed: { file: string; output: string }[] = [];
  const ranFast: string[] = [];
  const ranSerial: string[] = [];
  const ranNested: string[] = [];

  // Fast lane: bounded concurrency pool
  if (opts.lane === 'fast' || opts.lane === 'all') {
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < opts.fast.length) {
        const i = cursor++;
        const file = opts.fast[i];
        ranFast.push(file);
        const result = await opts.runner(file, opts.timeoutMs);
        if (result.code !== 0) {
          failed.push({ file: path.relative(ROOT, file), output: result.output });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.fast.length) }, () => worker()));
  }

  // Serial lane: sequential (concurrency 1) at standard timeout
  if (opts.lane === 'fast' || opts.lane === 'serial' || opts.lane === 'all') {
    for (const file of opts.serial) {
      ranSerial.push(file);
      const result = await opts.runner(file, opts.timeoutMs);
      if (result.code !== 0) {
        failed.push({ file: path.relative(ROOT, file), output: result.output });
      }
    }
  }

  // Nested lane: sequential (concurrency 1) at nested timeout
  if (opts.lane === 'nested' || opts.lane === 'all') {
    for (const file of opts.nested) {
      ranNested.push(file);
      const result = await opts.runner(file, opts.nestedTimeoutMs);
      if (result.code !== 0) {
        failed.push({ file: path.relative(ROOT, file), output: result.output });
      }
    }
  }

  return { failed, ranFast, ranSerial, ranNested };
}

/** Restrict a lane partition to an EXACT requested file set (repo-relative or absolute
 *  paths). Lane classification is preserved — a serial/nested file stays in its lane.
 *  Requested paths that are not collected bun:test candidates come back as `missing`
 *  (typo'd path, vitest-only file, quarantined) so the caller can surface them instead of
 *  silently running less than asked. */
export function restrictToRequestedFiles(
  partition: { fast: string[]; serial: string[]; nested: string[] },
  requested: string[],
): { fast: string[]; serial: string[]; nested: string[]; missing: string[] } {
  const wanted = new Set(requested.map((p) => path.resolve(ROOT, p)));
  const keep = (files: string[]) => files.filter((f) => wanted.has(path.resolve(f)));
  const fast = keep(partition.fast);
  const serial = keep(partition.serial);
  const nested = keep(partition.nested);
  const collected = new Set([...fast, ...serial, ...nested].map((f) => path.resolve(f)));
  const missing = requested.filter((p) => !collected.has(path.resolve(ROOT, p)));
  return { fast, serial, nested, missing };
}

function findBunTestFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      // QUARANTINE: red-by-design repros (services/quarantine.ts). The regression floor is the
      // base gate — a quarantined test landing here would red every epic project-wide, which is
      // the exact thing quarantine exists to prevent.
      if (e.name === QUARANTINE_SEGMENT) continue;
      findBunTestFiles(full, out);
    } else if (/\.test\.tsx?$/.test(e.name)) {
      try {
        if (/from ['"]bun:test['"]/.test(readFileSync(full, 'utf8'))) out.push(full);
      } catch {
        /* unreadable — skip */
      }
    }
  }
  return out;
}

if (import.meta.main) {
  await main();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '6');
  const filterArgs = args.filter((a) => !a.startsWith('--'));
  const filter = filterArgs.length ? filterArgs : undefined;
  const baselinePath = args.find((a) => a.startsWith('--baseline='))?.split('=')[1];
  const writeBaselinePath = args.find((a) => a.startsWith('--write-baseline='))?.split('=')[1];
  const lane = (args.find((a) => a.startsWith('--lane='))?.split('=')[1] ?? 'all') as 'fast' | 'nested' | 'serial' | 'all';
  const nestedTimeoutMs = Number(
    args.find((a) => a.startsWith('--nested-timeout='))?.split('=')[1] ?? process.env.NESTED_LANE_TIMEOUT_MS ?? '900000',
  );

  let { fast, serial, nested } = collectBackendTestFiles(DEFAULT_TEST_ROOTS, filter);

  // --files=<comma-separated repo-relative paths>: run ONLY these test files (the land
  // gate's impacted-set floor). Exact-path match, lanes preserved. Absent ⇒ behavior is
  // byte-identical to before the flag existed. Note: with a subset run, the baseline's
  // "FIXED" report is meaningless (unrun files look fixed) — only netNew/countGrowth
  // gate the exit code, and those only cover files actually run.
  const filesArg = args.find((a) => a.startsWith('--files='))?.split('=')[1];
  if (filesArg != null) {
    const requested = filesArg.split(',').map((s) => s.trim()).filter(Boolean);
    const restricted = restrictToRequestedFiles({ fast, serial, nested }, requested);
    ({ fast, serial, nested } = restricted);
    if (restricted.missing.length > 0) {
      console.log(`--files: ${restricted.missing.length} requested file(s) are not bun:test candidates (skipped):`);
      for (const m of restricted.missing) console.log(`  ? ${m}`);
    }
  }

  // Report collected files
  if (nested.length > 0) {
    console.log(`Nested-runner files (${nested.length}):`);
    for (const f of nested) {
      console.log(`  ${path.relative(ROOT, f)}`);
    }
  }

  // Check if there are files to run for the requested lane
  const filesToRun =
    lane === 'fast' ? [...fast, ...serial] : lane === 'nested' ? nested : lane === 'serial' ? serial : [...fast, ...serial, ...nested];
  if (filesToRun.length === 0) {
    console.error(`No bun:test files found${filterArgs.length ? ` matching "${filterArgs.join(', ')}"` : ''}.`);
    process.exit(1);
  }

  // Report skipped files if running only fast
  if (lane === 'fast' && nested.length > 0) {
    console.log(`\nSkipping ${nested.length} nested-runner file(s) — run \`npm run test:backend:nested\``);
  }

  // Gate on a clean desktop typecheck before running any backend test files, so a type break
  // under desktop/src fails test:backend / test:backend:floor independently of the per-leaf gate.
  {
    const proc = Bun.spawn(['npx', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
      cwd: path.join(ROOT, 'desktop'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    if (code !== 0) {
      console.log(`\n✗ desktop typecheck FAILED:\n`);
      console.log((err + out).trim().split('\n').slice(-20).join('\n'));
      process.exit(1);
    }
    console.log('✓ desktop typecheck passed\n');
  }

  const totalFiles =
    lane === 'fast'
      ? fast.length + serial.length
      : lane === 'nested'
        ? nested.length
        : lane === 'serial'
          ? serial.length
          : fast.length + serial.length + nested.length;

  let laneLabel =
    lane === 'all'
      ? `all (${fast.length} fast + ${serial.length} serial + ${nested.length} nested)`
      : lane === 'fast'
        ? `fast (${fast.length} @ ${concurrency}x + ${serial.length} serial)`
        : lane;

  const concurrencyNote =
    lane === 'fast' && serial.length > 0
      ? ` (${concurrency} at a time for fast, 1 at a time for serial)`
      : lane === 'all'
        ? ` (${concurrency} at a time for fast, 1 at a time for serial+nested)`
        : ` (${lane === 'serial' || lane === 'nested' ? '1 at a time' : `${concurrency} at a time`})`;

  console.log(
    `Running ${totalFiles} backend test file(s) [lane: ${laneLabel}] under bun${concurrencyNote} (per-file isolation)…\n`,
  );

  const PER_TEST_TIMEOUT_MS = Number(
    args.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? process.env.BACKEND_TEST_TIMEOUT_MS ?? '30000',
  );

  let done = 0;
  const totalToRun =
    lane === 'fast'
      ? fast.length + serial.length
      : lane === 'nested'
        ? nested.length
        : lane === 'serial'
          ? serial.length
          : fast.length + serial.length + nested.length;

  // Create a real BackendTestRunner that wraps Bun.spawn
  const runner: BackendTestRunner = async (file: string, timeoutMs: number) => {
    const rel = path.relative(ROOT, file);
    // bun's default per-test timeout is 5000ms. This pool runs `concurrency` bun processes at
    // once, and the git/subprocess-heavy suites (rescue-ref, mutation-check, reconcile-pass,
    // leaf-executor) routinely exceed 5s purely from machine contention — producing a RED base
    // gate whose failing test NAMES rotate run to run. Raise the per-test ceiling so a timeout
    // means "hung", not "the box was busy".
    // Use process.execPath to resolve the interpreter independent of PATH, avoiding ENOENT if
    // PATH is stripped or modified (bugfix 7dc5f49a).
    const proc = Bun.spawn([process.execPath, 'test', '--timeout', String(timeoutMs), '--preload', './src/testing/hermetic-tripwire.ts', file], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    done++;
    const status = code === 0 ? '✓' : '✗';
    console.log(`  ${status} (${done}/${totalToRun}) ${rel}`);
    return { code, output: (err + out).trim() };
  };

  const { failed } = await runLanes({
    lane,
    fast,
    serial,
    nested,
    concurrency,
    timeoutMs: PER_TEST_TIMEOUT_MS,
    nestedTimeoutMs,
    runner,
  });

  console.log(`\n${totalFiles - failed.length}/${totalFiles} files passed.`);

  if (writeBaselinePath) {
    const baselineFiles: BaselineFileEntryV2[] = failed.map((f) => {
      const failingTests = extractFailingTests(f.output);
      return { file: f.file, failingTests, count: failingTests.length };
    });
    const out: BaselineV2 = { generatedAt: new Date().toISOString(), schema: 2, files: baselineFiles };
    writeFileSync(writeBaselinePath, JSON.stringify(out, null, 2));
    process.exit(0);
  }

  if (baselinePath) {
    let baseline: BaselineV2 | LegacyBaseline;
    try {
      baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    } catch (e) {
      console.log(`\nbaseline: could not parse ${baselinePath} (${(e as Error).message}) — falling back to legacy behavior\n`);
      baseline = { failing: [] };
    }

    const { netNew, netFixed, countGrowth, warnings } = diffAgainstBaseline(failed, baseline);

    for (const w of warnings) {
      console.log(`\n${w}`);
    }

    if (netNew.length > 0) {
      console.log(`\n${netNew.length} new file(s) FAILED:\n`);
      for (const f of netNew) {
        console.log(`──────── ${f.file} ────────`);
        console.log(f.output.split('\n').slice(-12).join('\n'));
        console.log('');
      }
    }

    if (netFixed.length > 0) {
      console.log(`\n${netFixed.length} file(s) FIXED:\n`);
      for (const f of netFixed) {
        console.log(`  ✓ ${f}`);
      }
      console.log('');
    }

    if (countGrowth.length > 0) {
      console.log(`\n${countGrowth.length} baselined file(s) gained failing test(s):\n`);
      for (const g of countGrowth) {
        console.log(`──────── ${g.file} ────────`);
        console.log(`  baselined ${g.baselineCount} → current ${g.currentCount}`);
        if (g.newNames.length > 0) {
          for (const n of g.newNames) console.log(`  + ${n}`);
        }
        console.log('');
      }
    }

    process.exit(netNew.length || countGrowth.length ? 1 : 0);
  }

  if (failed.length) {
    console.log(`\n${failed.length} file(s) FAILED:\n`);
    for (const f of failed) {
      console.log(`──────── ${f.file} ────────`);
      console.log(f.output.split('\n').slice(-12).join('\n'));
      console.log('');
    }
    process.exit(1);
  }
}
