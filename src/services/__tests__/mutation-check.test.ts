import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// from src/services/__tests__ → repo root → scripts/mutation-check.sh
const SCRIPT = join(import.meta.dir, '..', '..', '..', 'scripts', 'mutation-check.sh');

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** A temp git repo whose src/val.ts exports N=1, plus a test file that we vary. */
function makeRepo(testBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mccheck-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'val.ts'), 'export const N = 1;\n');
  writeFileSync(join(dir, 'val.test.ts'), testBody);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

function run(dir: string, file: string, mutation: string, ...cmd: string[]) {
  const r = spawnSync('bash', [SCRIPT, file, mutation, ...cmd], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function runNeutralize(dir: string, neutralize: string, file: string, mutation: string, ...cmd: string[]) {
  const r = spawnSync('bash', [SCRIPT, '--neutralize', neutralize, file, mutation, ...cmd], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function runPreState(dir: string, ref: string, file: string, mutation: string, ...cmd: string[]) {
  const r = spawnSync('bash', [SCRIPT, '--pre-state', ref, file, mutation, ...cmd], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

// Every case here shells out to mutation-check.sh, which itself spawns one or more
// full `bun test` runs in a throwaway git repo. That is tens of seconds of real work
// per case even on an idle box, and minutes when the build daemon is loading the host —
// far past bun's 5s default, which made this file red the base gate for every epic.
const SLOW = 600_000;

let repos: string[] = [];
beforeEach(() => { repos = []; });
afterEach(() => { for (const d of repos) rmSync(d, { recursive: true, force: true }); });

describe('mutation-check.sh', () => {
  it('exit 0 when a real test FAILS under mutation, and leaves the tree clean', () => {
    // A test that asserts N === 1. Mutating N to 2 must make it fail → the test caught it.
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; import {N} from './src/val'; test('n', () => expect(N).toBe(1));\n`,
    );
    repos.push(dir);
    const r = run(dir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(0);
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('exit non-zero (placebo) when the test PASSES under mutation, and leaves the tree clean', () => {
    // A placebo test that asserts a literal — never fails no matter what N is.
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; test('placebo', () => expect('x').toBe('x'));\n`,
    );
    repos.push(dir);
    const r = run(dir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).not.toBe(0);
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('refuses (exit 2) on a dirty tree without mutating', () => {
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; test('t', () => expect(1).toBe(1));\n`,
    );
    repos.push(dir);
    writeFileSync(join(dir, 'src', 'val.ts'), 'export const N = 99;\n'); // dirty it
    const r = run(dir, 'src/val.ts', 's/N = 99/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(2);
    // still exactly our manual dirty edit — the script did not touch it
    expect(git(dir, 'diff', 'src/val.ts')).toContain('N = 99');
  }, SLOW);

  it('exit 3 (VACUOUS) when the test already fails on the unmutated tree', () => {
    // A test that fails regardless of N — never references val.ts's N at all.
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; test('always-fails', () => expect(1).toBe(2));\n`,
    );
    repos.push(dir);
    const r = run(dir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(3);
    expect(r.out).toContain('VACUOUS');
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('pins the exact OK/PLACEBO codes through the PRE_CODE gate', () => {
    const soundDir = makeRepo(
      `import {expect,test} from 'bun:test'; import {N} from './src/val'; test('n', () => expect(N).toBe(1));\n`,
    );
    repos.push(soundDir);
    const soundResult = run(soundDir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(soundResult.code).toBe(0);
    expect(git(soundDir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');

    const placeboDir = makeRepo(
      `import {expect,test} from 'bun:test'; test('placebo', () => expect('x').toBe('x'));\n`,
    );
    repos.push(placeboDir);
    const placeboResult = run(placeboDir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(placeboResult.code).toBe(1);
    expect(git(placeboDir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('exit 4 (VACUOUS FIXTURE) when the test passes even with the subject deleted', () => {
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; import * as val from './src/val'; test('degenerate', () => expect(typeof val.N === 'number' || true).toBe(true));\n`,
    );
    repos.push(dir);
    const r = runNeutralize(dir, 'delete', 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(4);
    expect(r.out).toContain('VACUOUS FIXTURE');
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('exit 0 for a sound fixture when neutralized (deletion makes the import fail, not a vacuous pass)', () => {
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; import {N} from './src/val'; test('n', () => expect(N).toBe(1));\n`,
    );
    repos.push(dir);
    const r = runNeutralize(dir, 'delete', 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('VACUOUS FIXTURE');
  }, SLOW);

  it('exit 5 (PRE-SATISFIED) when the assertion already holds against the file pre-state', () => {
    // Degenerate fixture (as in the exit-4 case): its assertion holds regardless of which
    // commit's val.ts is checked out, so it's already satisfied on the pre-state commit too.
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; import * as val from './src/val'; test('degenerate', () => expect(typeof val.N === 'number' || true).toBe(true));\n`,
    );
    repos.push(dir);
    const preStateRef = git(dir, 'rev-parse', 'HEAD').trim();
    // The "change under proof": a new commit that bumps N. The fixture doesn't care.
    writeFileSync(join(dir, 'src', 'val.ts'), 'export const N = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'bump N');
    const r = runPreState(dir, preStateRef, 'src/val.ts', 's/N = 2/N = 3/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(5);
    expect(r.out).toContain('PRE-SATISFIED');
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('does NOT exit 5 when the test correctly fails on the pre-state', () => {
    // A sound fixture that depends on the current-HEAD value: it fails when val.ts is
    // temporarily rewound to the pre-state commit (N=1), since the assertion expects N=2.
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; import {N} from './src/val'; test('n', () => expect(N).toBe(2));\n`,
    );
    repos.push(dir);
    const preStateRef = git(dir, 'rev-parse', 'HEAD').trim(); // N=1 here
    writeFileSync(join(dir, 'src', 'val.ts'), 'export const N = 2;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'bump N');
    const r = runPreState(dir, preStateRef, 'src/val.ts', 's/N = 2/N = 3/', 'bun', 'test', 'val.test.ts');
    expect(r.code).not.toBe(5);
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  }, SLOW);

  it('backward compat: the degenerate fixture through the plain (non-neutralize) path still yields PLACEBO (exit 1)', () => {
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; import * as val from './src/val'; test('degenerate', () => expect(typeof val.N === 'number' || true).toBe(true));\n`,
    );
    repos.push(dir);
    const r = run(dir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).toBe(1);
  }, SLOW);
});
