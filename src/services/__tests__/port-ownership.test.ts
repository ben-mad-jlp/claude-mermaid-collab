import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireExclusive,
  compareVersions,
  isRightfulOwner,
  writeLock,
  readLock,
  releaseLock,
  lockPath,
  performHandshake,
  type ServerIdentity,
} from '../port-ownership';

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-portown-'));
  env = { XDG_RUNTIME_DIR: tmp, PORT: '9002' };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('acquireExclusive (O_EXCL mutex)', () => {
  it('only ONE of N concurrent acquirers wins the race', async () => {
    const file = path.join(tmp, 'race.lock');
    // Fire many acquirers "simultaneously" — O_EXCL makes creation atomic, so
    // exactly one must observe a fresh-create and the rest must see EEXIST.
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => Promise.resolve().then(() => acquireExclusive(file, `winner-${i}`))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    // The winner's contents are the ones persisted.
    expect(fs.readFileSync(file, 'utf8')).toMatch(/^winner-\d+$/);
  });

  it('returns false (not throw) when the file already exists', () => {
    const file = path.join(tmp, 'exists.lock');
    expect(acquireExclusive(file, 'a')).toBe(true);
    expect(acquireExclusive(file, 'b')).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('a');
  });
});

describe('lockfile read/write/release', () => {
  it('round-trips a lock record and releases only its own pid', () => {
    writeLock({ pid: 1234, exePath: '/x/mc-server', version: '5.90.1', port: 9002, owner: 'headless' }, env);
    expect(readLock(env)).toMatchObject({ pid: 1234, port: 9002, owner: 'headless' });
    // A non-matching pid must not delete the lock.
    releaseLock(9999, env);
    expect(readLock(env)).not.toBeNull();
    // The owning pid releases it.
    releaseLock(1234, env);
    expect(readLock(env)).toBeNull();
  });

  it('readLock returns null on corrupt content', () => {
    fs.mkdirSync(path.dirname(lockPath(env)), { recursive: true });
    fs.writeFileSync(lockPath(env), 'not json');
    expect(readLock(env)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('5.90.1', '5.90.1')).toBe(0);
    expect(compareVersions('5.90.0', '5.90.1')).toBe(-1);
    expect(compareVersions('5.91.0', '5.90.9')).toBe(1);
    expect(compareVersions('5.9.0', '5.90.0')).toBe(-1);
  });
});

describe('isRightfulOwner', () => {
  const self = { exePath: '/opt/mc/mc-server', version: '5.90.1' };
  const id = (over: Partial<ServerIdentity>): ServerIdentity => ({
    ok: true, version: '5.90.1', pid: 1, exePath: '/opt/mc/mc-server', startedAt: '', owner: 'desktop', ...over,
  });

  it('same exe + same-or-newer version → rightful', () => {
    expect(isRightfulOwner(id({}), self)).toBe(true);
    expect(isRightfulOwner(id({ version: '5.91.0' }), self)).toBe(true);
  });
  it('different exe → not rightful (the shadow)', () => {
    expect(isRightfulOwner(id({ exePath: '/tmp/stale/mc-server' }), self)).toBe(false);
  });
  it('same exe but older version → not rightful (stale)', () => {
    expect(isRightfulOwner(id({ version: '5.80.0' }), self)).toBe(false);
  });
  it('empty self.exePath (dev mode) falls back to version match', () => {
    expect(isRightfulOwner(id({ exePath: '/tmp/whatever' }), { exePath: '', version: '5.90.1' })).toBe(true);
    expect(isRightfulOwner(id({ exePath: '/tmp/whatever', version: '5.80.0' }), { exePath: '', version: '5.90.1' })).toBe(false);
  });
});

describe('performHandshake', () => {
  const self = { exePath: '/opt/mc/mc-server', version: '5.90.1', owner: 'headless' };

  it('port free → proceed and claims the lock via O_EXCL', async () => {
    const r = await performHandshake({
      env, self,
      portInUseImpl: async () => false,
    });
    expect(r.action).toBe('proceed');
    expect(readLock(env)).toMatchObject({ pid: process.pid, port: 9002 });
  });

  it('rightful owner present → defer (no kill)', async () => {
    let killed = false;
    const r = await performHandshake({
      env, self,
      portInUseImpl: async () => true,
      fetchImpl: makeHealthFetch({ version: '5.90.1', pid: 42, exePath: '/opt/mc/mc-server', owner: 'desktop' }),
      killImpl: () => { killed = true; },
    });
    expect(r.action).toBe('defer');
    expect(killed).toBe(false);
  });

  it('stale shadow (older version) + takeover → evicts and proceeds', async () => {
    const signals: NodeJS.Signals[] = [];
    let inUse = true;
    const r = await performHandshake({
      env, self, guardMode: 'takeover',
      portInUseImpl: async () => inUse,
      fetchImpl: makeHealthFetch({ version: '5.80.0', pid: 4242, exePath: '/tmp/stale/mc-server', owner: 'dev' }),
      killImpl: (_pid, sig) => { signals.push(sig); inUse = false; },
      termGraceMs: 200,
      portFreeTimeoutMs: 500,
    });
    expect(r.action).toBe('proceed');
    expect(signals[0]).toBe('SIGTERM');
  });

  it('stale shadow + refuse mode → refuse (no kill)', async () => {
    let killed = false;
    const r = await performHandshake({
      env, self, guardMode: 'refuse',
      portInUseImpl: async () => true,
      fetchImpl: makeHealthFetch({ version: '5.80.0', pid: 4242, exePath: '/tmp/stale/mc-server', owner: 'dev' }),
      killImpl: () => { killed = true; },
    });
    expect(r.action).toBe('refuse');
    expect(killed).toBe(false);
  });

  it('port held but health dead, holder unknown → refuse (never kill blindly)', async () => {
    const r = await performHandshake({
      env, self,
      portInUseImpl: async () => true,
      fetchImpl: (async () => { throw new Error('no answer'); }) as unknown as typeof fetch,
    });
    expect(r.action).toBe('refuse');
    expect(r.reason).toBe('held-by-unknown-process');
  });
});

/** Build a fetch stub that answers /api/health with the given identity fields. */
function makeHealthFetch(identity: Partial<ServerIdentity>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ ok: true, ...identity }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}
