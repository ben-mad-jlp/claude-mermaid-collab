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
import path from 'path';
import { extractFailingTests } from '../src/services/gate-runner';

const ROOT = path.resolve(import.meta.dir, '..');

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

function findBunTestFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
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
  const TEST_ROOTS = [path.join(ROOT, 'src'), path.join(ROOT, 'desktop', 'src')];

  const args = process.argv.slice(2);
  const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '6');
  const filter = args.find((a) => !a.startsWith('--')) ?? '';
  const baselinePath = args.find((a) => a.startsWith('--baseline='))?.split('=')[1];
  const writeBaselinePath = args.find((a) => a.startsWith('--write-baseline='))?.split('=')[1];

  let files = TEST_ROOTS.flatMap((root) => findBunTestFiles(root)).sort();
  if (filter) files = files.filter((f) => f.includes(filter));

  if (files.length === 0) {
    console.error(`No bun:test files found${filter ? ` matching "${filter}"` : ''}.`);
    process.exit(1);
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

  console.log(`Running ${files.length} backend test file(s) under bun, ${concurrency} at a time (per-file isolation)…\n`);

  const failed: { file: string; output: string }[] = [];
  let done = 0;

  async function runOne(file: string): Promise<void> {
    const rel = path.relative(ROOT, file);
    const proc = Bun.spawn(['bun', 'test', '--preload', './src/testing/hermetic-tripwire.ts', file], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    done++;
    if (code === 0) {
      console.log(`  ✓ (${done}/${files.length}) ${rel}`);
    } else {
      console.log(`  ✗ (${done}/${files.length}) ${rel}`);
      failed.push({ file: rel, output: (err + out).trim() });
    }
  }

  // Simple bounded-concurrency worker pool.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < files.length) {
      const i = cursor++;
      await runOne(files[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));

  console.log(`\n${files.length - failed.length}/${files.length} files passed.`);

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
