import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStartupSequence, type StartupTimeline } from './startup-sequence';
import { ConnectionStore, type SafeStorageLike } from './connection-store';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: any) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('first-launch local spawn', () => {
  let tempDir: string;
  let store: ConnectionStore;
  let clockValue: number;

  const clock = () => clockValue;

  const fakeSafeStorage: SafeStorageLike = {
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  };

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'first-launch-local-spawn-'));
    clockValue = 0;

    // Write servers.json with one unreachable manual entry
    const serversJson = {
      entries: [
        {
          id: 'trimaxion-1',
          label: 'trimaxion',
          host: '192.0.2.1',
          port: 9002,
          status: 'offline',
          source: 'manual',
          icon: 'Circle',
          pairing: 'paired' as const,
        },
      ],
      forgotten: [],
    };
    const serversFilePath = path.join(tempDir, 'servers.json');
    writeFileSync(serversFilePath, JSON.stringify(serversJson), 'utf-8');

    store = new ConnectionStore({
      userDataDir: tempDir,
      safeStorage: fakeSafeStorage,
      isInstanceLive: async () => false, // Keep refreshLocal from touching real pid/socket probing
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('startSidecar is issued at t0 and the sequence resolves without waiting on the unreachable remote entry', async () => {
    const startSidecarCalls: { calledAt: number }[] = [];
    const timelines: StartupTimeline[] = [];
    const remoteDeferred = makeDeferred<void>();

    const sidecarValue = { port: 9002, attached: false };

    const sequence = runStartupSequence({
      startSidecar: () => {
        startSidecarCalls.push({ calledAt: clock() });
        return Promise.resolve(sidecarValue);
      },
      connectRemotes: async () => {
        await store.init();
        await remoteDeferred.promise;
      },
      remoteBudgetMs: 50,
      clock,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    // Assertion (a): spawn is issued at t0
    expect(startSidecarCalls.length).toBe(1);
    expect(startSidecarCalls[0].calledAt).toBe(0);

    // Await the sequence — it should resolve after the budget timeout, not wait for remoteDeferred
    const result = await sequence;

    // Verify the sequence resolved with the sidecar
    expect(result).toBe(sidecarValue);
    expect(timelines.length).toBe(1);
    expect(timelines[0].remoteOutcome).toBe('abandoned');
  });

  test('a late-resolving remote connect after the sequence returns never calls stop or kill on the sidecar', async () => {
    const stopCalls = { count: 0 };
    const killCalls = { count: 0 };
    const timelines: StartupTimeline[] = [];
    const remoteDeferred = makeDeferred<void>();

    const sidecarValue = {
      port: 9002,
      attached: false,
      stop: () => {
        stopCalls.count++;
      },
      kill: () => {
        killCalls.count++;
      },
    };

    const sequence = runStartupSequence({
      startSidecar: () => {
        return Promise.resolve(sidecarValue);
      },
      connectRemotes: async () => {
        await store.init();
        await remoteDeferred.promise;
      },
      remoteBudgetMs: 50,
      clock,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    // Await the sequence — it should resolve after the budget timeout
    const result = await sequence;

    // Verify the sequence resolved
    expect(result).toBe(sidecarValue);
    expect(timelines[0].remoteOutcome).toBe('abandoned');

    // Late-resolve the deferred after the sequence has already resolved
    remoteDeferred.resolve();

    // Wait a microtask flush
    await new Promise((r) => setTimeout(r, 10));

    // Assertion (b): stop and kill should never be called
    expect(stopCalls.count).toBe(0);
    expect(killCalls.count).toBe(0);

    // Verify the sidecar reference is still the same
    expect(result.port).toBe(9002);
  });

  test('a late-rejecting remote connect after the sequence returns raises no unhandled rejection', async () => {
    const timelines: StartupTimeline[] = [];
    const remoteDeferred = makeDeferred<void>();
    let unhandledRejectionCaught = false;

    const sidecarValue = { port: 9002, attached: false };

    // Register unhandled rejection handler
    const unhandledRejectionHandler = () => {
      unhandledRejectionCaught = true;
    };
    process.on('unhandledRejection', unhandledRejectionHandler);

    try {
      const sequence = runStartupSequence({
        startSidecar: () => {
          return Promise.resolve(sidecarValue);
        },
        connectRemotes: async () => {
          await store.init();
          await remoteDeferred.promise;
        },
        remoteBudgetMs: 50,
        clock,
        onTimeline: (t) => {
          timelines.push(t);
        },
      });

      // Await the sequence — it should resolve after the budget timeout
      const result = await sequence;

      // Verify the sequence resolved with abandoned outcome
      expect(result).toBe(sidecarValue);
      expect(timelines.length).toBe(1);
      expect(timelines[0].remoteOutcome).toBe('abandoned');

      // Late-reject the deferred after the sequence has already resolved
      remoteDeferred.reject(new Error('unreachable: trimaxion'));

      // Wait a microtask flush
      await new Promise((r) => setTimeout(r, 10));

      // Assertion (c): no unhandled rejection should be caught
      expect(unhandledRejectionCaught).toBe(false);
    } finally {
      // Clean up
      process.off('unhandledRejection', unhandledRejectionHandler);
    }
  });
});
