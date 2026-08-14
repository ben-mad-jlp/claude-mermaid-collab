/**
 * Proves the quarantine expiry sweep is still REACHABLE from resolveBaseGreen — now via the
 * single runQuarantineCeremonies entry point that fires after a FRESH gate run settles.
 *
 * History: this file originally pinned the opposite — a sweep BEFORE the cache read, so even
 * a fully-cached project announced expiries. That pre-cache call made every cached hit pay a
 * quarantine-store read (audit item 6), so the sweep moved behind the per-project ceremony
 * throttle AFTER the cache check. Safe because activeQuarantine's own TTL filter already
 * stops expired rows from matching (the sweep only renews/announces, never gates
 * correctness), and the conductor probe path now fires the same entry point, so a
 * cache-honouring executor no longer strands the bookkeeping. The cached-hit zero-cost pin
 * lives in quarantine-ceremony-clock.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveBaseGreen } from '../leaf-gate';
import { setQuarantineExpiryHook, _resetCeremonyThrottle, type QuarantineExpiryEvent } from '../flaky-quarantine';
import {
  listTestQuarantine,
  writeTestQuarantine,
  removeTestQuarantine,
} from '../worker-ledger';

const PROJECT = `/tmp/quarantine-reach-${process.pid}`;
const EPIC_ID = `reach-epic-${process.pid}`;
const BASE_SHA = `sha-reach-${process.pid}`;
const NOW = Date.now();

beforeEach(() => {
  for (const r of listTestQuarantine(PROJECT)) removeTestQuarantine(PROJECT, r.test);
  setQuarantineExpiryHook(() => {});
  _resetCeremonyThrottle();
});

afterEach(() => {
  for (const r of listTestQuarantine(PROJECT)) removeTestQuarantine(PROJECT, r.test);
  setQuarantineExpiryHook(() => {});
  _resetCeremonyThrottle();
});

describe('resolveBaseGreen fresh-gate path', () => {
  it('sweeps an expired quarantine row after a fresh (uncached) gate run settles', async () => {
    const createdAt = NOW - 2 * 60 * 60_000;
    writeTestQuarantine(
      {
        project: PROJECT,
        test: 'lapsed.test',
        quarantinedAtSha: 'sha0',
        evidence: { runs: 3, passRuns: 1, failRuns: 2 },
        ttlExpiresAt: NOW - 1000,
        seededFrom: '',
      },
      createdAt,
    );

    const events: QuarantineExpiryEvent[] = [];
    setQuarantineExpiryHook((e) => { events.push(e); });

    const result = await resolveBaseGreen({
      epicId: EPIC_ID,
      project: PROJECT,
      targetProject: PROJECT,
      epicBaseSha: BASE_SHA,
      gateCfg: { command: 'echo ok' } as any,
      ensureEpicWorktree: async () => ({ path: '/tmp/unused' }),
      runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true } as any),
      now: () => NOW,
    });

    expect(result?.status).toBe('pass');
    expect(result?.fresh).toBe(true);

    expect(events.length).toBe(1);
    expect(events[0].test).toBe('lapsed.test');

    // The sweep announces, it never deletes — the row stays (activeQuarantine's TTL filter
    // is what stops it matching).
    const row = listTestQuarantine(PROJECT).find((r) => r.test === 'lapsed.test');
    expect(row).toBeDefined();
  });
});
