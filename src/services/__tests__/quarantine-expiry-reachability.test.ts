/**
 * Proves the quarantine expiry sweep is reached on the HONOURED-cache branch of
 * resolveBaseGreen, not only on a cache miss / fresh gate run. Before the fix a project
 * answering entirely from the epic_base_gate cache never reached
 * sweepExpiringQuarantine, so a past-TTL row could lapse with no recorded outcome.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveBaseGreen } from '../leaf-gate';
import { setQuarantineExpiryHook, type QuarantineExpiryEvent } from '../flaky-quarantine';
import {
  recordEpicBaseGate,
  listTestQuarantine,
  writeTestQuarantine,
  removeTestQuarantine,
} from '../worker-ledger';

const PROJECT = `/tmp/quarantine-reach-${process.pid}`;
const EPIC_ID = 'reach-epic';
const BASE_SHA = 'sha-reach';
const NOW = Date.now();

beforeEach(() => {
  for (const r of listTestQuarantine(PROJECT)) removeTestQuarantine(PROJECT, r.test);
  setQuarantineExpiryHook(() => {});
});

afterEach(() => {
  for (const r of listTestQuarantine(PROJECT)) removeTestQuarantine(PROJECT, r.test);
  setQuarantineExpiryHook(() => {});
});

describe('resolveBaseGreen honoured-cache path', () => {
  it('sweeps an expired quarantine row on the honoured cached base-gate path', async () => {
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

    recordEpicBaseGate(
      {
        epicId: EPIC_ID,
        project: PROJECT,
        baseSha: BASE_SHA,
        status: 'pass',
        command: 'echo ok',
        output: '',
      },
      NOW - 60_000,
    );

    const events: QuarantineExpiryEvent[] = [];
    setQuarantineExpiryHook((e) => { events.push(e); });

    let ensureWorktreeCalled = false;
    let runGateCalled = false;

    const result = await resolveBaseGreen({
      epicId: EPIC_ID,
      project: PROJECT,
      targetProject: PROJECT,
      epicBaseSha: BASE_SHA,
      gateCfg: { command: 'echo ok' } as any,
      ensureEpicWorktree: async () => { ensureWorktreeCalled = true; return { path: '/tmp/unused' }; },
      runGate: async () => { runGateCalled = true; return { status: 'pass', output: '', reasons: [], declared: true } as any; },
      now: () => NOW,
    });

    expect(ensureWorktreeCalled).toBe(false);
    expect(runGateCalled).toBe(false);
    expect(result?.status).toBe('pass');
    expect(result?.fresh).toBe(false);

    expect(events.length).toBe(1);
    expect(events[0].test).toBe('lapsed.test');

    const row = listTestQuarantine(PROJECT).find((r) => r.test === 'lapsed.test');
    expect(row).toBeDefined();
  });
});
