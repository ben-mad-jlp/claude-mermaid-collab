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
  resolveGateDeclaration,
  gateResultForDeclaration,
  bridgeLegacyGate,
  type GateSpawn,
  type LeafGateConfig,
  type GateTestLane,
} from '../leaf-gate';
import type { LeafReviewVerdict } from '../leaf-executor';
import type { ProjectManifest, ManifestSource } from '../../config/project-manifest';

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

  it('suites-only config (no typecheck/test/baseTest) survives', () => {
    const g = resolveLeafGate({
      version: 1,
      gate: { suites: [{ match: '^ui/', command: 'bunx vitest --run', cwd: 'ui' }] },
    } as ProjectManifest);
    expect(g).not.toBeNull();
    expect(g?.suites).toBeDefined();
    expect(g?.suites!.length).toBe(1);
    expect(g?.suites![0].command).toBe('bunx vitest --run');
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

  it('typecheck exits 1, error is IN the change-set ⇒ fail, command + output carried', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 1, output: 'x.ts(1,1): error TS1234' } });
    const r = await runLeafGate('/wt', cfg, ['x.ts'], spawn);
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

  it('legacy form back-compat: testCwd with no cwd prefix still skips specs silently', async () => {
    const cfg: LeafGateConfig = { test: 'bunx vitest --run {file}', testCwd: 'ui' };
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/repo', cfg, ['backend/y.test.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(0); // backend spec is silently skipped, no error
  });
});

describe('runLeafGate — foreign whole-tree typecheck errors (stale-base incident)', () => {
  it('error entirely INSIDE the change-set ⇒ fail (unchanged behaviour)', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({
      tsc: { ran: true, code: 1, output: 'src/services/leaf-gate.ts(10,3): error TS2304: Cannot find name X.' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/services/leaf-gate.ts'], spawn);
    expect(r.status).toBe('fail');
    expect(r.command).toBe('tsc');
  });

  it('error entirely OUTSIDE the change-set ⇒ error/incident with a foreign-typecheck-errors reason, never fail', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const foreignFile = 'src/services/__tests__/session-summary-loop.test.ts';
    const { spawn } = stubSpawn({
      tsc: { ran: true, code: 1, output: `${foreignFile}(12,5): error TS2304: Cannot find name Y.` },
    });
    const r = await runLeafGate('/wt', cfg, ['src/services/some-leaf-file.ts'], spawn);
    expect(r.status).toBe('error');
    expect(r.reasons.some((reason) => reason.includes('foreign-typecheck-errors'))).toBe(true);
    expect(r.reasons.some((reason) => reason.includes(foreignFile))).toBe(true);
  });

  it('the `--pretty` colon-format diagnostic is parsed too', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const foreignFile = 'src/services/unrelated.ts';
    const { spawn } = stubSpawn({
      tsc: { ran: true, code: 1, output: `${foreignFile}:12:5 - error TS2304: Cannot find name Y.` },
    });
    const r = await runLeafGate('/wt', cfg, ['src/services/some-leaf-file.ts'], spawn);
    expect(r.status).toBe('error');
    expect(r.reasons.some((reason) => reason.includes('foreign-typecheck-errors'))).toBe(true);
  });

  it('MIXED in-set + out-of-set errors ⇒ fail — the in-set error dominates', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const output = [
      'src/services/leaf-gate.ts(10,3): error TS2304: Cannot find name X.',
      'src/services/__tests__/session-summary-loop.test.ts(12,5): error TS2304: Cannot find name Y.',
    ].join('\n');
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 1, output } });
    const r = await runLeafGate('/wt', cfg, ['src/services/leaf-gate.ts'], spawn);
    expect(r.status).toBe('fail');
  });

  it('UNPARSEABLE typecheck output (no file paths extractable) ⇒ fail-closed, unchanged behaviour', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 1, output: 'Build failed for unknown reasons.' } });
    const r = await runLeafGate('/wt', cfg, ['src/services/some-leaf-file.ts'], spawn);
    expect(r.status).toBe('fail');
  });

  it('changeSet null (unreadable) ⇒ fail-closed even with a parseable foreign-looking error', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc' };
    const { spawn } = stubSpawn({
      tsc: { ran: true, code: 1, output: 'src/services/__tests__/session-summary-loop.test.ts(12,5): error TS2304' },
    });
    const r = await runLeafGate('/wt', cfg, null, spawn);
    expect(r.status).toBe('fail');
  });
});

