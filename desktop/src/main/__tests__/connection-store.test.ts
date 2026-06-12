import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConnectionStore, type InstanceLiveness } from '../connection-store';

// Deterministic round-trip without Electron's native keyring.
const fakeSafeStorage = {
  encryptString: (s: string) => Buffer.from('enc:' + s),
  decryptString: (b: Buffer) => b.toString().replace(/^enc:/, ''),
};

let userDataDir: string;
let instancesDir: string;

// Default: treat every discovered instance as live (the real probe does a TCP
// connect, which these fixture ports don't answer). Individual tests override
// to exercise the phantom-reaping path.
async function makeStore(
  isInstanceLive: (inst: InstanceLiveness) => boolean | Promise<boolean> = () => true,
): Promise<ConnectionStore> {
  const store = new ConnectionStore({ userDataDir, instancesDir, safeStorage: fakeSafeStorage, isInstanceLive });
  await store.init();
  return store;
}

async function writeInstance(port: number, project = '/repo', session = 's'): Promise<void> {
  await mkdir(instancesDir, { recursive: true });
  const inst = {
    version: 1, sessionId: randomUUID().slice(0, 12), port, project, session,
    pid: 1, startedAt: new Date().toISOString(), serverVersion: '0',
  };
  await writeFile(join(instancesDir, `${inst.sessionId}.json`), JSON.stringify(inst));
}

