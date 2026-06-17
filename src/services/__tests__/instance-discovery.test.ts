import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, type Server } from 'net';
import { lock } from 'proper-lockfile';
import {
  getDiscoveryPaths,
  readInstances,
  writeInstance,
  isPidAlive,
  isPortListening,
  type Instance,
  type DiscoveryPaths,
} from '../instance-discovery';

const DEAD_PID = 2147483646; // implausibly high → ESRCH

let home: string;
let paths: DiscoveryPaths;

async function writeRecord(inst: Partial<Instance> & { sessionId: string }): Promise<void> {
  await mkdir(paths.instancesDir, { recursive: true });
  const full: Instance = {
    version: 1,
    sessionId: inst.sessionId,
    port: inst.port ?? 9011,
    project: inst.project ?? '/repo',
    session: inst.session ?? 's',
    pid: inst.pid ?? DEAD_PID,
    startedAt: inst.startedAt ?? new Date().toISOString(),
    serverVersion: inst.serverVersion ?? '0',
  };
  await writeFile(paths.instanceFile(full.sessionId), JSON.stringify(full, null, 2));
  // proper-lockfile expects the target lock file to exist (writeInstance does this).
  await writeFile(paths.lockFile(full.sessionId), '');
}

describe('instance-discovery liveness helpers', () => {
  it('isPidAlive() is true for this process and false for a dead pid', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(DEAD_PID)).toBe(false);
  });

  it('isPortListening() is false for an unused port', async () => {
    await expect(isPortListening(1, '127.0.0.1', 300)).resolves.toBe(false);
  });

  it('isPortListening() is true for a port with a live listener', async () => {
    const server: Server = createServer();
    const port: number = await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    try {
      await expect(isPortListening(port, '127.0.0.1', 500)).resolves.toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('readInstances reaping', () => {
  beforeEach(async () => {
    home = join(tmpdir(), 'mc-inst-' + Math.random().toString(36).slice(2));
    paths = getDiscoveryPaths(home);
    await mkdir(paths.instancesDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('reaps a stale instance file whose pid is dead', async () => {
    await writeRecord({ sessionId: 'deadpid01', pid: DEAD_PID, port: 9011 });
    const live = await readInstances(paths);
    expect(live).toHaveLength(0);
    // The .json (and its lock) are gone — self-healed.
    const remaining = (await readdir(paths.instancesDir)).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(0);
    expect(existsSync(paths.instanceFile('deadpid01'))).toBe(false);
  });

  it('reaps a record whose pid is alive but nothing is listening on its port', async () => {
    // pid-reuse case: our own pid is alive, but the recorded port is dead.
    await writeRecord({ sessionId: 'reused01', pid: process.pid, port: 1 });
    const live = await readInstances(paths);
    expect(live).toHaveLength(0);
    expect(existsSync(paths.instanceFile('reused01'))).toBe(false);
  });

  it('keeps a record whose owning process still holds its lock (live server)', async () => {
    // A genuinely-live server holds its instance lock for its lifetime, so a
    // reader from another process hits ELOCKED → the pid-alive branch returns it.
    await writeRecord({ sessionId: 'liveone01', pid: process.pid, port: 9011 });
    const release = await lock(paths.lockFile('liveone01'), { realpath: false, retries: 0 });
    try {
      const live = await readInstances(paths);
      expect(live.map((i) => i.sessionId)).toContain('liveone01');
      expect(existsSync(paths.instanceFile('liveone01'))).toBe(true);
    } finally {
      await release();
    }
  });
});

describe('writeInstance hot-swap stale-lock steal (49e3c1f6)', () => {
  beforeEach(async () => {
    home = join(tmpdir(), 'mc-inst-' + Math.random().toString(36).slice(2));
    paths = getDiscoveryPaths(home);
    await mkdir(paths.instancesDir, { recursive: true });
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const inst = (sessionId: string, pid: number): Instance => ({
    version: 1, sessionId, port: 9011, project: '/repo', session: 's',
    pid, startedAt: new Date().toISOString(), serverVersion: '0',
  });

  it('steals a stale lock whose owner pid is DEAD (hot-swap respawn) and registers', async () => {
    // Simulate a SIGKILL'd predecessor: a record with a dead pid + a held lock.
    await writeRecord({ sessionId: 'hs-dead-01', pid: DEAD_PID });
    const release = await lock(paths.lockFile('hs-dead-01'), { realpath: false, retries: 0 });
    try {
      // The respawn must NOT throw — it steals the orphan lock and registers.
      await writeInstance(inst('hs-dead-01', process.pid), paths);
      expect(existsSync(paths.instanceFile('hs-dead-01'))).toBe(true);
    } finally {
      await release().catch(() => { /* stolen out from under us — expected */ });
    }
  });

  it('still throws Duplicate when the lock owner is ALIVE (genuine conflict)', async () => {
    // A live owner (this process pid) — must NOT be stolen.
    await writeRecord({ sessionId: 'hs-live-01', pid: process.pid });
    const release = await lock(paths.lockFile('hs-live-01'), { realpath: false, retries: 0 });
    try {
      await expect(writeInstance(inst('hs-live-01', process.pid), paths)).rejects.toThrow(/Duplicate instance/);
    } finally {
      await release();
    }
  });
});
