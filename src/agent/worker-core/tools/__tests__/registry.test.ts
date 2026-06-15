import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildToolset, WIRED_TOOLS } from '../registry';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wc-registry-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('buildToolset', () => {
  it('implement gets the writer tools', () => {
    const ts = buildToolset('implement', { cwd });
    expect(Object.keys(ts).sort()).toEqual(['edit', 'read_file', 'run_bash', 'write_file']);
  });

  it('verify (read-only) gets read tools but NO writer/mutating tools', () => {
    const ts = buildToolset('verify', { cwd });
    expect(ts).toHaveProperty('read_file');
    expect(ts).toHaveProperty('run_bash_ro');
    expect(ts).not.toHaveProperty('write_file');
    expect(ts).not.toHaveProperty('edit');
    expect(ts).not.toHaveProperty('run_bash');
  });

  it('a wired tool actually executes against the worktree', async () => {
    writeFileSync(join(cwd, 'a.ts'), 'hello\nworld');
    const ts = buildToolset('implement', { cwd });
    const out = await (ts.read_file as { execute: (a: unknown, o: unknown) => Promise<string> }).execute(
      { path: 'a.ts' },
      {},
    );
    const parsed = JSON.parse(out);
    expect(parsed.text).toBe('1: hello\n2: world');
    expect(parsed.totalLines).toBe(2);
  });

  it('only wired tools are exposed (grep/glob/diagrams pending)', () => {
    expect(WIRED_TOOLS.sort()).toEqual(['edit', 'read_file', 'run_bash', 'run_bash_ro', 'write_file']);
  });
});
