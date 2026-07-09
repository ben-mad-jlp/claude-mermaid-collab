/**
 * Unit tests for the G2 mechanical gate (leaf-gate.ts): `final = mechanical AND llm`.
 * No real spawn — GateSpawn is a stub in every test. No live worktree/git is touched.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveLeafGate,
  composeVerdict,
  runLeafGate,
  runBaseGate,
  gateFindingsText,
  type GateSpawn,
  type LeafGateConfig,
} from '../leaf-gate';
import type { LeafReviewVerdict } from '../leaf-executor';
import type { ProjectManifest } from '../../config/project-manifest';

const STATES: LeafReviewVerdict[] = ['pass', 'fail', 'error'];

describe('composeVerdict (the lattice: final = mechanical AND llm)', () => {
  it('pass iff BOTH mechanical and llm are pass — exhaustive over the 3x4 grid', () => {
    for (const mech of STATES) {
      for (const llm of [...STATES, null] as Array<LeafReviewVerdict | null>) {
        const result = composeVerdict(mech, llm);
        const expectedPass = mech === 'pass' && llm === 'pass';
        expect(result === 'pass').toBe(expectedPass);
      }
    }
  });

  it('a mechanical fail/error is FINAL — the llm verdict is never consulted (ignored even if pass)', () => {
    expect(composeVerdict('fail', 'pass')).toBe('fail'); // the 84048309 shape
    expect(composeVerdict('error', 'pass')).toBe('error');
    expect(composeVerdict('fail', null)).toBe('fail');
    expect(composeVerdict('error', null)).toBe('error');
  });

  it('a legal veto: mechanical pass + llm fail ⇒ fail', () => {
    expect(composeVerdict('pass', 'fail')).toBe('fail');
  });

  it('an unconsulted llm cannot RATIFY a mechanical pass', () => {
    expect(composeVerdict('pass', null)).toBe('error');
  });

  it('mechanical pass + llm error ⇒ error', () => {
    expect(composeVerdict('pass', 'error')).toBe('error');
  });

  it('mechanical pass + llm pass ⇒ pass', () => {
    expect(composeVerdict('pass', 'pass')).toBe('pass');
  });
});

describe('resolveLeafGate', () => {
  it('null manifest ⇒ null', () => {
    expect(resolveLeafGate(null)).toBeNull();
  });

  it('manifest with no gate block ⇒ null', () => {
    expect(resolveLeafGate({ version: 1 } as ProjectManifest)).toBeNull();
  });

  it('empty gate object ⇒ null', () => {
    expect(resolveLeafGate({ version: 1, gate: {} } as ProjectManifest)).toBeNull();
  });

  it('whitespace-only commands ⇒ null (nothing survives trimming)', () => {
    expect(resolveLeafGate({ version: 1, gate: { typecheck: '   ', test: '' } } as ProjectManifest)).toBeNull();
  });

  it('a real typecheck command survives, trimmed', () => {
    const g = resolveLeafGate({ version: 1, gate: { typecheck: '  npx tsc --noEmit  ' } } as ProjectManifest);
    expect(g).toEqual({ typecheck: 'npx tsc --noEmit', test: undefined, testCwd: undefined, baseTest: undefined });
  });
});

/** Builds a scripted GateSpawn: keyed by exact command string, records every call. */
function stubSpawn(script: Record<string, { ran: boolean; code?: number; output?: string }>) {
  const calls: Array<{ cwd: string; command: string }> = [];
  const spawn: GateSpawn = async (cwd, command) => {
    calls.push({ cwd, command });
    const s = script[command];
    if (!s) throw new Error(`unscripted command: ${command}`);
    return { ran: s.ran, code: s.code ?? 0, output: s.output ?? '' };
  };
  return { spawn, calls };
}

