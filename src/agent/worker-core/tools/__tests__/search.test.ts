import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grepOp, globOp, globToRegExp } from '../search';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wc-search-'));
  mkdirSync(join(cwd, 'src/sub'), { recursive: true });
  mkdirSync(join(cwd, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(cwd, 'src/a.ts'), 'export const foo = 1;\nconst bar = 2;');
  writeFileSync(join(cwd, 'src/sub/b.ts'), 'import { foo } from "../a";');
  writeFileSync(join(cwd, 'src/c.js'), 'const foo = 3;');
  writeFileSync(join(cwd, 'node_modules/pkg/index.ts'), 'export const foo = 99;'); // must be ignored
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it('* stays within a path segment', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false);
  });
  it('** crosses directories', () => {
    expect(globToRegExp('**/*.ts').test('src/sub/b.ts')).toBe(true);
  });
});

describe('grepOp', () => {
  it('finds matches across the tree and ignores node_modules', () => {
    const r = grepOp(cwd, 'foo') as { matches: { file: string }[] };
    const files = r.matches.map((m) => m.file).sort();
    expect(files).toEqual(['src/a.ts', 'src/c.js', 'src/sub/b.ts']);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
  });
  it('restricts by glob', () => {
    const r = grepOp(cwd, 'foo', { glob: '**/*.ts' }) as { matches: { file: string }[] };
    expect(r.matches.every((m) => m.file.endsWith('.ts'))).toBe(true);
    expect(r.matches.some((m) => m.file.endsWith('.js'))).toBe(false);
  });
  it('returns an error for an invalid regex', () => {
    expect(grepOp(cwd, '(')).toEqual({ error: expect.stringMatching(/invalid regex/) });
  });
});

describe('globOp', () => {
  it('lists matching files, ignoring node_modules', () => {
    const r = globOp(cwd, '**/*.ts');
    expect(r.files.sort()).toEqual(['src/a.ts', 'src/sub/b.ts']);
  });
});