describe('gate.tests — dual-runner lanes (G6)', () => {
  it('THE SHIPPED BUG FIXED: mixed src/ui specs routed to correct lanes with correct cwds', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
        { match: new RegExp('^ui/'), command: 'bunx vitest --run {files}', cwd: 'ui', mode: 'batch' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/services/foo.test.ts'": { ran: true, code: 0 },
      "bunx vitest --run 'src/Bar.test.tsx'": { ran: true, code: 0 },
    });
    const r = await runLeafGate(
      '/wt',
      cfg,
      ['src/services/foo.test.ts', 'ui/src/Bar.test.tsx'],
      spawn,
    );
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual({ cwd: '/wt', command: "bun test 'src/services/foo.test.ts'" });
    expect(calls[1]).toEqual({ cwd: '/wt/ui', command: "bunx vitest --run 'src/Bar.test.tsx'" });
    // Regression: no bun test command should mention ui/ paths.
    expect(calls.every((c) => !(c.command.startsWith('bun test') && c.command.includes('ui/')))).toBe(
      true,
    );
  });

  it('{files} batching: two ui/ specs run in ONE vitest command', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^ui/'), command: 'bunx vitest --run {files}', cwd: 'ui', mode: 'batch' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bunx vitest --run 'src/A.test.tsx' 'src/B.test.tsx'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['ui/src/A.test.tsx', 'ui/src/B.test.tsx'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe("bunx vitest --run 'src/A.test.tsx' 'src/B.test.tsx'");
  });

  it('{file} per-file: two src/ specs run in TWO bun test commands', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: true, code: 0 },
      "bun test 'src/b.test.ts'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts', 'src/b.test.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(2);
  });

  it('config gap: unmatched specs in multi-lane form ⇒ status:error with unmatchedSpecs', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
      ],
    };
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/wt', cfg, ['ui/src/x.test.tsx'], spawn);
    expect(r.status).toBe('error');
    expect(r.unmatchedSpecs).toEqual(['ui/src/x.test.tsx']);
    expect(r.reasons.some((reason) => reason.includes('match NO test lane'))).toBe(true);
    expect(calls.length).toBe(0); // no spawn for unmatched specs
  });

  it('cannot run a lane (ran:false) ⇒ error, no further lanes run', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
        { match: new RegExp('^ui/'), command: 'bunx vitest --run {files}', cwd: 'ui', mode: 'batch' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: false, output: 'runner missing' },
    });
    const r = await runLeafGate(
      '/wt',
      cfg,
      ['src/a.test.ts', 'ui/src/x.test.tsx'],
      spawn,
    );
    expect(r.status).toBe('error');
    expect(calls.length).toBe(1); // only attempted the first lane
  });

  it('a lane runs and fails ⇒ status:fail with the lane command', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: true, code: 1, output: 'FAIL a' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts'], spawn);
    expect(r.status).toBe('fail');
    expect(r.command).toBe("bun test 'src/a.test.ts'");
  });

  it('first lane matches: path order matters', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
        { match: new RegExp('.test.ts$'), command: 'fallback {file}', cwd: undefined, mode: 'per-file' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/x.test.ts'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['src/x.test.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls[0].command).toBe("bun test 'src/x.test.ts'"); // first lane matched
  });

  it('lane with no matching specs in the change-set is skipped', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {file}', cwd: undefined, mode: 'per-file' },
        { match: new RegExp('^ui/'), command: 'bunx vitest --run {files}', cwd: 'ui', mode: 'batch' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      "bun test 'src/a.test.ts'": { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(1); // only src/ lane ran
  });

  it('shell quoting in {file} and {files} substitution', async () => {
    const cfg: LeafGateConfig = {
      tests: [
        { match: new RegExp('^src/'), command: 'bun test {files}', cwd: undefined, mode: 'batch' },
      ],
    };
    const quotedSpace = "'src/has space.test.ts'";
    const quotedQuote = "'src/has'\\''quote.test.ts'"; // shell-escaped single quote
    const { spawn, calls } = stubSpawn({
      [`bun test ${quotedSpace} ${quotedQuote}`]: { ran: true, code: 0 },
    });
    const r = await runLeafGate(
      '/wt',
      cfg,
      ["src/has space.test.ts", "src/has'quote.test.ts"],
      spawn,
    );
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(1);
  });
});

