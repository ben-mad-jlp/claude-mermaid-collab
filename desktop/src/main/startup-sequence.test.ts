import { describe, test, expect } from 'bun:test';
import { runStartupSequence, type StartupTimeline } from './startup-sequence';

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

describe('runStartupSequence', () => {
  test('startSidecar is invoked before connectRemotes even when connectRemotes never resolves', async () => {
    const callOrder: string[] = [];
    let connectRemotesCalled = false;

    const sidecarDeferred = makeDeferred<{ port: number; attached: boolean }>();

    const sequence = runStartupSequence({
      startSidecar: () => {
        callOrder.push('startSidecar');
        return sidecarDeferred.promise;
      },
      connectRemotes: () => {
        // This should only be called AFTER startSidecar has been invoked (but not necessarily awaited)
        connectRemotesCalled = true;
        callOrder.push('connectRemotes');
        return makeDeferred<void>().promise; // never resolves
      },
      remoteBudgetMs: 50,
      clock: () => 0,
    });

    // Ensure startSidecar was already invoked synchronously before we even await
    expect(callOrder).toContain('startSidecar');
    expect(callOrder[0]).toBe('startSidecar');

    // Resolve the sidecar
    const sidecarValue = { port: 9002, attached: false };
    sidecarDeferred.resolve(sidecarValue);

    // Wait a bit for microtasks
    await new Promise((r) => setTimeout(r, 10));

    // Now connectRemotes should have been called
    expect(connectRemotesCalled).toBe(true);
    expect(callOrder.indexOf('startSidecar')).toBeLessThan(callOrder.indexOf('connectRemotes'));

    // Sequence should still resolve with sidecar after timeout
    const result = await sequence;
    expect(result).toBe(sidecarValue);
  });

  test('connectRemotes is called with the resolved sidecar value', async () => {
    const sidecarValue = { port: 9003, attached: true };
    let receivedSidecar: any = null;

    const sequence = runStartupSequence({
      startSidecar: async () => sidecarValue,
      connectRemotes: (sidecar) => {
        receivedSidecar = sidecar;
        return Promise.resolve();
      },
      remoteBudgetMs: 5000,
      clock: () => 0,
    });

    await sequence;
    expect(receivedSidecar).toBe(sidecarValue);
  });

  test('remote phase is abandoned and the sequence still returns the sidecar when the budget expires', async () => {
    const sidecarValue = { port: 9004, attached: false };
    const timelines: StartupTimeline[] = [];
    let clockValue = 1000;

    const sequence = runStartupSequence({
      startSidecar: async () => sidecarValue,
      connectRemotes: () => {
        // Never resolve
        return makeDeferred<void>().promise;
      },
      remoteBudgetMs: 100,
      clock: () => clockValue,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    const result = await sequence;

    expect(result).toBe(sidecarValue);
    expect(timelines.length).toBe(1);
    expect(timelines[0].remoteOutcome).toBe('abandoned');
    expect(timelines[0].remoteStartedAt).not.toBeNull();
    expect(timelines[0].remoteResolvedAt).toBeNull();
  });

  test('a connectRemotes rejection after abandonment is caught and does not rethrow or escape as unhandled', async () => {
    const sidecarValue = { port: 9005, attached: false };
    const timelines: StartupTimeline[] = [];
    let clockValue = 2000;
    let unhandledRejectionCaught = false;

    const connectRemotesDeferred = makeDeferred<void>();

    const sequence = runStartupSequence({
      startSidecar: async () => sidecarValue,
      connectRemotes: () => connectRemotesDeferred.promise,
      remoteBudgetMs: 50,
      clock: () => clockValue,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    // Set up unhandled rejection handler
    const unhandledRejectionHandler = () => {
      unhandledRejectionCaught = true;
    };
    process.on('unhandledRejection', unhandledRejectionHandler);

    // Wait for sequence to resolve (after timeout)
    const result = await sequence;
    expect(result).toBe(sidecarValue);

    // Timeline should show abandoned
    expect(timelines.length).toBe(1);
    expect(timelines[0].remoteOutcome).toBe('abandoned');

    // Now reject the deferred after abandonment
    connectRemotesDeferred.reject(new Error('late rejection'));

    // Wait a microtask to allow any unhandled rejection to surface
    await new Promise((r) => setTimeout(r, 10));

    expect(unhandledRejectionCaught).toBe(false);

    // Clean up
    process.off('unhandledRejection', unhandledRejectionHandler);
  });

  test('connectRemotes resolves within budget and records ok outcome', async () => {
    const sidecarValue = { port: 9006, attached: true };
    const timelines: StartupTimeline[] = [];
    let clockValue = 3000;

    const sequence = runStartupSequence({
      startSidecar: async () => sidecarValue,
      connectRemotes: async () => {
        // Resolve immediately
        return Promise.resolve();
      },
      remoteBudgetMs: 5000,
      clock: () => {
        const current = clockValue;
        clockValue += 100; // Advance time for each call
        return current;
      },
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    const result = await sequence;

    expect(result).toBe(sidecarValue);
    expect(timelines.length).toBe(1);
    expect(timelines[0].remoteOutcome).toBe('ok');
    expect(timelines[0].remoteStartedAt).not.toBeNull();
    expect(timelines[0].remoteResolvedAt).not.toBeNull();
    expect(timelines[0].remoteResolvedAt! >= timelines[0].remoteStartedAt!).toBe(true);
  });

  test('spawn timing is recorded correctly with injected clock', async () => {
    let clockValue = 1000;
    const clock = () => clockValue;
    const timelines: StartupTimeline[] = [];

    const sequence = runStartupSequence({
      startSidecar: async () => {
        clockValue = 1100;
        return { port: 9007, attached: false };
      },
      connectRemotes: async () => {
        clockValue = 1200;
        return Promise.resolve();
      },
      remoteBudgetMs: 5000,
      clock,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    await sequence;

    const timeline = timelines[0];
    expect(timeline.spawnIssuedAt).toBe(1000);
    expect(timeline.spawnResolvedAt).toBe(1100);
    expect(timeline.remoteStartedAt).toBe(1100); // captured after sidecar resolves
  });

  test('onTimeline is called exactly once per sequence', async () => {
    const timelines: StartupTimeline[] = [];

    const sequence = runStartupSequence({
      startSidecar: async () => ({ port: 9008, attached: false }),
      connectRemotes: async () => Promise.resolve(),
      remoteBudgetMs: 5000,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    await sequence;
    expect(timelines.length).toBe(1);
  });

  test('connectRemotes receives the resolved sidecar even if startSidecar takes time', async () => {
    const sidecarValue = { port: 9009, attached: true };
    let receivedValue: any = null;

    const startupDelay = new Promise<typeof sidecarValue>((resolve) => {
      setTimeout(() => resolve(sidecarValue), 50);
    });

    const sequence = runStartupSequence({
      startSidecar: () => startupDelay,
      connectRemotes: (sidecar) => {
        receivedValue = sidecar;
        return Promise.resolve();
      },
      remoteBudgetMs: 5000,
    });

    await sequence;
    expect(receivedValue).toBe(sidecarValue);
  });

  test('never calls teardown on the sidecar', async () => {
    const teardownCalls: string[] = [];

    const fakeStopMethod = () => {
      teardownCalls.push('stop');
    };

    const sidecarWithStop = {
      port: 9010,
      attached: false,
      stop: fakeStopMethod,
      kill: fakeStopMethod,
      teardown: fakeStopMethod,
    };

    await runStartupSequence({
      startSidecar: async () => sidecarWithStop,
      connectRemotes: async () => Promise.resolve(),
      remoteBudgetMs: 5000,
    });

    expect(teardownCalls.length).toBe(0);
  });

  test('abandoned outcome sets remoteStartedAt but not remoteResolvedAt', async () => {
    const timelines: StartupTimeline[] = [];

    await runStartupSequence({
      startSidecar: async () => ({ port: 9011, attached: false }),
      connectRemotes: () => makeDeferred<void>().promise, // never resolves
      remoteBudgetMs: 30,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    const timeline = timelines[0];
    expect(timeline.remoteOutcome).toBe('abandoned');
    expect(timeline.remoteStartedAt).not.toBeNull();
    expect(timeline.remoteResolvedAt).toBeNull();
  });

  test('failed outcome when connectRemotes rejects', async () => {
    const timelines: StartupTimeline[] = [];

    await runStartupSequence({
      startSidecar: async () => ({ port: 9012, attached: false }),
      connectRemotes: () => Promise.reject(new Error('connection failed')),
      remoteBudgetMs: 5000,
      onTimeline: (t) => {
        timelines.push(t);
      },
    });

    const timeline = timelines[0];
    expect(timeline.remoteOutcome).toBe('failed');
    expect(timeline.remoteStartedAt).not.toBeNull();
    expect(timeline.remoteResolvedAt).not.toBeNull();
  });
});
