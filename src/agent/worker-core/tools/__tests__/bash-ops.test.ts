import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bashOp } from '../bash-ops';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wc-bash-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('bashOp', () => {
  it('runs a command in the worktree and captures exit + output', () => {
    writeFileSync(join(cwd, 'note.txt'), 'hello');
    const r = bashOp(cwd, 'cat note.txt');
    expect(r).toEqual({ exit: 0, output: 'hello' });
  });

  it('propagates a non-zero exit', () => {
    const r = bashOp(cwd, 'exit 3') as { exit: number };
    expect(r.exit).toBe(3);
  });

  it('rejects an absolute cd (worktree escape)', () => {
    expect(bashOp(cwd, 'cd /etc && ls')).toEqual({
      error: expect.stringMatching(/do not cd to absolute paths/),
    });
  });

  it('read-only blocks obvious mutators but allows reads', () => {
    expect(bashOp(cwd, 'rm -rf x', { readOnly: true })).toHaveProperty('error');
    expect(bashOp(cwd, 'git commit -m x', { readOnly: true })).toHaveProperty('error');
    expect(bashOp(cwd, 'echo ok', { readOnly: true })).toEqual({ exit: 0, output: 'ok\n' });
  });

  it('non-read-only allows mutators', () => {
    const r = bashOp(cwd, 'echo hi > f.txt && cat f.txt');
    expect(r).toEqual({ exit: 0, output: 'hi\n' });
  });
});