describe('runLeafGate', () => {
  it('no config ⇒ pass, declared:false, spawn never called', async () => {
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/wt', null, [], spawn);
    expect(r).toEqual({ status: 'pass', output: '', reasons: ['gate: none declared'], declared: false });
    expect(calls.length).toBe(0);
  });

  it('typecheck exits 0, no test declared ⇒ pass', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 0 } });
    const r = await runLeafGate('/wt', cfg, [], spawn);
    expect(r.status).toBe('pass');
    expect(r.declared).toBe(true);
  });

  it('typecheck exits 1 ⇒ fail, command + output carried', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 1, output: 'x.ts(1,1): error TS1234' } });
    const r = await runLeafGate('/wt', cfg, [], spawn);
    expect(r.status).toBe('fail');
    expect(r.command).toBe('tsc');
    expect(r.output).toContain('TS1234');
  });

  it('typecheck ran:false ⇒ error, not fail', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({ tsc: { ran: false, output: 'ENOENT' } });
    const r = await runLeafGate('/wt', cfg, [], spawn);
    expect(r.status).toBe('error');
  });

  it('test declared, changeSet null ⇒ error (never guesses)', async () => {
    const cfg: LeafGateConfig = { test: 'bun test {file}' };
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/wt', cfg, null, spawn);
    expect(r.status).toBe('error');
    expect(calls.length).toBe(0);
  });

  it('test declared, change-set has no spec files ⇒ pass, test command never spawned', async () => {
    const cfg: LeafGateConfig = { test: 'bun test {file}' };
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/wt', cfg, ['src/index.ts', 'README.md'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(0);
  });

  it('two spec files in the change-set ⇒ spawned twice, once per file, {file} substituted', async () => {
    const cfg: LeafGateConfig = { test: 'bun test {file}' };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: true, code: 0 },
      "bun test 'src/b.test.ts'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts', 'src/b.test.ts', 'src/other.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.map((c) => c.command)).toEqual(["bun test 'src/a.test.ts'", "bun test 'src/b.test.ts'"]);
  });

  it('one spec fails, the other still runs ⇒ fail carries both', async () => {
    const cfg: LeafGateConfig = { test: 'bun test {file}' };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: true, code: 1, output: 'FAIL a' },
      "bun test 'src/b.test.ts'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts', 'src/b.test.ts'], spawn);
    expect(r.status).toBe('fail');
    expect(calls.length).toBe(2); // both ran despite the first failing
  });

  it('one spec ran:false ⇒ error immediately (a dead runner never masquerades as failing tests)', async () => {
    const cfg: LeafGateConfig = { test: 'bun test {file}' };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: false, output: 'runner crashed' },
      "bun test 'src/b.test.ts'": { ran: true, code: 1 },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts', 'src/b.test.ts'], spawn);
    expect(r.status).toBe('error');
    expect(calls.length).toBe(1); // stopped at the dead runner, never reached b
  });

  it('testCwd scopes the change-set: specs outside it are dropped, cwd passed to spawn', async () => {
    const cfg: LeafGateConfig = { test: 'bunx vitest --run {file}', testCwd: 'ui' };
    const { spawn, calls } = stubSpawn({
      "bunx vitest --run 'src/x.test.ts'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/repo', cfg, ['ui/src/x.test.ts', 'backend/y.test.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(join('/repo', 'ui'));
  });
});

describe('runBaseGate', () => {
  it('no config ⇒ pass, declared:false', async () => {
    const { spawn, calls } = stubSpawn({});
    const r = await runBaseGate('/wt', null, spawn);
    expect(r).toEqual({ status: 'pass', output: '', reasons: [], declared: false });
    expect(calls.length).toBe(0);
  });

  it('never invokes the per-file test command, even if declared', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc', test: 'bun test {file}' };
    const { spawn, calls } = stubSpawn({ tsc: { ran: true, code: 0 } });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('pass');
    expect(calls.map((c) => c.command)).toEqual(['tsc']);
  });

  it('runs baseTest (once declared) after a passing typecheck', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc', baseTest: 'bun test' };
    const { spawn, calls } = stubSpawn({ tsc: { ran: true, code: 0 }, 'bun test': { ran: true, code: 1, output: 'FAIL' } });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('fail');
    expect(r.command).toBe('bun test');
    expect(calls.map((c) => c.command)).toEqual(['tsc', 'bun test']);
  });

  it('typecheck ran:false ⇒ error, baseTest never runs', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc', baseTest: 'bun test' };
    const { spawn, calls } = stubSpawn({ tsc: { ran: false, output: 'ENOENT' } });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('error');
    expect(calls.map((c) => c.command)).toEqual(['tsc']);
  });
});

describe('gateFindingsText', () => {
  it('ends with a VERDICT: FAIL line and carries the command', () => {
    const text = gateFindingsText({ status: 'fail', command: 'tsc', output: 'boom', reasons: [], declared: true });
    expect(text).toContain('command: tsc');
    expect(text.trim().endsWith('VERDICT: FAIL — mechanical gate')).toBe(true);
  });
});

describe('no-install guard (the executor path must never shell out to a package manager)', () => {
  const INSTALL_RE = /\b(bun|npm|pnpm|yarn)\s+(install|i|ci)\b/;

  it('leaf-gate.ts contains no install invocation', () => {
    const src = readFileSync(join(__dirname, '..', 'leaf-gate.ts'), 'utf8');
    expect(INSTALL_RE.test(src)).toBe(false);
  });

  it('leaf-executor.ts contains no install invocation', () => {
    const src = readFileSync(join(__dirname, '..', 'leaf-executor.ts'), 'utf8');
    expect(INSTALL_RE.test(src)).toBe(false);
  });
});

describe('no repo-specific commands baked into the executor (commands must come from config)', () => {
  it('leaf-executor.ts does not hardcode a gate command literal', () => {
    const src = readFileSync(join(__dirname, '..', 'leaf-executor.ts'), 'utf8');
    // Anchored to the G2 gate's actual commands, not prose: the bare words "tsc" and
    // "pytest" appear inside unrelated comment sentences elsewhere in this file (e.g. the
    // verify-gate docs), so the guard checks for the full literal invocations only.
    expect(/npx tsc --noEmit|bun test |bunx vitest/.test(src)).toBe(false);
  });
});
