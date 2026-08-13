/**
 * The renew-or-announce sweep over lapsing quarantine rows: a row still classifying as
 * flaky is renewed with fresh evidence; a row genuinely past TTL is announced via the
 * expiry hook exactly once (repeat sweeps must not duplicate the friction note); a
 * manifest-seeded row is never blind-renewed.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { sweepExpiringQuarantine, QUARANTINE_RENEWAL_WINDOW_MS, type QuarantineExpiryEvent } from '../flaky-quarantine';
import { runQuarantineExpiryReport } from '../flaky-quarantine-report';
import {
  recordBaseGateTestRuns,
  listTestQuarantine,
  writeTestQuarantine,
  removeTestQuarantine,
} from '../worker-ledger';

const PROJECT = `/tmp/quarantine-expiry-${process.pid}`;
const NOW = Date.now();

function seedObservation(test: string, failed: boolean, at: number) {
  recordBaseGateTestRuns(
    { project: PROJECT, baseSha: 'sha1', lane: 'fast', ranTests: [test], failingTests: failed ? [test] : [], scope: 'base' },
    at,
  );
}

function quarantine(test: string, opts: { ttlExpiresAt: number; createdAt: number; seededFrom?: string | null; quarantinedAtSha?: string }) {
  writeTestQuarantine(
    {
      project: PROJECT,
      test,
      quarantinedAtSha: opts.quarantinedAtSha ?? 'sha0',
      evidence: { runs: 3, passRuns: 1, failRuns: 2 },
      ttlExpiresAt: opts.ttlExpiresAt,
      seededFrom: opts.seededFrom ?? null,
    },
    opts.createdAt,
  );
}

beforeEach(() => {
  for (const r of listTestQuarantine(PROJECT)) removeTestQuarantine(PROJECT, r.test);
});

describe('sweepExpiringQuarantine', () => {
  it('renews a still-flipping row with fresh evidence and a later ttlExpiresAt', async () => {
    const createdAt = NOW - 2 * 60 * 60_000;
    quarantine('flipping.test', { ttlExpiresAt: NOW + 30 * 60_000, createdAt });
    // Fresh evidence since createdAt: qualifies as flaky (same sha, >=3 runs, both outcomes).
    seedObservation('flipping.test', false, createdAt + 1000);
    seedObservation('flipping.test', true, createdAt + 2000);
    seedObservation('flipping.test', false, createdAt + 3000);

    const events: QuarantineExpiryEvent[] = [];
    await sweepExpiringQuarantine(PROJECT, NOW, { expiryHook: (e) => { events.push(e); } });

    const row = listTestQuarantine(PROJECT).find((r) => r.test === 'flipping.test');
    expect(row).toBeDefined();
    expect(row!.ttlExpiresAt).toBeGreaterThan(NOW + 30 * 60_000);
    expect(row!.evidence).toEqual({ runs: 3, passRuns: 2, failRuns: 1 });
    expect(events).toEqual([]);
  });

  it('lapses a green-only row and announces quarantine-expired exactly once across two sweeps', async () => {
    const createdAt = NOW - 2 * 60 * 60_000;
    quarantine('green.only.test', { ttlExpiresAt: NOW - 1000, createdAt });
    seedObservation('green.only.test', false, createdAt + 1000);

    let accept = true;
    const details: string[] = [];
    const recordFrictionOnce = async (_project: string, input: { detail: string }) => {
      details.push(input.detail);
      const inserted = accept;
      accept = false;
      return inserted;
    };

    await sweepExpiringQuarantine(PROJECT, NOW, {
      expiryHook: (e) => runQuarantineExpiryReport(e, { recordFrictionOnce }),
    });
    await sweepExpiringQuarantine(PROJECT, NOW, {
      expiryHook: (e) => runQuarantineExpiryReport(e, { recordFrictionOnce }),
    });

    expect(details.length).toBe(2);
    expect(details[0]).toBe(details[1]);
    expect(JSON.parse(details[0]).key).toBe('quarantine-expired:green.only.test');

    // The row itself is left in the store; only its TTL match stops.
    expect(listTestQuarantine(PROJECT).some((r) => r.test === 'green.only.test')).toBe(true);
  });

  it('never blind-renews a manifest-seeded row', async () => {
    const createdAt = NOW - 2 * 60 * 60_000;
    quarantine('manifest.test', { ttlExpiresAt: NOW + 30 * 60_000, createdAt, seededFrom: 'manifest', quarantinedAtSha: 'manifest' });
    // Even with fresh flaky-looking evidence, a manifest row must not be renewed.
    seedObservation('manifest.test', false, createdAt + 1000);
    seedObservation('manifest.test', true, createdAt + 2000);
    seedObservation('manifest.test', false, createdAt + 3000);

    const events: QuarantineExpiryEvent[] = [];
    await sweepExpiringQuarantine(PROJECT, NOW, { expiryHook: (e) => { events.push(e); } });

    const row = listTestQuarantine(PROJECT).find((r) => r.test === 'manifest.test');
    expect(row).toBeDefined();
    expect(row!.ttlExpiresAt).toBe(NOW + 30 * 60_000);
    expect(row!.quarantinedAtSha).toBe('manifest');
    // Not yet past TTL, so no announcement either — it's lapsing but not expired.
    expect(events).toEqual([]);
  });

  it('window constant matches QUARANTINE_RENEWAL_WINDOW_MS export', () => {
    expect(QUARANTINE_RENEWAL_WINDOW_MS).toBe(60 * 60_000);
  });
});
