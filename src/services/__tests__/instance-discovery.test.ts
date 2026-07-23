import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildLockOptions,
  withPerIdLock,
  writeInstance,
  getDiscoveryPaths,
  type Instance,
} from '../instance-discovery';

describe('instance-discovery — lock coordination', () => {
  let tempHome: string;
  let paths: ReturnType<typeof getDiscoveryPaths>;

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'instance-disc-'));
    paths = getDiscoveryPaths(tempHome);
    await mkdir(paths.instancesDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('buildLockOptions.onCompromised does not throw', () => {
    const testId = 'test-session-123';
    const options = buildLockOptions(testId);
    const err = new Error('lock compromised');

    // onCompromised should not throw when called
    expect(() => options.onCompromised?.(err)).not.toThrow();
  });

  it('withPerIdLock serializes calls for the same id (slower op queued first, faster second)', async () => {
    const log: string[] = [];
    const id = 'same-id';

    // Queue a slower operation first
    const slower = withPerIdLock(id, async () => {
      log.push('slower-start');
      // Simulate ~50ms of work
      await new Promise(resolve => setTimeout(resolve, 50));
      log.push('slower-end');
    });

    // Immediately queue a faster operation (while slower is still running)
    const faster = withPerIdLock(id, async () => {
      log.push('faster-start');
      log.push('faster-end');
    });

    await Promise.all([slower, faster]);

    // Verify strict ordering: slower must complete before faster starts
    expect(log).toEqual(['slower-start', 'slower-end', 'faster-start', 'faster-end']);
  });

  it('withPerIdLock does not stall later calls when fn rejects', async () => {
    const log: string[] = [];
    const id = 'error-id';

    // First call rejects
    const rejected = withPerIdLock(id, async () => {
      log.push('first-start');
      throw new Error('intended error');
    }).catch(() => {
      log.push('first-error-caught');
    });

    // Second call should run without stalling
    const afterError = withPerIdLock(id, async () => {
      log.push('second-start');
      log.push('second-end');
    });

    await Promise.all([rejected, afterError]);

    // Verify both ran in order and second was not stalled
    expect(log).toEqual(['first-start', 'first-error-caught', 'second-start', 'second-end']);
  });

});
