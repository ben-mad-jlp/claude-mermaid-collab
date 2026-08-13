// Runs via `bun test`.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listLapsedQuarantineRows,
  repairLapsedQuarantine,
  repairExitCode,
  type RerunOutcome,
  type QuarantineRerunner,
} from '../repair-lapsed-quarantine';
import { upsertQuarantine } from '../../src/services/flaky-quarantine';
import { listTestQuarantine, _closeLedgerDb } from '../../src/services/worker-ledger';
import { listFriction } from '../../src/services/friction-store';
import { canonicalProjectRoot } from '../../src/services/store-paths';
import { resetQuarantineTestFileCache } from '../../src/services/quarantine-test-file';

const SEED_SHA = 'seed-sha-0000';
const FRESH_SHA = 'fresh-sha-1111';
const PAST_TTL = Date.now() - 60 * 60_000; // one hour ago: lapsed

function makeRunner(outcomesByFile: Record<string, RerunOutcome>): QuarantineRerunner {
  return async (_project, testFile) => {
    const outcome = outcomesByFile[testFile];
    if (!outcome) throw new Error(`no outcome configured for testFile ${testFile}`);
    return outcome;
  };
}

describe('repair-lapsed-quarantine', () => {
  let supervisorDir: string;
  let project: string;

  beforeAll(() => {
    supervisorDir = mkdtempSync(join(tmpdir(), 'repair-lapsed-quarantine-ledger-'));
    process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;
    _closeLedgerDb();
    project = canonicalProjectRoot(mkdtempSync(join(tmpdir(), 'repair-lapsed-quarantine-project-')));
  });

  afterAll(() => {
    resetQuarantineTestFileCache();
    _closeLedgerDb();
    delete process.env.MERMAID_SUPERVISOR_DIR;
    rmSync(supervisorDir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  it('a lapsed row whose re-run flips is re-quarantined with a later TTL and a fresh sha', async () => {
    const test = 'src/flip.test.ts > flip case';
    upsertQuarantine({
      project,
      test,
      quarantinedAtSha: SEED_SHA,
      evidence: { runs: 3, passRuns: 3, failRuns: 0 },
      ttlExpiresAt: PAST_TTL,
      seededFrom: null,
    });

    const lapsedBefore = await listLapsedQuarantineRows(project);
    expect(lapsedBefore.some((r) => r.test === test)).toBe(true);

    const runner = makeRunner({ 'src/flip.test.ts': { runs: 5, passRuns: 4, failRuns: 1 } });
    const result = await repairLapsedQuarantine(
      project,
      { apply: true, runs: 5, concurrency: 2, sha: FRESH_SHA, runner },
    );

    const decision = result.decisions.find((d) => d.test === test);
    expect(decision).toBeDefined();
    expect(decision?.outcome).toBe('re-quarantined');

    const rows = listTestQuarantine(project).filter((r) => r.test === test);
    expect(rows).toHaveLength(1);
    expect(rows[0].ttlExpiresAt).toBeGreaterThan(PAST_TTL);
    expect(rows[0].quarantinedAtSha).not.toBe(SEED_SHA);
    expect(rows[0].quarantinedAtSha).toBe(FRESH_SHA);
  });

  it('a lapsed row whose re-runs are all green is retired with a quarantine-deflaked friction note', async () => {
    const test = 'src/green.test.ts > green case';
    upsertQuarantine({
      project,
      test,
      quarantinedAtSha: SEED_SHA,
      evidence: { runs: 3, passRuns: 3, failRuns: 0 },
      ttlExpiresAt: PAST_TTL,
      seededFrom: null,
    });

    const runner = makeRunner({ 'src/green.test.ts': { runs: 5, passRuns: 5, failRuns: 0 } });
    const result = await repairLapsedQuarantine(
      project,
      { apply: true, runs: 5, concurrency: 2, sha: FRESH_SHA, runner },
    );

    const decision = result.decisions.find((d) => d.test === test);
    expect(decision).toBeDefined();
    expect(decision?.outcome).toBe('de-flaked');

    const rows = listTestQuarantine(project).filter((r) => r.test === test);
    expect(rows).toHaveLength(0);

    const notes = listFriction(project, { layer: 'operational' });
    const note = notes.find((n) => n.retryReason === 'quarantine-deflaked' && (n.detail ?? '').includes(test));
    expect(note).toBeDefined();
  });

  it('an unrunnable lapsed row is re-quarantined with its existing evidence and a fresh TTL', async () => {
    const test = 'totally unresolvable flaky case with no known path token';
    upsertQuarantine({
      project,
      test,
      quarantinedAtSha: SEED_SHA,
      evidence: { runs: 4, passRuns: 2, failRuns: 2 },
      ttlExpiresAt: PAST_TTL,
      seededFrom: null,
    });

    const runner: QuarantineRerunner = async () => {
      throw new Error('runner must not be called for an unresolvable test file');
    };
    const result = await repairLapsedQuarantine(
      project,
      { apply: true, runs: 5, concurrency: 2, sha: FRESH_SHA, runner },
    );

    const decision = result.decisions.find((d) => d.test === test);
    expect(decision).toBeDefined();
    expect(decision?.outcome).toBe('re-quarantined');
    expect(decision?.runs).toBe(4);
    expect(decision?.passRuns).toBe(2);
    expect(decision?.failRuns).toBe(2);

    const rows = listTestQuarantine(project).filter((r) => r.test === test);
    expect(rows).toHaveLength(1);
    expect(rows[0].ttlExpiresAt).toBeGreaterThan(PAST_TTL);
  });

  it('the resolved count equals the seeded lapsed count and is greater than zero', async () => {
    const scopedProject = canonicalProjectRoot(mkdtempSync(join(tmpdir(), 'repair-lapsed-quarantine-project2-')));
    try {
      const tests = ['src/a.test.ts > a', 'src/b.test.ts > b', 'src/c.test.ts > c'];
      for (const test of tests) {
        upsertQuarantine({
          project: scopedProject,
          test,
          quarantinedAtSha: SEED_SHA,
          evidence: { runs: 3, passRuns: 3, failRuns: 0 },
          ttlExpiresAt: PAST_TTL,
          seededFrom: null,
        });
      }

      const runner: QuarantineRerunner = async () => ({ runs: 5, passRuns: 5, failRuns: 0 });
      const result = await repairLapsedQuarantine(
        scopedProject,
        { apply: true, runs: 5, concurrency: 3, sha: FRESH_SHA, runner },
      );

      expect(result.resolved).toBe(tests.length);
      expect(result.resolved).toBe(result.lapsed);
      expect(result.resolved).toBeGreaterThan(0);
    } finally {
      rmSync(scopedProject, { recursive: true, force: true });
    }
  });

  it('a run over a project with zero lapsed rows exits nonzero', async () => {
    const emptyProject = canonicalProjectRoot(mkdtempSync(join(tmpdir(), 'repair-lapsed-quarantine-empty-')));
    try {
      const result = await repairLapsedQuarantine(emptyProject, { apply: false, sha: FRESH_SHA });
      expect(result.lapsed).toBe(0);
      expect(repairExitCode(result)).not.toBe(0);
    } finally {
      rmSync(emptyProject, { recursive: true, force: true });
    }
  });
});
