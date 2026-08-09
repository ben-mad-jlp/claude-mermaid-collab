/**
 * Tests for the memoised, single-flighted trunk trailer index.
 *
 * Coverage: memo cache invalidation on tip-sha change, single-flight coalescer,
 * prefix-based epic-id lookup, and failure-not-cached paths.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getTrunkLandIndex,
  lookupEpicLand,
  resetTrunkLandIndex,
  type TrunkLandEntry,
} from '../trunk-land-index';
import type { GitRunner } from '../epic-landedness';

/** Counting fake GitRunner: tracks every call and returns scripted outputs. */
function fakeGitRunner() {
  const callLog: Array<{ args: string[] }> = [];

  let revParseOutput: { code: number; stdout: string } = { code: 0, stdout: 'abc123def456\n' };
  let logOutput: { code: number; stdout: string } = { code: 0, stdout: '' };

  const runner: GitRunner = async (cwd: string, args: string[]) => {
    callLog.push({ args });

    if (args[0] === 'rev-parse') {
      return revParseOutput;
    } else if (args[0] === 'log') {
      return logOutput;
    }

    throw new Error(`unexpected git command: ${args[0]}`);
  };

  return {
    runner,
    callLog,
    setRevParseOutput: (output: { code: number; stdout: string }) => {
      revParseOutput = output;
    },
    setLogOutput: (output: { code: number; stdout: string }) => {
      logOutput = output;
    },
  };
}

const PROJECT = '/tmp/test-project';
const TRUNK = 'master';

beforeEach(() => {
  resetTrunkLandIndex();
});

describe('getTrunkLandIndex', () => {
  it('cold call issues exactly one log invocation', async () => {
    const fake = fakeGitRunner();
    fake.setLogOutput({
      code: 0,
      stdout: '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n',
    });

    const result = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);

    const logCalls = fake.callLog.filter((c) => c.args[0] === 'log');
    expect(logCalls.length).toBe(1);
    expect(result).toBeDefined();
    expect(result!.size).toBe(1);
  });

  it('second call at same tip sha issues zero further log invocations', async () => {
    const fake = fakeGitRunner();
    const logData =
      '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n';
    fake.setLogOutput({ code: 0, stdout: logData });

    // First call.
    const result1 = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const logCallsAfterFirst = fake.callLog.filter((c) => c.args[0] === 'log').length;

    // Second call with same tip sha.
    const result2 = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const logCallsAfterSecond = fake.callLog.filter((c) => c.args[0] === 'log').length;

    // No new log calls should be made on cache hit (rev-parse may still be called).
    expect(logCallsAfterSecond).toBe(logCallsAfterFirst);
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    // Both should reference the same map (memoised).
    expect(result1).toBe(result2);
  });

  it('new tip sha triggers exactly one more log invocation', async () => {
    const fake = fakeGitRunner();
    const logData =
      '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n';
    fake.setLogOutput({ code: 0, stdout: logData });

    // First call with tip 'abc123def456'.
    await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const callsAfterFirst = fake.callLog.length;

    // Change the rev-parse output to a new tip sha.
    fake.setRevParseOutput({ code: 0, stdout: 'xyz789uvw012\n' });
    fake.setLogOutput({
      code: 0,
      stdout:
        '\x1exyz789uvw012\x092024-01-02T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n' +
        '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n',
    });

    // Second call with new tip.
    await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const callsAfterSecond = fake.callLog.length;

    // Exactly one more log call should be made.
    const logCallsAfterFirst = fake.callLog.filter((c) => c.args[0] === 'log').length;
    expect(logCallsAfterFirst).toBe(2);
  });

  it('two concurrent cold callers issue exactly one log invocation and resolve to the same map', async () => {
    const fake = fakeGitRunner();
    const logData =
      '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n';
    fake.setLogOutput({ code: 0, stdout: logData });

    // Fire two calls without awaiting between them.
    const promise1 = getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const promise2 = getTrunkLandIndex(PROJECT, TRUNK, fake.runner);

    const result1 = await promise1;
    const result2 = await promise2;

    // Only one log call should be recorded.
    const logCalls = fake.callLog.filter((c) => c.args[0] === 'log');
    expect(logCalls.length).toBe(1);

    // Both should resolve successfully and to the same map.
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    expect(result1).toBe(result2);
  });

  it('a full-uuid trailer is found by its leading 8-hex short id', async () => {
    const fake = fakeGitRunner();
    fake.setLogOutput({
      code: 0,
      stdout:
        '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n' +
        '\x1edef789ghi012\x092024-01-02T00:00:00Z\x09Collab-Epic: e12ab34c-d56e-4f78-ab12-cd34ef567890\n',
    });

    const index = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);

    // Exact full-uuid lookup.
    const exact = lookupEpicLand(index!, 'dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5');
    expect(exact).toBeDefined();
    expect(exact!.sha).toBe('abc123def456');

    // Prefix lookup by short id.
    const shortId = lookupEpicLand(index!, 'dc8aa05d');
    expect(shortId).toBeDefined();
    expect(shortId!.sha).toBe('abc123def456');

    // Another prefix lookup.
    const other = lookupEpicLand(index!, 'e12ab34c');
    expect(other).toBeDefined();
    expect(other!.sha).toBe('def789ghi012');
  });

  it('a non-zero log exit resolves to null and is not cached', async () => {
    const fake = fakeGitRunner();
    fake.setLogOutput({ code: 1, stdout: '' });

    // First call: log fails.
    const result1 = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const callsAfterFirst = fake.callLog.filter((c) => c.args[0] === 'log').length;

    expect(result1).toBeNull();

    // Reset the log output to succeed.
    fake.setLogOutput({
      code: 0,
      stdout:
        '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n',
    });

    // Second call with same tip sha (but now succeeding): should issue another log.
    const result2 = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);
    const callsAfterSecond = fake.callLog.filter((c) => c.args[0] === 'log').length;

    expect(result2).toBeDefined();
    expect(callsAfterSecond).toBe(callsAfterFirst + 1);
  });

  it('newest wins: first occurrence of an epic id is kept, later occurrences ignored', async () => {
    const fake = fakeGitRunner();
    // Two records with the same epic id. Git log is newest-first, so abc123 (first)
    // should win over def789 (second/older).
    fake.setLogOutput({
      code: 0,
      stdout:
        '\x1eabc123def456\x092024-01-02T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n' +
        '\x1edef789ghi012\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n',
    });

    const index = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);

    const entry = lookupEpicLand(index!, 'dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5');
    expect(entry).toBeDefined();
    // The first (newest) occurrence should be stored.
    expect(entry!.sha).toBe('abc123def456');
    expect(entry!.committedAtIso).toBe('2024-01-02T00:00:00Z');
  });

  it('lookupEpicLand returns null for non-existent id', async () => {
    const fake = fakeGitRunner();
    fake.setLogOutput({
      code: 0,
      stdout:
        '\x1eabc123def456\x092024-01-01T00:00:00Z\x09Collab-Epic: dc8aa05d-a060-4a02-85d2-ca1c45a8cbb5\n',
    });

    const index = await getTrunkLandIndex(PROJECT, TRUNK, fake.runner);

    const notFound = lookupEpicLand(index!, 'nonexistent-id-12345678');
    expect(notFound).toBeNull();
  });
});
