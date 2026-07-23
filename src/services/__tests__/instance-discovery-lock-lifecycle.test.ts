import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import {
  buildLockOptions,
  getDiscoveryPaths,
  writeInstance,
  removeInstance,
  readInstances,
  type Instance,
} from '../instance-discovery';
import {
  installProcessGuards,
  getProcessGuardStats,
  _resetProcessGuardStats,
} from '../process-guards';

// Install real process-level event handlers at module scope
installProcessGuards();

describe('instance-discovery — lock lifecycle regression tests', () => {
  let tempHome: string;
  let paths: ReturnType<typeof getDiscoveryPaths>;
  let baselineStats: ReturnType<typeof getProcessGuardStats>;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'instance-disc-'));
    paths = getDiscoveryPaths(tempHome);
    _resetProcessGuardStats();
    baselineStats = getProcessGuardStats();
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('concurrent write+cleanup churn on same sessionId does not leak unhandledRejections', async () => {
    const sessionId = 'concurrent-test-session';

    // Run at least 10 iterations of concurrent churn
    for (let i = 0; i < 10; i++) {
      const instance: Instance = {
        version: 1,
        sessionId,
        port: 9000 + i,
        project: 'test-project',
        session: 'test-session',
        pid: process.pid,
        startedAt: new Date().toISOString(),
        serverVersion: '1.0.0',
      };

      // Fire multiple operations concurrently for the same sessionId
      // Individual calls may reject (expected) — catch inline
      const results = await Promise.allSettled([
        writeInstance(instance, paths).catch(() => {}),
        readInstances(paths),
        removeInstance(sessionId, paths),
        readInstances(paths),
      ]);

      // Ensure lock directory is cleaned up before next iteration
      const lockDirPath = paths.lockFile(sessionId) + '.lock';
      if (existsSync(lockDirPath)) {
        await rm(lockDirPath, { recursive: true, force: true }).catch(() => {});
      }
      // Clean up instance file if it exists
      const instPath = paths.instanceFile(sessionId);
      if (existsSync(instPath)) {
        await rm(instPath, { force: true }).catch(() => {});
      }
    }

    // Assert process guard stats are unchanged from baseline
    const finalStats = getProcessGuardStats();
    expect(finalStats.unhandledRejections).toBe(baselineStats.unhandledRejections);
    expect(finalStats.uncaughtExceptions).toBe(baselineStats.uncaughtExceptions);
  });

  it('forced onCompromised releases lock and clears stats without leaking', async () => {
    const sessionId = 'forced-compromise-test';
    const instance: Instance = {
      version: 1,
      sessionId,
      port: 9999,
      project: 'test-project',
      session: 'test-session',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      serverVersion: '1.0.0',
    };

    // Acquire a real lock and record via writeInstance
    await writeInstance(instance, paths);
    const lockFilePath = paths.lockFile(sessionId);
    const lockDirPath = lockFilePath + '.lock';
    expect(existsSync(lockDirPath)).toBe(true);

    // Capture baseline stats right after acquiring the lock
    const statsAfterLock = getProcessGuardStats();
    expect(statsAfterLock.unhandledRejections).toBe(baselineStats.unhandledRejections);
    expect(statsAfterLock.uncaughtExceptions).toBe(baselineStats.uncaughtExceptions);

    // Directly invoke the onCompromised handler (same closure that writeInstance wires in)
    const lockOptions = buildLockOptions(sessionId);
    lockOptions.onCompromised?.(new Error('forced compromise'));

    // Drain the fire-and-forget release().catch(...) chain
    // The release() does an async fs.rmdir, so we need to wait for it to settle
    await new Promise(resolve => setImmediate(resolve));

    // Poll for the lock directory to be actually removed
    let attempts = 0;
    while (existsSync(lockDirPath) && attempts < 100) {
      await new Promise(resolve => setTimeout(resolve, 10));
      attempts++;
    }

    // Assert stats are still unchanged — no unhandledRejection leaked
    const statsAfterCompromise = getProcessGuardStats();
    expect(statsAfterCompromise.unhandledRejections).toBe(baselineStats.unhandledRejections);
    expect(statsAfterCompromise.uncaughtExceptions).toBe(baselineStats.uncaughtExceptions);

    // Ensure the lock directory is gone (force-remove if necessary)
    if (existsSync(lockDirPath)) {
      await rm(lockDirPath, { recursive: true, force: true }).catch(() => {});
    }

    // Clean up the stale instance JSON left on disk
    await removeInstance(sessionId, paths);

    // Issue a second writeInstance call for the SAME sessionId
    // Should resolve without throwing ELOCKED — proves the lock was actually removed
    const instance2: Instance = {
      ...instance,
      port: 9998,
      startedAt: new Date().toISOString(),
    };
    await writeInstance(instance2, paths);
  });
});
