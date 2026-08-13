import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the ledger DB at a fresh temp dir BEFORE anything opens it, so these tests
// never touch the real ledger (see sibling base-gate-observation-wiring.test.ts).
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'base-gate-quarantine-downgrade-'));

const { resolveBaseGreen, runBaseGate } = await import('../leaf-gate');
const { upsertQuarantine, DEFAULT_TTL_MS } = await import('../flaky-quarantine');
const { listTestQuarantine } = await import('../worker-ledger');
type LeafGateConfig = import('../leaf-gate').LeafGateConfig;
type LeafGateResult = import('../leaf-gate').LeafGateResult;

const cfg: LeafGateConfig = { baseTest: 'x' };
const ensureEpicWorktree = async () => ({ path: '/tmp/x' });

describe('resolveBaseGreen quarantine downgrade', () => {
  it('all-quarantined fail downgrades to pass', async () => {
    const project = '/downgrade-a';
    const targetProject = '/downgrade-a-target';
    const now = Date.now();
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
      epicId: 'epic-a', project, targetProject, epicBaseSha: 'sha-a', gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    expect(r?.status).toBe('pass');
    expect(r?.quarantinedOnlyFailures).toEqual(['suite > flaky']);
  });

  it('mixed quarantined/non-quarantined failures stay fail', async () => {
    const project = '/downgrade-b';
    const targetProject = '/downgrade-b-target';
    const now = Date.now();
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
      output: 'FAIL suite > flaky\nFAIL suite > real bug',
      reasons: [],
      declared: true,
      baselineFailures: { baseTest: ['suite > flaky', 'suite > real bug'] },
    });

    const r = await resolveBaseGreen({
      epicId: 'epic-b', project, targetProject, epicBaseSha: 'sha-b', gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    expect(r?.status).toBe('fail');
    expect(r?.quarantinedOnlyFailures).toBeUndefined();
  });

  it('empty/absent baselineFailures stays fail', async () => {
    const project = '/downgrade-c';
    const targetProject = '/downgrade-c-target';
    const now = Date.now();

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'fail',
      output: 'gate could not determine failures',
      reasons: [],
      declared: true,
      baselineFailures: {},
    });

    const r = await resolveBaseGreen({
      epicId: 'epic-c', project, targetProject, epicBaseSha: 'sha-c', gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    expect(r?.status).toBe('fail');
  });

  it('TTL-expired quarantine does not downgrade', async () => {
    const project = '/downgrade-d';
    const targetProject = '/downgrade-d-target';
    const now = Date.now();
    upsertQuarantine({
      project: targetProject,
      test: 'suite > flaky',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now - 1000,
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
      epicId: 'epic-d', project, targetProject, epicBaseSha: 'sha-d', gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now,
    });

    expect(r?.status).toBe('fail');
  });

  it('promotion runs end-to-end inside resolveBaseGreen', async () => {
    const project = '/downgrade-e';
    const targetProject = '/downgrade-e-target';
    const baseSha = 'sha-e';

    let call = 0;
    const spawn = async () => {
      call += 1;
      // fail, pass, fail: the first fail seeds the watched set (no prior observation
      // exists yet to keep it watched through the pass run), so 3 calls yield 3
      // same-sha observations of 'suite > flip test' with both a pass and a fail.
      if (call === 2) return { ran: true, code: 0, output: '' };
      return { ran: true, code: 1, output: 'FAIL suite > flip test\n' };
    };
    // Populate base_gate_test_runs at the same baseSha across 3 runs (leaf $0's wiring).
    await runBaseGate('/cwd', cfg, spawn, { project: targetProject, baseSha });
    await runBaseGate('/cwd', cfg, spawn, { project: targetProject, baseSha });
    await runBaseGate('/cwd', cfg, spawn, { project: targetProject, baseSha });

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'pass',
      output: '',
      reasons: [],
      declared: true,
      baselineFailures: {},
    });

    await resolveBaseGreen({
      epicId: 'epic-e', project, targetProject, epicBaseSha: 'sha-e-fresh', gateCfg: cfg,
      ensureEpicWorktree, runGate,
    });

    const quarantined = listTestQuarantine(targetProject).map((q) => q.test);
    expect(quarantined).toContain('suite > flip test');
  });

  it('case-title quarantine row covers a file-path failure with an ordinal prefix', async () => {
    const project = '/downgrade-f';
    const targetProject = '/downgrade-f-target';
    const now = Date.now();
    const caseTitle = 'watchdog kill escalates SIGTERM → SIGKILL';
    upsertQuarantine({
      project: targetProject,
      test: caseTitle,
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
      seededFrom: null,
    }, now);

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'fail',
      output: 'FAIL (500/600) src/services/__tests__/server-supervisor-term-grace.test.ts',
      reasons: [],
      declared: true,
      baselineFailures: { baseTest: ['(500/600) src/services/__tests__/server-supervisor-term-grace.test.ts'] },
    });

    const resolveTestFile = (project: string, test: string) => {
      if (test === caseTitle) {
        return 'src/services/__tests__/server-supervisor-term-grace.test.ts';
      }
      return null;
    };

    const r = await resolveBaseGreen({
      epicId: 'epic-f', project, targetProject, epicBaseSha: 'sha-f', gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now, resolveTestFile,
    });

    expect(r?.status).toBe('pass');
    expect(r?.quarantinedOnlyFailures).toEqual(['(500/600) src/services/__tests__/server-supervisor-term-grace.test.ts']);
  });

  it('case title resolving to a different file leaves the gate failing', async () => {
    const project = '/downgrade-g';
    const targetProject = '/downgrade-g-target';
    const now = Date.now();
    const caseTitle = 'watchdog kill escalates SIGTERM → SIGKILL';
    upsertQuarantine({
      project: targetProject,
      test: caseTitle,
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
      seededFrom: null,
    }, now);

    const runGate = async (): Promise<LeafGateResult> => ({
      status: 'fail',
      output: 'FAIL (500/600) src/services/__tests__/server-supervisor-term-grace.test.ts',
      reasons: [],
      declared: true,
      baselineFailures: { baseTest: ['(500/600) src/services/__tests__/server-supervisor-term-grace.test.ts'] },
    });

    const resolveTestFile = (project: string, test: string) => {
      if (test === caseTitle) {
        return 'src/services/__tests__/different-file.test.ts';
      }
      return null;
    };

    const r = await resolveBaseGreen({
      epicId: 'epic-g', project, targetProject, epicBaseSha: 'sha-g', gateCfg: cfg,
      ensureEpicWorktree, runGate, now: () => now, resolveTestFile,
    });

    expect(r?.status).toBe('fail');
    expect(r?.quarantinedOnlyFailures).toBeUndefined();
  });
});
