/**
 * runQuarantineCeremonies: the FOUR quarantine ceremonies (expiry-sweep → promote →
 * close-on-green → prune) behind ONE per-project 5-minute clock, and OFF the cached-hit path.
 *
 * Audit item 6: every base-gate resolution used to fire all four inline and unthrottled —
 * the expiry sweep even ran BEFORE the epic_base_gate cache read, so a fully-cached hit
 * still paid a quarantine-store read. Pinned here:
 *   1. the per-project throttle (two calls inside CEREMONY_INTERVAL_MS → one run)
 *   2. per-project independence (project B is not blocked by project A's clock)
 *   3. order + best-effort (a throwing promote never blocks close/prune)
 *   4. a cached resolveBaseGreen hit performs ZERO quarantine-store reads
 *      (VERIFIED FAILS ON MASTER 2026-08-13: the pre-cache maintainQuarantineExpiry call
 *      at leaf-gate.ts:1245 issued `SELECT * FROM test_quarantine` on every cached hit —
 *      this test red with 1 read against master's leaf-gate.ts.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  runQuarantineCeremonies,
  _resetCeremonyThrottle,
  CEREMONY_INTERVAL_MS,
} from '../flaky-quarantine';
import { resolveBaseGreen } from '../leaf-gate';
import { recordEpicBaseGate } from '../worker-ledger';

const PROJECT = `/tmp/ceremony-clock-${process.pid}`;
const NOW = Date.now();

beforeEach(() => { _resetCeremonyThrottle(); });
afterEach(() => { _resetCeremonyThrottle(); });

/** Spy deps: record each step invocation as `${name}` in `calls`. */
function spyDeps(calls: string[], opts?: { promoteThrows?: boolean }) {
  return {
    sweepExpiringQuarantine: async () => { calls.push('sweep'); },
    promoteQuarantineCandidates: () => {
      calls.push('promote');
      if (opts?.promoteThrows) throw new Error('promote boom');
      return [];
    },
    closeQuarantineOnGreen: async () => { calls.push('close'); },
    pruneBaseGateTestRuns: () => { calls.push('prune'); return 0; },
  };
}

describe('per-project ceremony throttle', () => {
  it('runs the sweeps once for two calls inside the interval, again after it', async () => {
    const calls: string[] = [];

    expect(await runQuarantineCeremonies(PROJECT, NOW, spyDeps(calls))).toBe(true);
    expect(await runQuarantineCeremonies(PROJECT, NOW + CEREMONY_INTERVAL_MS - 1, spyDeps(calls))).toBe(false);
    expect(calls).toEqual(['sweep', 'promote', 'close', 'prune']);

    // Advancing the injected clock past the interval re-arms the project.
    expect(await runQuarantineCeremonies(PROJECT, NOW + CEREMONY_INTERVAL_MS, spyDeps(calls))).toBe(true);
    expect(calls).toEqual(['sweep', 'promote', 'close', 'prune', 'sweep', 'promote', 'close', 'prune']);
  });

  it('a different project is not blocked by the first project\'s clock', async () => {
    const calls: string[] = [];

    expect(await runQuarantineCeremonies(PROJECT, NOW, spyDeps(calls))).toBe(true);
    expect(await runQuarantineCeremonies(`${PROJECT}-other`, NOW + 1, spyDeps(calls))).toBe(true);
    expect(calls).toEqual(['sweep', 'promote', 'close', 'prune', 'sweep', 'promote', 'close', 'prune']);
  });
});

describe('ceremony order and best-effort', () => {
  it('runs sweep → promote → close → prune, and a throwing promote never blocks close/prune', async () => {
    const calls: string[] = [];

    expect(await runQuarantineCeremonies(PROJECT, NOW, spyDeps(calls, { promoteThrows: true }))).toBe(true);

    expect(calls).toEqual(['sweep', 'promote', 'close', 'prune']);
  });
});

/** Count prepares of ANY test_quarantine SQL during fn (the whole quarantine store surface),
 *  same interception pattern as quarantine-pass-cost.test.ts's countProjectWideReads. */
async function countQuarantineStoreReads(fn: () => Promise<void>): Promise<number> {
  let n = 0;
  const orig = Database.prototype.prepare;
  (Database.prototype as unknown as Record<string, unknown>).prepare = function (this: Database, sql: string, ...rest: unknown[]) {
    if (/FROM test_quarantine/.test(sql)) n++;
    return (orig as Function).call(this, sql, ...rest);
  };
  try { await fn(); } finally {
    (Database.prototype as unknown as Record<string, unknown>).prepare = orig;
  }
  return n;
}

describe('cached-hit cost', () => {
  it('resolveBaseGreen serving a cached base-gate row performs ZERO quarantine-store reads', async () => {
    const epicId = `ceremony-cached-epic-${process.pid}`;
    const baseSha = `sha-ceremony-${process.pid}`;
    recordEpicBaseGate(
      { epicId, project: PROJECT, baseSha, status: 'pass', command: 'echo ok', output: '' },
      NOW - 60_000,
    );

    let result: Awaited<ReturnType<typeof resolveBaseGreen>> = null as Awaited<ReturnType<typeof resolveBaseGreen>>;
    const reads = await countQuarantineStoreReads(async () => {
      result = await resolveBaseGreen({
        epicId,
        project: PROJECT,
        targetProject: PROJECT,
        epicBaseSha: baseSha,
        gateCfg: { command: 'echo ok' } as any,
        ensureEpicWorktree: async () => { throw new Error('cached hit must not build a worktree'); },
        runGate: async () => { throw new Error('cached hit must not run the gate'); },
        now: () => NOW,
      });
    });

    expect(result?.status).toBe('pass');
    expect(result?.fresh).toBe(false);
    // The pin for the pre-cache maintainQuarantineExpiry bug: on master this is 1.
    expect(reads).toBe(0);
  });
});
