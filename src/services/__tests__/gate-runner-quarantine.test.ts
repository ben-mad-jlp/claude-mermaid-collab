import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The quarantine store hits the real ledger DB (worker-ledger.openDb, keyed off
// MERMAID_SUPERVISOR_DIR and memoized on first open) — point it at a fresh temp
// dir BEFORE anything opens it, so these tests never touch the real ledger.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'gate-quarantine-'));

const { frontendSuiteGatePlugin, extractFailingTests } = await import('../gate-runner');
const { upsertQuarantine, DEFAULT_TTL_MS } = await import('../flaky-quarantine');
const { listTestQuarantine } = await import('../worker-ledger');
type GateSubject = import('../gate-runner').GateSubject;

function makeCtx(over: Partial<GateSubject> & { manifest?: any }): GateSubject {
  return {
    project: '/track',
    gateProject: '/main',
    todoId: 't1',
    todo: { id: 't1', type: 'ui' } as any,
    manifest: { frontendGateCommand: 'npm run test:ci' },
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    ...over,
  } as GateSubject;
}

/** ctx.exec stub returning a failed FE suite whose stdout FAILs the given tests. */
function failingSuite(tests: string[]) {
  return async () => ({
    code: 1,
    stdout: tests.map((t) => `FAIL ${t}`).join('\n') + '\n',
    stderr: '',
  });
}

describe('frontendSuiteGatePlugin quarantine baseline', () => {
  it('a failed FE suite whose failures are ALL in the recorded quarantine set passes', async () => {
    const gateProject = '/quarantine-test-1';
    const now = Date.now();
    upsertQuarantine({
      project: gateProject,
      test: 'known.flaky.test',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
      seededFrom: null,
    }, now);

    const ctx = makeCtx({ gateProject, exec: failingSuite(['known.flaky.test']) as any });
    const v = await frontendSuiteGatePlugin.run(ctx);
    expect(v).not.toBeNull();
    expect(v!.passed).toBe(true);
  });

  it('a net-new failure alongside a quarantined one still REJECTS', async () => {
    const gateProject = '/quarantine-test-2';
    const now = Date.now();
    upsertQuarantine({
      project: gateProject,
      test: 'known.flaky.test',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
      seededFrom: null,
    }, now);

    const ctx = makeCtx({
      gateProject,
      exec: failingSuite(['known.flaky.test', 'new.regression.test']) as any,
    });
    const v = await frontendSuiteGatePlugin.run(ctx);
    expect(v).not.toBeNull();
    expect(v!.passed).toBe(false);
    expect(v!.reasons.join('\n')).toContain('new.regression.test');
    expect(v!.reasons.join('\n')).not.toContain('known.flaky.test');
  });

  it('manifest frontendBaselineFailures entries are seeded into the store and honoured once', async () => {
    const gateProject = '/quarantine-test-3';
    const ctx = makeCtx({
      gateProject,
      manifest: { frontendGateCommand: 'npm run test:ci', frontendBaselineFailures: ['legacy.spec'] },
      exec: failingSuite(['legacy.spec']) as any,
    });

    const v = await frontendSuiteGatePlugin.run(ctx);
    expect(v).not.toBeNull();
    expect(v!.passed).toBe(true);

    const rows = listTestQuarantine(gateProject);
    const seeded = rows.find((r) => r.test === 'legacy.spec');
    expect(seeded).toBeDefined();
    expect(seeded!.seededFrom).toBe('manifest');
  });

  it('a quarantine record past its TTL no longer excuses a failure', async () => {
    const gateProject = '/quarantine-test-4';
    const now = Date.now();
    upsertQuarantine({
      project: gateProject,
      test: 'expired.flaky.test',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now - 1000,
      seededFrom: null,
    }, now);

    const ctx = makeCtx({ gateProject, exec: failingSuite(['expired.flaky.test']) as any });
    const v = await frontendSuiteGatePlugin.run(ctx);
    expect(v).not.toBeNull();
    expect(v!.passed).toBe(false);
  });
});

describe('extractFailingTests bun (fail) marker', () => {
  it('extracts a plain bun (fail) name with a timing suffix', () => {
    expect(extractFailingTests('(fail) some test name [0.12ms]')).toEqual(['some test name']);
  });

  it('extracts a describe-nested bun (fail) name', () => {
    expect(extractFailingTests('(fail) outer > inner test')).toEqual(['outer > inner test']);
  });
});