describe('ConnectionStore', () => {
  beforeEach(async () => {
    const base = join(tmpdir(), 'mc-store-' + randomUUID());
    userDataDir = join(base, 'userData');
    instancesDir = join(base, 'instances');
    await mkdir(userDataDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(join(userDataDir, '..'), { recursive: true, force: true });
  });

  it('list() omits the token field', async () => {
    const store = await makeStore();
    store.add({ label: 'T', host: '127.0.0.1', port: 3000, token: 'secret' });
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect('token' in listed[0]).toBe(false);
  });

  it('add() returns an id and get() retrieves the full entry incl. token', async () => {
    const store = await makeStore();
    const id = store.add({ label: 'T', host: '127.0.0.1', port: 3000, token: 'secret' });
    expect(typeof id).toBe('string');
    expect(store.get(id)?.token).toBe('secret');
  });

  it('setToken() sets, clears, and persists the token on an existing entry', async () => {
    const s1 = await makeStore();
    const id = s1.add({ label: 'T', host: '127.0.0.1', port: 3000 });
    expect(s1.get(id)?.token).toBeUndefined();
    s1.setToken(id, 'minted-on-launch');
    expect(s1.get(id)?.token).toBe('minted-on-launch');
    // setToken on an unknown id is a no-op (does not throw / create an entry).
    s1.setToken('no-such-id', 'x');
    // empty string clears the token rather than storing ''
    s1.setToken(id, '');
    expect(s1.get(id)?.token).toBeUndefined();
    s1.setToken(id, 'persisted');
    await s1.flush();
    const s2 = await makeStore();
    expect(s2.get(id)?.token).toBe('persisted');
  });

  it('remove() deletes the entry', async () => {
    const store = await makeStore();
    const id = store.add({ label: 'T', host: '127.0.0.1', port: 3000 });
    store.remove(id);
    expect(store.get(id)).toBeNull();
  });

  it('persists encrypted token and decrypts it on reload', async () => {
    const s1 = await makeStore();
    const id = s1.add({ label: 'T', host: '127.0.0.1', port: 3000, token: 'secret' });
    // allow the fire-and-forget persist to flush
    await new Promise((r) => setTimeout(r, 20));
    const s2 = await makeStore();
    expect(s2.get(id)?.token).toBe('secret');
  });

  it('flush() awaits the fire-and-forget add() write so it is durable', async () => {
    const s1 = await makeStore();
    const id = s1.add({ label: 'T', host: '127.0.0.1', port: 3000, token: 'secret' });
    // No setTimeout — flush() must guarantee the scheduled write has landed.
    await s1.flush();
    const s2 = await makeStore();
    expect(s2.get(id)?.token).toBe('secret');
  });

  it('flush() awaits a remove() write so the deletion is durable', async () => {
    const s1 = await makeStore();
    const id = s1.add({ label: 'T', host: '127.0.0.1', port: 3000 });
    s1.remove(id);
    await s1.flush();
    const s2 = await makeStore();
    expect(s2.get(id)).toBeNull();
  });

  it('refreshLocal() auto-lists instance files as local entries', async () => {
    await writeInstance(4001, '/repo', 'a');
    await writeInstance(4002, '/repo', 'b');
    const store = await makeStore();
    await store.refreshLocal();
    const locals = store.list().filter((e) => e.source === 'local');
    expect(locals).toHaveLength(2);
    expect(locals.map((e) => e.port).sort()).toEqual([4001, 4002]);
    // Local servers are labeled by hostname (host:port disambiguates them).
    expect(locals.find((e) => e.port === 4001)?.label).toBe(hostname());
  });

  it('refreshLocal() dedupes against a manual entry on the same host:port', async () => {
    const store = await makeStore();
    store.add({ label: 'manual', host: '127.0.0.1', port: 4000 });
    await writeInstance(4000);
    await store.refreshLocal();
    expect(store.list().filter((e) => e.port === 4000)).toHaveLength(1);
  });

  it('refreshLocal() prunes stale local entries', async () => {
    await writeInstance(4001);
    const store = await makeStore();
    await store.refreshLocal();
    expect(store.list().filter((e) => e.source === 'local')).toHaveLength(1);
    await rm(instancesDir, { recursive: true, force: true });
    await store.refreshLocal();
    expect(store.list().filter((e) => e.source === 'local')).toHaveLength(0);
  });

  it('refreshLocal() tolerates a missing instances dir', async () => {
    const store = await makeStore(); // instancesDir not created
    await expect(store.refreshLocal()).resolves.toBeUndefined();
  });

  it('refreshLocal() does NOT list a non-live instance file (phantom dead-port)', async () => {
    // A SIGKILL'd server leaves its instance file behind; liveness says dead.
    await writeInstance(9011);
    const store = await makeStore(() => false);
    await store.refreshLocal();
    expect(store.list().filter((e) => e.source === 'local')).toHaveLength(0);
  });

  it('refreshLocal() reaps an existing local entry once its instance goes non-live', async () => {
    // First pass: the server is live → an entry is created and marked online.
    await writeInstance(9012);
    let live = true;
    const store = await makeStore(() => live);
    await store.refreshLocal();
    const before = store.list().filter((e) => e.source === 'local');
    expect(before).toHaveLength(1);
    expect(before[0].status).toBe('online');
    // The server is SIGKILL'd but its instance file lingers; next refresh must
    // drop the phantom rather than keep re-registering it forever.
    live = false;
    await store.refreshLocal();
    expect(store.list().filter((e) => e.source === 'local')).toHaveLength(0);
  });

  it('refreshLocal() only probes liveness with the record pid + port', async () => {
    await writeInstance(4007, '/repo', 's');
    const seen: InstanceLiveness[] = [];
    const store = await makeStore((inst) => { seen.push(inst); return true; });
    await store.refreshLocal();
    expect(seen).toContainEqual({ pid: 1, port: 4007, host: '127.0.0.1' });
  });

  it('setStatusByHostPort() updates a matching entry and is durable', async () => {
    const s1 = await makeStore();
    const id = s1.add({ label: 'T', host: '127.0.0.1', port: 3000 });
    expect(s1.get(id)?.status).toBe('offline');
    s1.setStatusByHostPort('127.0.0.1', 3000, 'online');
    expect(s1.get(id)?.status).toBe('online');
    await s1.flush();
    const s2 = await makeStore();
    expect(s2.get(id)?.status).toBe('online');
  });

  it('setStatusByHostPort() no-ops when no entry matches', async () => {
    const store = await makeStore();
    expect(() => store.setStatusByHostPort('127.0.0.1', 9999, 'online')).not.toThrow();
  });
});
