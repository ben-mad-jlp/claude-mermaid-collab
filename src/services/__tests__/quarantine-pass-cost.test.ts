/**
 * The quarantine pass must be cheap per record, refuse systemic reds, and prune its own table.
 *
 * MEASURED 2026-08-11: closeQuarantineOnGreen read the WHOLE project's observations
 * (~1.86M rows) once per quarantine record — 330 records after a schema-error storm
 * mass-promoted an entire red suite as "flaky" — after EVERY gate, on the synchronous event
 * loop. Health probes starved; the watchdog SIGKILLed the sidecar repeatedly. Three separate
 * defects, each pinned here:
 *   1. per-record project-wide materialisation (the db-latency-guard's founding incident,
 *      re-created verbatim) — pinned by counting project-wide SQL, not by timing
 *   2. no mass-promotion cap (a systemic red is not 330 simultaneous flakes)
 *   3. pruneBaseGateTestRuns existed with ZERO callers while the table grew ~500k rows/day
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  closeQuarantineOnGreen,
  promoteQuarantineCandidates,
  MASS_PROMOTION_CAP,
} from '../flaky-quarantine';
import {
  recordBaseGateTestRuns,
  listTestQuarantine,
  writeTestQuarantine,
  removeTestQuarantine,
  pruneBaseGateTestRuns,
  listObservations,
} from '../worker-ledger';

const PROJECT = `/tmp/quarantine-cost-${process.pid}`;
const NOW = Date.now();

/** Seed one observation; `at` controls observedAt via the writer's `now` param. */
function seedObservation(test: string, failed: boolean, at: number) {
  recordBaseGateTestRuns(
    { project: PROJECT, baseSha: 'sha1', lane: 'fast', ranTests: [test], failingTests: failed ? [test] : [], scope: 'base' },
    at,
  );
}

function quarantine(test: string, createdAt: number) {
  writeTestQuarantine(
    { project: PROJECT, test, quarantinedAtSha: 'sha0', evidence: { runs: 3, passRuns: 1, failRuns: 2 }, ttlExpiresAt: NOW + 86_400_000, seededFrom: null },
    createdAt,
  );
}

/** Count executions of the PROJECT-WIDE observation SQL during fn. */
async function countProjectWideReads(fn: () => Promise<void>): Promise<number> {
  let n = 0;
  const orig = Database.prototype.prepare;
  (Database.prototype as unknown as Record<string, unknown>).prepare = function (this: Database, sql: string) {
    if (/FROM base_gate_test_run WHERE project=\? AND observedAt>=/.test(sql)) n++;
    return orig.call(this, sql);
  };
  try { await fn(); } finally {
    (Database.prototype as unknown as Record<string, unknown>).prepare = orig;
  }
  return n;
}

beforeEach(() => {
  for (const r of listTestQuarantine(PROJECT)) removeTestQuarantine(PROJECT, r.test);
});

describe('closeQuarantineOnGreen reads per TEST, not per PROJECT', () => {
  it('closes a green quarantine WITHOUT issuing the project-wide observation query', async () => {
    quarantine('green.test', NOW - 60_000);
    seedObservation('green.test', false, NOW - 1000);
    seedObservation('noisy.other.test', true, NOW - 1000); // must simply not matter

    const wideReads = await countProjectWideReads(() => closeQuarantineOnGreen(PROJECT, NOW));

    // The record closes AND the whole-project reader was never used. At 1.8M rows the
    // project-wide read WAS the entire cost — reverting to it fails this, not a timing check.
    expect(listTestQuarantine(PROJECT).some((r) => r.test === 'green.test')).toBe(false);
    expect(wideReads).toBe(0);
  });

  it('keeps a quarantine open when the test failed again since', async () => {
    quarantine('still.red.test', NOW - 60_000);
    seedObservation('still.red.test', true, NOW - 1000);

    await closeQuarantineOnGreen(PROJECT, NOW);

    expect(listTestQuarantine(PROJECT).some((r) => r.test === 'still.red.test')).toBe(true);
  });
});

describe('mass promotion is refused as a systemic red', () => {
  it(`refuses when more than ${MASS_PROMOTION_CAP} tests flip at once, writing NOTHING`, () => {
    // A systemic storm that MEETS the per-test flake criteria (same sha, >=minRuns, both
    // outcomes) for every test at once — e.g. a schema error that reds alternating runs. Each
    // test individually looks flaky; only the simultaneity says systemic.
    for (let i = 0; i < MASS_PROMOTION_CAP + 10; i++) {
      seedObservation(`storm.test.${i}`, false, NOW - 3_600_000);
      seedObservation(`storm.test.${i}`, true, NOW - 1_800_000);
      seedObservation(`storm.test.${i}`, false, NOW - 1000);
    }

    const out = promoteQuarantineCandidates(PROJECT, NOW);

    expect(out).toEqual([]);
    // The 330-row storm re-upserted every pass; the refusal must be total, not partial.
    expect(listTestQuarantine(PROJECT)).toEqual([]);
  });
});

describe('the observation table prunes itself', () => {
  it('pruneBaseGateTestRuns removes rows older than retention (force bypasses the throttle)', () => {
    seedObservation('ancient.test', false, NOW - 30 * 24 * 60 * 60_000);
    seedObservation('recent.test', false, NOW - 1000);

    const deleted = pruneBaseGateTestRuns(NOW, true);

    expect(deleted).toBeGreaterThanOrEqual(1);
    const tests = listObservations(PROJECT, 0).map((o) => o.test);
    expect(tests).toContain('recent.test');
    expect(tests).not.toContain('ancient.test');
  });
});
