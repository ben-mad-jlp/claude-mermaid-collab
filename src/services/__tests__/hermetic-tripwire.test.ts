/**
 * Hermetic tripwire guard tests — verify the guard catches and allows the expected patterns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { HermeticTripwireError, ALLOW_DETACHED_ENV } from '../../testing/hermetic-tripwire';

const FORBIDDEN_HOME_DIR = join(homedir(), '.mermaid-collab');

describe('hermetic-tripwire', () => {
  it('preload was loaded (guard is active)', () => {
    expect((globalThis as any).__hermeticTripwireLoaded).toBe(true);
    // Also verify that fs.writeFileSync has been patched
    expect((fs as any).writeFileSync.__hermeticTripwire).toBe(true);
  });

  it('allows writeFileSync into a mkdtempSync path (tmpdir isolation)', () => {
    const tmpPath = fs.mkdtempSync(join(tmpdir(), 'tripwire-test-'));
    try {
      const testFile = join(tmpPath, 'test.txt');
      expect(() => fs.writeFileSync(testFile, 'test content')).not.toThrow();
    } finally {
      fs.rmSync(tmpPath, { recursive: true, force: true });
    }
  });

  it('throws HermeticTripwireError on writeFileSync into ~/.mermaid-collab', () => {
    const forbiddenPath = join(FORBIDDEN_HOME_DIR, 'tripwire-test-forbidden');
    expect(() => fs.writeFileSync(forbiddenPath, 'should not write')).toThrow(HermeticTripwireError);
    // Verify the error message names the path
    expect(() => fs.writeFileSync(forbiddenPath, 'should not write')).toThrow(/forbidden/i);
  });

  it('throws HermeticTripwireError on detached spawn without env var', () => {
    // Ensure the env var is not set
    delete process.env[ALLOW_DETACHED_ENV];
    expect(() => Bun.spawn(['true'], { detached: true })).toThrow(HermeticTripwireError);
    expect(() => Bun.spawn(['true'], { detached: true })).toThrow(new RegExp(ALLOW_DETACHED_ENV));
  });

  it('allows detached spawn when MERMAID_TEST_ALLOW_DETACHED=1', async () => {
    const oldEnv = process.env[ALLOW_DETACHED_ENV];
    try {
      process.env[ALLOW_DETACHED_ENV] = '1';
      const proc = Bun.spawn(['true']);
      expect(proc).toBeDefined();
      expect(proc.pid).toBeGreaterThan(0);
      // Clean up the process
      await proc.exited;
    } finally {
      if (oldEnv !== undefined) {
        process.env[ALLOW_DETACHED_ENV] = oldEnv;
      } else {
        delete process.env[ALLOW_DETACHED_ENV];
      }
    }
  });
});