describe('gate.typechecks — change-set-scoped project typecheck lane', () => {
  it('change-set touching ui/ ⇒ lane runs, typecheck in ui/ cwd with relative diagnostics', async () => {
    const cfg: LeafGateConfig = {
      typechecks: [
        { match: new RegExp('^ui/'), command: 'npx tsc --noEmit -p tsconfig.json', cwd: 'ui' },
      ],
    };
    const { spawn, calls } = stubSpawn({
      'npx tsc --noEmit -p tsconfig.json': {
        ran: true,
        code: 1,
        output: 'src/stores/uiStore.ts(88,12): error TS2352: Cannot convert type...\nsrc/stores/subscriptionStore.ts(23,5): error TS1355: Type...',
      },
    });
    const r = await runLeafGate(
      '/wt',
      cfg,
      ['ui/src/stores/uiStore.ts', 'ui/src/stores/subscriptionStore.ts'],
      spawn,
    );
    expect(r.status).toBe('fail');
    expect(r.command).toBe('npx tsc --noEmit -p tsconfig.json');
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(join('/wt', 'ui'));
  });

  it('change-set NOT touching ui/ ⇒ lane is skipped, spawn never called', async () => {
    const cfg: LeafGateConfig = {
      typechecks: [
        { match: new RegExp('^ui/'), command: 'npx tsc --noEmit -p tsconfig.json', cwd: 'ui' },
      ],
    };
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/wt', cfg, ['src/services/leaf-gate.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(0);
  });
});

describe('gate.suites — change-set-triggered full-suite lane', () => {
  it('RED — failing suite with extractFailingTests reasons', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^ui/'), command: 'bunx vitest --run', cwd: 'ui' }],
    };
    const { spawn, calls } = stubSpawn({
      'bunx vitest --run': { ran: true, code: 1, output: '× renders the button 12ms\n× handles click 3ms' },
    });
    const r = await runLeafGate('/wt', cfg, ['ui/src/Button.test.tsx'], spawn);
    expect(r.status).toBe('fail');
    expect(r.command).toBe('bunx vitest --run');
    expect(r.reasons).toContain('renders the button');
    expect(r.reasons).toContain('handles click');
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(join('/wt', 'ui'));
  });

  it('GREEN — passing suite', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^ui/'), command: 'bunx vitest --run', cwd: 'ui' }],
    };
    const { spawn, calls } = stubSpawn({
      'bunx vitest --run': { ran: true, code: 0 },
    });
    const r = await runLeafGate('/wt', cfg, ['ui/src/Button.test.tsx'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(1);
  });

  it('NO-MATCH — change-set outside lane match never spawns', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^ui/'), command: 'bunx vitest --run', cwd: 'ui' }],
    };
    const { spawn, calls } = stubSpawn({});
    const r = await runLeafGate('/wt', cfg, ['src/services/leaf-gate.ts'], spawn);
    expect(r.status).toBe('pass');
    expect(calls.length).toBe(0);
  });
});

