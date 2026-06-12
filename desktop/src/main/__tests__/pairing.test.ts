/**
 * [P4a] Pairing state + allowPeer gate (design §2, optional defense-in-depth).
 *
 * A discovered instance is `pending` (no longer auto-trusted); pairing it makes
 * crossServerCall succeed. Pure UX state + a gate — no handshake/tokens/grants.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConnectionStore } from '../connection-store';
import { crossServerCall, allowPeer, type RemoteEnvelope, type RemoteInvoker } from '../remote-boundary';

const fakeSafeStorage = {
  encryptString: (s: string) => Buffer.from('enc:' + s),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
};

let userDataDir: string;
let instancesDir: string;

async function makeStore(): Promise<ConnectionStore> {
  const store = new ConnectionStore({ userDataDir, instancesDir, safeStorage: fakeSafeStorage });
  await store.init();
  return store;
}

async function writeInstance(port: number): Promise<void> {
  await mkdir(instancesDir, { recursive: true });
  const inst = { version: 1, sessionId: randomUUID().slice(0, 12), port, project: '/repo', session: 's', pid: 1, startedAt: new Date().toISOString(), serverVersion: '0' };
  await writeFile(join(instancesDir, `${inst.sessionId}.json`), JSON.stringify(inst));
}

const okInvoker: RemoteInvoker = vi.fn(async (): Promise<RemoteEnvelope> => ({ ok: true, status: 200, body: { ok: true } }));

describe('[P4a] ConnectionStore pairing state', () => {
  beforeEach(async () => {
    const base = join(tmpdir(), 'mc-pair-' + randomUUID());
    userDataDir = join(base, 'userData');
    instancesDir = join(base, 'instances');
    await mkdir(userDataDir, { recursive: true });
  });
  afterEach(async () => { await rm(join(userDataDir, '..'), { recursive: true, force: true }); });

  it('a DISCOVERED instance enters pending (not auto-trusted)', async () => {
    await writeInstance(4001);
    const store = await makeStore();
    await store.refreshLocal();
    const local = store.list().find((e) => e.port === 4001)!;
    expect(local.pairing).toBe('pending');
    expect(store.isPaired(local.id)).toBe(false);
  });

  it('a MANUAL add is paired from the start (explicit trust)', async () => {
    const store = await makeStore();
    const id = store.add({ label: 'M', host: '10.0.0.2', port: 9000 });
    expect(store.isPaired(id)).toBe(true);
  });

  it('pair() promotes a pending peer to paired (persisted)', async () => {
    await writeInstance(4002);
    const s1 = await makeStore();
    await s1.refreshLocal();
    const id = s1.list().find((e) => e.port === 4002)!.id;
    s1.pair(id);
    await s1.flush();
    expect(s1.isPaired(id)).toBe(true);
    // Persisted across reload.
    const s2 = await makeStore();
    expect(s2.isPaired(id)).toBe(true);
  });

  it('unpair() deletes the row; it re-discovers as pending', async () => {
    await writeInstance(4003);
    const store = await makeStore();
    await store.refreshLocal();
    const id = store.list().find((e) => e.port === 4003)!.id;
    store.pair(id);
    store.unpair(id);
    expect(store.get(id)).toBeNull();
    await store.refreshLocal(); // instance still live → re-appears, pending again
    const reborn = store.list().find((e) => e.port === 4003)!;
    expect(reborn.pairing).toBe('pending');
  });

  it('pairLocalByPort auto-pairs only the primary (others stay pending)', async () => {
    await writeInstance(5000);
    await writeInstance(5001);
    const store = await makeStore();
    await store.refreshLocal();
    store.pairLocalByPort(5000);
    expect(store.isPaired(store.list().find((e) => e.port === 5000)!.id)).toBe(true);
    expect(store.isPaired(store.list().find((e) => e.port === 5001)!.id)).toBe(false);
  });

  it('legacy persisted entry (no pairing field) defaults to paired on load', async () => {
    // Hand-write a pre-pairing servers.json.
    await writeFile(join(userDataDir, 'servers.json'), JSON.stringify({
      entries: [{ id: 'legacy', label: 'L', host: '10.0.0.9', port: 8000, status: 'offline', source: 'manual', icon: 'Star' }],
    }));
    const store = await makeStore();
    expect(store.isPaired('legacy')).toBe(true);
  });
});

describe('[P4a] allowPeer gate wired into crossServerCall (ACCEPTANCE)', () => {
  beforeEach(async () => {
    const base = join(tmpdir(), 'mc-pair-acc-' + randomUUID());
    userDataDir = join(base, 'userData');
    instancesDir = join(base, 'instances');
    await mkdir(userDataDir, { recursive: true });
  });
  afterEach(async () => { await rm(join(userDataDir, '..'), { recursive: true, force: true }); vi.clearAllMocks(); });

  it('a PENDING peer is rejected by allowPeer; pairing it lets crossServerCall succeed', async () => {
    await writeInstance(4100);
    const store = await makeStore();
    await store.refreshLocal();
    const id = store.list().find((e) => e.port === 4100)!.id;
    const isPaired = (sid: string) => store.isPaired(sid);

    // Pending → allowPeer false → crossServerCall 403 peer_not_paired, no invoke.
    expect(allowPeer(id, isPaired)).toBe(false);
    const blocked = await crossServerCall(okInvoker, id, { path: '/api/x' }, isPaired);
    expect(blocked).toEqual({ ok: false, status: 403, body: { error: 'peer_not_paired' } });
    expect(okInvoker).not.toHaveBeenCalled();

    // Pair it → allowPeer true → crossServerCall invokes and succeeds.
    store.pair(id);
    expect(allowPeer(id, isPaired)).toBe(true);
    const ok = await crossServerCall(okInvoker, id, { path: '/api/x' }, isPaired);
    expect(ok.ok).toBe(true);
    expect(okInvoker).toHaveBeenCalledTimes(1);
  });

  it("the 'local'/empty sentinel is always allowed (primary never gated)", () => {
    const nonePaired = () => false;
    expect(allowPeer('local', nonePaired)).toBe(true);
    expect(allowPeer('', nonePaired)).toBe(true);
  });

  it('with no predicate, allowPeer is a pass-through (P2 behaviour preserved)', () => {
    expect(allowPeer('anything')).toBe(true);
  });
});
