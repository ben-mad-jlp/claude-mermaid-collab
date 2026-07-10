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
  });

  it('exit non-zero (placebo) when the test PASSES under mutation, and leaves the tree clean', () => {
    // A placebo test that asserts a literal — never fails no matter what N is.
    const dir = makeRepo(
      `import {expect,test} from 'bun:test'; test('placebo', () => expect('x').toBe('x'));\n`,
    );
    repos.push(dir);
    const r = run(dir, 'src/val.ts', 's/N = 1/N = 2/', 'bun', 'test', 'val.test.ts');
    expect(r.code).not.toBe(0);
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no').trim()).toBe('');
  });

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
  });
});
