import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safePath, readFileOp, writeFileOp, editFileOp } from '../fs-ops';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wc-fsops-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('safePath', () => {
  it('allows the root and paths beneath it', () => {
    expect(safePath(cwd, 'a/b.ts')).toBe(join(cwd, 'a/b.ts'));
    expect(safePath(cwd, '.')).toBe(cwd);
  });
  it('rejects traversal out of the worktree', () => {
    expect(() => safePath(cwd, '../escape.ts')).toThrow(/escapes the worktree/);
    expect(() => safePath(cwd, '/etc/passwd')).toThrow(/escapes the worktree/);
  });
  it('rejects a sibling-prefix escape (cwd-other)', () => {
    expect(() => safePath(cwd, `../${cwd.split('/').pop()}-other/x`)).toThrow(/escapes/);
  });
});

describe('writeFileOp + readFileOp', () => {
  it('writes (with parent dirs) then reads back line-numbered', () => {
    expect(writeFileOp(cwd, 'src/a.ts', 'one\ntwo')).toEqual({ ok: true, path: 'src/a.ts' });
    expect(existsSync(join(cwd, 'src/a.ts'))).toBe(true);
    const r = readFileOp(cwd, 'src/a.ts');
    expect(r).toMatchObject({ path: 'src/a.ts', text: '1: one\n2: two', totalLines: 2 });
  });
  it('readFileOp returns an error for a missing file (does not throw)', () => {
    expect(readFileOp(cwd, 'nope.ts')).toEqual({ error: 'no such file: nope.ts' });
  });
});

describe('editFileOp', () => {
  it('applies a unique edit', () => {
    writeFileSync(join(cwd, 'x.ts'), 'const a = 1;\nconst b = 2;');
    expect(editFileOp(cwd, 'x.ts', 'const a = 1;', 'const a = 9;')).toEqual({ ok: true, path: 'x.ts' });
    expect(readFileSync(join(cwd, 'x.ts'), 'utf8')).toBe('const a = 9;\nconst b = 2;');
  });
  it('returns an error (and does NOT write) on an ambiguous match', () => {
    writeFileSync(join(cwd, 'y.ts'), 'foo foo');
    const r = editFileOp(cwd, 'y.ts', 'foo', 'bar');
    expect(r).toHaveProperty('error');
    expect(readFileSync(join(cwd, 'y.ts'), 'utf8')).toBe('foo foo'); // untouched
  });
  it('returns an error for a missing file', () => {
    expect(editFileOp(cwd, 'nope.ts', 'a', 'b')).toEqual({ error: 'no such file: nope.ts' });
  });
});
