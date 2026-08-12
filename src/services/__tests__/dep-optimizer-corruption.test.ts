import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the ledger DB at a fresh temp dir BEFORE anything opens it, so these tests
// never touch the real ledger.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'dep-optimizer-corruption-'));

const { isDepOptimizerCorruption } = await import('../dep-optimizer-corruption');
const { resolveBaseGreen } = await import('../leaf-gate');
const { getEpicBaseGate } = await import('../worker-ledger');
type LeafGateConfig = import('../leaf-gate').LeafGateConfig;
type LeafGateResult = import('../leaf-gate').LeafGateResult;

const cfg: LeafGateConfig = { baseTest: 'x' };
const ensureEpicWorktree = async () => ({ path: '/tmp/x' });

describe('isDepOptimizerCorruption predicate', () => {
  it('true for node_modules/.vitest/deps/ react_jsx-runtime.js', () => {
    const output = `Error: Cannot find module '/Users/x/ui/node_modules/.vitest/deps/react_jsx-runtime.js'`;
    expect(isDepOptimizerCorruption(output)).toBe(true);
  });

  it('true for node_modules/.vitest/deps/ react-dom.js', () => {
    const output = `Error: Cannot find module '/Users/x/ui/node_modules/.vitest/deps/react-dom.js'`;
    expect(isDepOptimizerCorruption(output)).toBe(true);
  });

  it('true for .vitest-cache/deps/ variant', () => {
    const output = `ERR_MODULE_NOT_FOUND: Cannot find module '/Users/x/.vitest-cache/deps/react_jsx-runtime.js'`;
    expect(isDepOptimizerCorruption(output)).toBe(true);
  });

  it('true for .vite/deps/ variant', () => {
    const output = `Error: Cannot find module '/project/.vite/deps/some-lib.js'`;
    expect(isDepOptimizerCorruption(output)).toBe(true);
  });

  it('false for an ordinary missing-module error', () => {
    const output = `Error: Cannot find module '../src/services/foo'`;
    expect(isDepOptimizerCorruption(output)).toBe(false);
  });

  it('false for a bare specifier missing module', () => {
    const output = `Error: Cannot find module 'left-pad'`;
    expect(isDepOptimizerCorruption(output)).toBe(false);
  });

  it('false for a plain assertion failure', () => {
    const output = `expect(x).toBe(y)
Expected: foo
Received: bar`;
    expect(isDepOptimizerCorruption(output)).toBe(false);
  });

  it('false when cache marker is present but no module error', () => {
    const output = `Some other error in node_modules/.vitest/deps/code`;
    expect(isDepOptimizerCorruption(output)).toBe(false);
  });

  it('false when module error exists but in a different block from cache marker', () => {
    const output = `Error: Cannot find module '../src/services/foo'

Some unrelated output in node_modules/.vitest/deps/`;
    expect(isDepOptimizerCorruption(output)).toBe(false);
  });

  it('true when both error and marker are in the same multi-line block', () => {
    const output = `Error running test:
Cannot find module '/Users/x/ui/node_modules/.vitest/deps/react_jsx-runtime.js'
at Module._load (internal/modules/cjs/loader.js:123:45)`;
    expect(isDepOptimizerCorruption(output)).toBe(true);
  });
});

describe('resolveBaseGreen with dep-optimizer corruption', () => {
  it('rewrites dep-optimizer-corrupted fail to error and records no base gate row', async () => {
    const project = '/dep-opt-a';
    const targetProject = '/dep-opt-a-target';
    const epicId = 'epic-dep-opt-a';
    const epicBaseSha = 'sha-dep-opt-a';
    const now = Date.now();

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'fail',
      output: `Error: Cannot find module '/Users/x/ui/node_modules/.vitest/deps/react_jsx-runtime.js'`,
      reasons: [],
      declared: true,
      baselineFailures: {},
    });

    const r = await resolveBaseGreen({
      epicId, project, targetProject, epicBaseSha, gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    expect(r?.status).toBe('error');
    expect(r?.reasons).toContain('dep-optimizer cache corruption (stale vitest/vite deps cache), not a base defect');

    // Verify no base gate row was recorded (because error status is not cacheable)
    const cached = getEpicBaseGate(epicId, epicBaseSha);
    expect(cached).toBeNull();
  });

  it('still records an unrelated assertion failure as fail', async () => {
    const project = '/dep-opt-b';
    const targetProject = '/dep-opt-b-target';
    const epicId = 'epic-dep-opt-b';
    const epicBaseSha = 'sha-dep-opt-b';
    const now = Date.now();

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'fail',
      output: `expect(x).toBe(y)
Expected: foo
Received: bar`,
      reasons: [],
      declared: true,
      baselineFailures: {},
    });

    const r = await resolveBaseGreen({
      epicId, project, targetProject, epicBaseSha, gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    expect(r?.status).toBe('fail');

    // Verify a base gate row WAS recorded (because fail status is cacheable)
    const cached = getEpicBaseGate(epicId, epicBaseSha);
    expect(cached).toBeTruthy();
  });

  it('rewrite composes with quarantine downgrade', async () => {
    const project = '/dep-opt-c';
    const targetProject = '/dep-opt-c-target';
    const epicId = 'epic-dep-opt-c';
    const epicBaseSha = 'sha-dep-opt-c';
    const now = Date.now();

    // Set up quarantine for a test
    const { upsertQuarantine, DEFAULT_TTL_MS } = await import('../flaky-quarantine');
    upsertQuarantine({
      project: targetProject,
      test: 'suite > flaky',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
      seededFrom: null,
    }, now);

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'fail',
      output: 'FAIL suite > flaky',
      reasons: [],
      declared: true,
      baselineFailures: { baseTest: ['suite > flaky'] },
    });

    const r = await resolveBaseGreen({
      epicId, project, targetProject, epicBaseSha, gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    // The quarantine downgrade runs first, converting fail->pass
    // The dep-optimizer check runs after and sees pass, so doesn't rewrite
    expect(r?.status).toBe('pass');
    expect(r?.quarantinedOnlyFailures).toEqual(['suite > flaky']);
  });
});
