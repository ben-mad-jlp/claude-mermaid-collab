/**
 * Coverage for the in-process single-flight coalescer around `runBaseGate`
 * (mission cbffd616): concurrent same-key callers must share one underlying run,
 * distinct keys/settled-then-recalled keys must each get a fresh run, and a rejection
 * must reach every waiter before the entry is cleared for the next call.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { runBaseGate, type GateSpawn, type LeafGateConfig } from '../leaf-gate';
import { baseGateKey, runBaseGateShared, resetBaseGateCoalescer, listInflightBaseGates } from '../base-gate-coalescer';

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

const CWD = '/tmp/base-gate-coalescer-fixture';

const CFG: LeafGateConfig = {
  typecheck: 'npx tsc --noEmit',
  suites: [{ match: /^src\//, command: 'bun test', cwd: undefined }],
  baseTest: 'bun run base-test',
};

const GREEN_SCRIPT = {
  'npx tsc --noEmit': { ran: true, code: 0, output: '' },
  'bun test': { ran: true, code: 0, output: '' },
  'bun run base-test': { ran: true, code: 0, output: '' },
};

beforeEach(() => {
  resetBaseGateCoalescer();
});

describe('runBaseGateShared', () => {
  it('coalesces K=5 concurrent same-key calls into one underlying run', async () => {
    const { spawn, calls } = stubSpawn(GREEN_SCRIPT);
    let runCount = 0;
    const key = baseGateKey('proj', 'sha1', CFG);
    const thunk = () => {
      runCount++;
      return runBaseGate(CWD, CFG, spawn);
    };
    const promises = Array.from({ length: 5 }, () => runBaseGateShared(key, thunk));
    const results = await Promise.all(promises);

    expect(runCount).toBe(1);
    expect(calls.length).toBe(3); // typecheck, bun test (no suite lane match needed), base-test
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
  });

  it('runs twice for two keys differing only in baseSha', async () => {
    const { spawn } = stubSpawn(GREEN_SCRIPT);
    let runCount = 0;
    const thunk = () => {
      runCount++;
      return runBaseGate(CWD, CFG, spawn);
    };
    const keyA = baseGateKey('proj', 'sha1', CFG);
    const keyB = baseGateKey('proj', 'sha2', CFG);
    await Promise.all([runBaseGateShared(keyA, thunk), runBaseGateShared(keyB, thunk)]);

    expect(runCount).toBe(2);
  });

  it('runs again for the same key after the first call has settled', async () => {
    const { spawn } = stubSpawn(GREEN_SCRIPT);
    let runCount = 0;
    const key = baseGateKey('proj', 'sha1', CFG);
    const thunk = () => {
      runCount++;
      return runBaseGate(CWD, CFG, spawn);
    };
    await runBaseGateShared(key, thunk);
    await runBaseGateShared(key, thunk);

    expect(runCount).toBe(2);
  });

  it('delivers a rejection to every waiter, then re-runs on the next call', async () => {
    const key = baseGateKey('proj', 'sha1', CFG);
    let runCount = 0;
    const err = new Error('spawn exploded');
    const failingThunk = () => {
      runCount++;
      return Promise.reject(err);
    };
    const promises = Array.from({ length: 5 }, () => runBaseGateShared(key, failingThunk));
    const settled = await Promise.allSettled(promises);

    expect(runCount).toBe(1);
    for (const s of settled) {
      expect(s.status).toBe('rejected');
      if (s.status === 'rejected') expect(s.reason).toBe(err);
    }

    // The entry was cleared on settle — the next call for the same key runs again.
    const { spawn } = stubSpawn(GREEN_SCRIPT);
    const result = await runBaseGateShared(key, () => {
      runCount++;
      return runBaseGate(CWD, CFG, spawn);
    });
    expect(runCount).toBe(2);
    expect(result.status).toBe('pass');
  });

  it('a synchronous-throw thunk still becomes a rejected promise for every waiter', async () => {
    const key = baseGateKey('proj', 'sha1', CFG);
    const err = new Error('threw before returning a promise');
    const throwingThunk = (): Promise<import('../leaf-gate').LeafGateResult> => {
      throw err;
    };
    const promises = Array.from({ length: 3 }, () => runBaseGateShared(key, throwingThunk));
    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      expect(s.status).toBe('rejected');
      if (s.status === 'rejected') expect(s.reason).toBe(err);
    }
  });

  it('single-caller equivalence: a shared call deep-equals a direct runBaseGate call', async () => {
    const scriptA = stubSpawn(GREEN_SCRIPT);
    const scriptB = stubSpawn(GREEN_SCRIPT);
    const key = baseGateKey('proj', 'sha1', CFG);

    const shared = await runBaseGateShared(key, () => runBaseGate(CWD, CFG, scriptA.spawn));
    const direct = await runBaseGate(CWD, CFG, scriptB.spawn);

    expect(shared).toEqual(direct);
    expect(scriptA.calls).toEqual(scriptB.calls);
  });
});

describe('listInflightBaseGates', () => {
  const PASS: import('../leaf-gate').LeafGateResult = { status: 'pass', output: '', reasons: [], declared: true };

  it('exposes a pending run (with project/baseSha/epicId/startedAt), accretes coalescing epics, and drops the entry on settle', async () => {
    let resolveRun!: (r: import('../leaf-gate').LeafGateResult) => void;
    const key = baseGateKey('proj', 'sha1', CFG);
    const before = Date.now();
    const p = runBaseGateShared(
      key,
      () => new Promise((res) => { resolveRun = res; }),
      { project: 'proj', epicId: 'epicA' },
    );

    const list = listInflightBaseGates();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe(key);
    expect(list[0].project).toBe('proj');
    expect(list[0].baseSha).toBe('sha1');
    expect(list[0].epicIds).toEqual(['epicA']);
    expect(list[0].running).toBe(true); // free slots ⇒ executing, not queued
    expect(list[0].startedAt).toBeGreaterThanOrEqual(before);

    // A sibling epic coalescing onto the same key is recorded as waiting on this run.
    const p2 = runBaseGateShared(key, () => { throw new Error('must coalesce, never run'); }, { project: 'proj', epicId: 'epicB' });
    expect([...listInflightBaseGates()[0].epicIds].sort()).toEqual(['epicA', 'epicB']);

    resolveRun(PASS);
    await Promise.all([p, p2]);
    expect(listInflightBaseGates()).toHaveLength(0);
  });

  it('reports running=false for a gate queued behind the concurrency cap', async () => {
    const resolvers: Array<(r: import('../leaf-gate').LeafGateResult) => void> = [];
    const pending = () => new Promise<import('../leaf-gate').LeafGateResult>((res) => { resolvers.push(res); });
    // Default global cap is 2 — the third distinct key must queue.
    const ps = ['sha1', 'sha2', 'sha3'].map((sha, i) =>
      runBaseGateShared(baseGateKey('proj' + i, sha, CFG), pending, { project: 'proj' + i, epicId: 'epic' + i }));
    const byShaQueued = listInflightBaseGates().find((g) => g.baseSha === 'sha3');
    expect(listInflightBaseGates()).toHaveLength(3);
    expect(listInflightBaseGates().filter((g) => g.running)).toHaveLength(2);
    expect(byShaQueued?.running).toBe(false);

    // Drain: each settle releases a slot, which hands off to the queued gate a few
    // microtasks later — flush repeatedly, resolving whatever run has started.
    for (let i = 0; i < 20; i++) {
      while (resolvers.length > 0) resolvers.shift()!(PASS);
      await Promise.resolve();
    }
    await Promise.all(ps);
    expect(listInflightBaseGates()).toHaveLength(0);
  });

  it('a foreign (non-baseGateKey) key still lists, with the caller project and a null sha', async () => {
    let resolveRun!: (r: import('../leaf-gate').LeafGateResult) => void;
    const p = runBaseGateShared('opaque-key', () => new Promise((res) => { resolveRun = res; }), { project: 'projX' });
    const list = listInflightBaseGates();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'opaque-key', project: 'projX', baseSha: null, epicIds: [] });
    resolveRun(PASS);
    await p;
    expect(listInflightBaseGates()).toHaveLength(0);
  });
});

describe('baseGateKey', () => {
  it('is deterministic across two calls with structurally-equal cfgs', () => {
    const cfgA: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      suites: [{ match: /^src\//, command: 'bun test', cwd: 'pkg-a' }],
    };
    const cfgB: LeafGateConfig = {
      typecheck: 'npx tsc --noEmit',
      suites: [{ match: /^src\//, command: 'bun test', cwd: 'pkg-a' }],
    };
    expect(baseGateKey('proj', 'sha1', cfgA)).toBe(baseGateKey('proj', 'sha1', cfgB));
  });

  it('differs when a lane cwd differs with an identical command', () => {
    const cfgA: LeafGateConfig = {
      suites: [{ match: /^src\//, command: 'bun test', cwd: 'pkg-a' }],
    };
    const cfgB: LeafGateConfig = {
      suites: [{ match: /^src\//, command: 'bun test', cwd: 'pkg-b' }],
    };
    expect(baseGateKey('proj', 'sha1', cfgA)).not.toBe(baseGateKey('proj', 'sha1', cfgB));
  });

  it('yields a distinct, still-stable key for cfg === null', () => {
    const k1 = baseGateKey('proj', 'sha1', null);
    const k2 = baseGateKey('proj', 'sha1', null);
    expect(k1).toBe(k2);
    expect(k1).not.toBe(baseGateKey('proj', 'sha1', CFG));
  });
});
