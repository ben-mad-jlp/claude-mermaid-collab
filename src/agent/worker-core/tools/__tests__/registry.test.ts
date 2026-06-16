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
  it('implement gets the writer + search tools', () => {
    const ts = buildToolset('implement', { cwd });
    expect(Object.keys(ts).sort()).toEqual(['edit', 'glob', 'grep', 'read_file', 'run_bash', 'write_file']);
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

  it('exposes the wired tools (incl. the diagram-as-spec funnel)', () => {
    expect(WIRED_TOOLS.sort()).toEqual([
      'create_diagram',
      'edit',
      'get_diagram',
      'glob',
      'grep',
      'read_file',
      'run_bash',
      'run_bash_ro',
      'write_file',
    ]);
  });

  it('diagram tools require a collab project+session — skipped without one, present with one', () => {
    // No project/session → research omits the diagram tools (worktree-only / tests).
    const bare = buildToolset('research', { cwd });
    expect(bare).not.toHaveProperty('create_diagram');
    expect(bare).not.toHaveProperty('get_diagram');
    // With a collab project+session → research gets the diagram-as-spec tools.
    const full = buildToolset('research', { cwd, project: '/p', session: 's' });
    expect(full).toHaveProperty('create_diagram');
    expect(full).toHaveProperty('get_diagram');
    // create_diagram is non-mutating, so a read-only role (verify) may also hold get_diagram.
    const verify = buildToolset('verify', { cwd, project: '/p', session: 's' });
    expect(verify).toHaveProperty('get_diagram');
    expect(verify).not.toHaveProperty('write_file');
  });
});
