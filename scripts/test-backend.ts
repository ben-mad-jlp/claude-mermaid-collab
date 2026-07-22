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

const ROOT = path.resolve(import.meta.dir, '..');
const SRC = path.join(ROOT, 'src');

const args = process.argv.slice(2);
const concurrency = Number(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ?? '6');
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const baselinePath = args.find((a) => a.startsWith('--baseline='))?.split('=')[1];
const writeBaselinePath = args.find((a) => a.startsWith('--write-baseline='))?.split('=')[1];

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

let files = findBunTestFiles(SRC).sort();
if (filter) files = files.filter((f) => f.includes(filter));

if (files.length === 0) {
  console.error(`No bun:test files found${filter ? ` matching "${filter}"` : ''}.`);
  process.exit(1);
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
  const failingFiles = failed.map((f) => f.file);
  writeFileSync(writeBaselinePath, JSON.stringify({ generatedAt: new Date().toISOString(), failing: failingFiles }, null, 2));
  process.exit(0);
}

if (baselinePath) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baselineFailingSet = new Set(baseline.failing);
  const currentFailedSet = new Set(failed.map((f) => f.file));

  const netNew = failed.filter((f) => !baselineFailingSet.has(f.file));
  const netFixed = baseline.failing.filter((f: string) => !currentFailedSet.has(f));

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

  process.exit(netNew.length ? 1 : 0);
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