describe('runLeafGate — base-differential lanes', () => {
  it('BASELINE-ONLY — suite red reproducing only a baseline fingerprint passes', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^src/'), command: 'bun test', cwd: undefined }],
    };
    const baselines = { 'suites:^src\\/': ['src/a.test.ts'] };
    const { spawn } = stubSpawn({
      'bun test': { ran: true, code: 1, output: 'FAIL src/a.test.ts' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts'], spawn, baselines);
    expect(r.status).toBe('pass');
    expect(r.baselineOnly).toContain('src/a.test.ts');
  });

  it('NET-NEW — suite red with a fingerprint absent from the baseline fails', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^src/'), command: 'bun test', cwd: undefined }],
    };
    const baselines = { 'suites:^src\\/': ['src/a.test.ts'] };
    const { spawn } = stubSpawn({
      'bun test': { ran: true, code: 1, output: 'FAIL src/b.test.ts' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/b.test.ts'], spawn, baselines);
    expect(r.status).toBe('fail');
  });

  it('NO BASELINE — same red with an empty/null baseline still fails (fail-closed)', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^src/'), command: 'bun test', cwd: undefined }],
    };
    const { spawn } = stubSpawn({
      'bun test': { ran: true, code: 1, output: 'FAIL src/b.test.ts' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/b.test.ts'], spawn, null);
    expect(r.status).toBe('fail');
  });

  it('TYPECHECKS LANE — baseline-only typecheck failure passes (the other lane kind, not just suites)', async () => {
    const cfg: LeafGateConfig = {
      typechecks: [{ match: new RegExp('^src/'), command: 'npx tsc --noEmit', cwd: undefined }],
    };
    const baselines = { 'typechecks:^src\\/': ['src/a.ts'] };
    const { spawn } = stubSpawn({
      'npx tsc --noEmit': { ran: true, code: 1, output: 'src/a.ts(1,1): error TS1234' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.ts'], spawn, baselines);
    expect(r.status).toBe('pass');
    expect(r.baselineOnly).toContain('src/a.ts');
  });

  it('ABSENT BASELINE KEY — the lane\'s key is missing from the map entirely ⇒ still fails (a key mismatch must never silently pass)', async () => {
    const cfg: LeafGateConfig = {
      suites: [{ match: new RegExp('^src/'), command: 'bun test', cwd: undefined }],
    };
    const baselines = { 'suites:^other\\/': ['src/a.test.ts'] }; // wrong key — this lane's key is absent
    const { spawn } = stubSpawn({
      'bun test': { ran: true, code: 1, output: 'FAIL src/a.test.ts' },
    });
    const r = await runLeafGate('/wt', cfg, ['src/a.test.ts'], spawn, baselines);
    expect(r.status).toBe('fail');
  });
});

describe('lane validation (resolveGateDeclaration)', () => {
  const MANIFEST_PATH = '/tmp/.collab/project.json';

  it('tests: [] (empty array) ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { tests: [] } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('non-empty array');
    }
  });

  it('a lane with missing match ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { tests: [{ command: 'bun test {file}' } as any] } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('match and command');
    }
  });

  it('a lane with invalid RegExp ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { tests: [{ match: '[', command: 'bun test {file}' }] } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('not a valid regexp');
    }
  });

  it('command with neither {file} nor {files} ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { tests: [{ match: '^src/', command: 'bun test' }] } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('exactly one of {file} or {files}');
    }
  });

  it('command with both {file} and {files} ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: {
        version: 1,
        gate: { tests: [{ match: '^src/', command: 'bun test {file} {files}' }] },
      },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('exactly one of {file} or {files}');
    }
  });

  it('both test and tests declared ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: {
        version: 1,
        gate: {
          test: 'bun test {file}',
          tests: [{ match: '^src/', command: 'bun test {file}' }],
        },
      },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('both test and tests');
    }
  });

  it('valid multi-lane config ⇒ declared with compiled lanes', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: {
        version: 1,
        gate: {
          typecheck: 'tsc',
          tests: [
            { match: '^src/', command: 'bun test {file}' },
            { match: '^ui/', command: 'bunx vitest --run {files}', cwd: 'ui' },
          ],
        },
      },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('declared');
    if (decl.kind === 'declared') {
      expect(decl.cfg.tests).toBeDefined();
      expect(decl.cfg.tests!.length).toBe(2);
      expect(decl.cfg.tests![0].mode).toBe('per-file');
      expect(decl.cfg.tests![1].mode).toBe('batch');
    }
  });

  it('real .collab/project.json of THIS repo has the multi-lane config and typechecks', () => {
    const manifestPath = join(__dirname, '..', '..', '..', '.collab', 'project.json');
    const content = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content) as ProjectManifest;
    expect(manifest.gate?.tests).toBeDefined();
    expect(manifest.gate!.tests!.length).toBeGreaterThanOrEqual(2);
    expect(manifest.gate!.tests![0].match).toBe('^src/');
    expect(manifest.gate!.tests![0].command).toContain('bun test');
    expect(manifest.gate?.typechecks).toBeDefined();
    expect(manifest.gate!.typechecks!.length).toBeGreaterThan(0);
    expect(manifest.gate!.typechecks![0].match).toBe('^ui/');
    const src: ManifestSource = { path: manifestPath, state: 'ok', manifest };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('declared');
  });

  it('valid suites config (match + command) ⇒ declared with compiled lane', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: {
        version: 1,
        gate: { suites: [{ match: '^ui/', command: 'bunx vitest --run', cwd: 'ui' }] },
      },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('declared');
    if (decl.kind === 'declared') {
      expect(decl.cfg.suites).toBeDefined();
      expect(decl.cfg.suites!.length).toBe(1);
      expect(decl.cfg.suites![0].command).toBe('bunx vitest --run');
    }
  });

  it('malformed suites config (missing command) ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { suites: [{ match: '^ui/' } as any] } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    if (decl.kind === 'misconfigured') {
      expect(decl.reason).toContain('match and command');
    }
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

  it('runs EVERY declared lane (no short-circuit) and memoizes each red lane\'s fingerprints', async () => {
    const cfg: LeafGateConfig = {
      typecheck: 'tsc',
      typechecks: [{ match: /^srv\//, command: 'tsc-srv' }],
      suites: [{ match: /^ui\//, command: 'suite-ui' }],
      baseTest: 'bun test',
    };
    const { spawn, calls } = stubSpawn({
      tsc: { ran: true, code: 0 },
      'tsc-srv': { ran: true, code: 0 }, // passing typechecks lane
      'suite-ui': { ran: true, code: 1, output: 'FAIL ui/a.test.ts\n× renders wrong' }, // failing suite
      'bun test': { ran: true, code: 0 },
    });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('fail');
    // No short-circuit: all four full-command lanes spawned, in fixed order.
    expect(calls.map((c) => c.command)).toEqual(['tsc', 'tsc-srv', 'suite-ui', 'bun test']);
    // Only the failing suite lane recorded, keyed by its match source, with extracted names.
    expect(r.baselineFailures).toEqual({ 'suites:^ui\\/': ['ui/a.test.ts', 'renders wrong'] });
  });

  it('a failing typechecks lane maps its key to the parseTypecheckFiles file list', async () => {
    const cfg: LeafGateConfig = {
      typechecks: [{ match: /^srv\//, command: 'tsc-srv' }],
    };
    const { spawn } = stubSpawn({
      'tsc-srv': { ran: true, code: 1, output: 'srv/x.ts(3,5): error TS2322: bad\nsrv/y.ts(9,1): error TS1005: oops' },
    });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('fail');
    expect(r.baselineFailures).toEqual({ 'typechecks:^srv\\/': ['srv/x.ts', 'srv/y.ts'] });
  });

  it('fully-green base ⇒ pass with an empty baselineFailures map', async () => {
    const cfg: LeafGateConfig = { typecheck: 'tsc', baseTest: 'bun test' };
    const { spawn } = stubSpawn({ tsc: { ran: true, code: 0 }, 'bun test': { ran: true, code: 0 } });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('pass');
    expect(r.baselineFailures).toEqual({});
  });

  it('ran:false on a mid-list lane ⇒ error, no blob, later lanes not spawned', async () => {
    const cfg: LeafGateConfig = {
      typecheck: 'tsc',
      suites: [{ match: /^ui\//, command: 'suite-ui' }],
      baseTest: 'bun test',
    };
    const { spawn, calls } = stubSpawn({
      tsc: { ran: true, code: 0 },
      'suite-ui': { ran: false, output: 'ENOENT' },
    });
    const r = await runBaseGate('/wt', cfg, spawn);
    expect(r.status).toBe('error');
    expect(r.baselineFailures).toBeUndefined();
    // baseTest after the erroring suite is never reached.
    expect(calls.map((c) => c.command)).toEqual(['tsc', 'suite-ui']);
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

describe('resolveGateDeclaration / gateResultForDeclaration (G4)', () => {
  const MANIFEST_PATH = '/tmp/some-project/.collab/project.json';

  it('absent source ⇒ kind:absent, and the leaf still runs (no gate result)', () => {
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'absent', manifest: null };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('absent');
    expect(decl.manifestPath).toBe(MANIFEST_PATH);
    expect(gateResultForDeclaration(decl)).toBeNull();
  });

  it('ACCEPTANCE: malformed source ⇒ kind:misconfigured, status is error — NEVER pass', () => {
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'malformed', manifest: null };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
    const r = gateResultForDeclaration(decl);
    expect(r).not.toBeNull();
    expect(r!.status).not.toBe('pass');
    expect(r!.status).toBe('error');
  });

  it('ok source, no gate key ⇒ absent', () => {
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'ok', manifest: { version: 1 } };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('absent');
  });

  it('ok source, empty gate block ⇒ misconfigured (empty gate is not an abstention)', () => {
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'ok', manifest: { version: 1, gate: {} } };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
  });

  it('ok source, all-blank-string gate fields ⇒ misconfigured', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { typecheck: '  ', test: '' } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('misconfigured');
  });

  it('ok source, a usable gate command ⇒ declared, trimmed cfg', () => {
    const src: ManifestSource = {
      path: MANIFEST_PATH,
      state: 'ok',
      manifest: { version: 1, gate: { typecheck: '  npx tsc --noEmit  ' } },
    };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('declared');
    if (decl.kind === 'declared') {
      expect(decl.cfg.typecheck).toBe('npx tsc --noEmit');
    }
  });

  it('no command is ever defaulted, and the reason cites the manifest path', () => {
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'malformed', manifest: null };
    const decl = resolveGateDeclaration(src);
    const r = gateResultForDeclaration(decl)!;
    expect(r.command).toBeUndefined();
    expect(r.reasons[0]).toContain(MANIFEST_PATH);
  });

  it('an LLM PASS cannot ratify a config error', () => {
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'malformed', manifest: null };
    const decl = resolveGateDeclaration(src);
    const r = gateResultForDeclaration(decl)!;
    expect(composeVerdict(r.status, 'pass')).toBe('error');
  });
});

describe('bridgeLegacyGate / legacy manifest bridging', () => {
  const MANIFEST_PATH = '/tmp/some-project/.collab/project.json';

  it('build123d shape resolves: gateCommand + frontendGateCommand via legacy keys', () => {
    const m: ProjectManifest = {
      version: 1,
      gateCommand: 'python3.10 -m pytest bsync-tools/tests -q',
      frontendGateCommand: 'bunx vitest --run',
    };

    // Direct call to bridgeLegacyGate.
    const bridged = bridgeLegacyGate(m);
    expect(bridged).not.toBeNull();
    expect(bridged!.suites).toBeDefined();
    expect(bridged!.suites!.length).toBe(2);
    expect(bridged!.suites![0].command).toBe('python3.10 -m pytest bsync-tools/tests -q');
    expect(bridged!.suites![1].command).toBe('bunx vitest --run');

    // Via resolveGateDeclaration (no gate block in manifest).
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'ok', manifest: m };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('declared');
    if (decl.kind === 'declared') {
      expect(decl.cfg.suites).toBeDefined();
      expect(decl.cfg.suites!.length).toBe(2);
      expect(decl.cfg.suites![0].command).toBe('python3.10 -m pytest bsync-tools/tests -q');
      expect(decl.cfg.suites![1].command).toBe('bunx vitest --run');
    }
  });

  it('gate block wins over legacy keys: declared gate takes precedence', () => {
    const m: ProjectManifest = {
      version: 1,
      gate: { typecheck: 'tsc' },
      gateCommand: 'pytest',
    };

    const src: ManifestSource = { path: MANIFEST_PATH, state: 'ok', manifest: m };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('declared');
    if (decl.kind === 'declared') {
      expect(decl.cfg.typecheck).toBe('tsc');
      expect(decl.cfg.suites).toBeUndefined();
    }
  });

  it('no runnable legacy command ⇒ absent: changeSetTestCwd + metricRefs alone yield null', () => {
    const m: ProjectManifest = {
      version: 1,
      changeSetTestCwd: 'ui',
      metricRefs: ['x'],
    };

    // Direct call: should return null (no runnable command).
    const bridged = bridgeLegacyGate(m);
    expect(bridged).toBeNull();

    // Via resolveLeafGate: should return null.
    expect(resolveLeafGate(m)).toBeNull();

    // Via resolveGateDeclaration: should resolve to 'absent'.
    const src: ManifestSource = { path: MANIFEST_PATH, state: 'ok', manifest: m };
    const decl = resolveGateDeclaration(src);
    expect(decl.kind).toBe('absent');
  });
});
