import { describe, it, expect } from 'bun:test';
import {
  HARNESS_TIMEOUT_FLOOR_MS,
  harnessTimeoutMs,
  deadlockGuardMs,
  raceDeadlockGuard,
  WORKTREE_GC_TIMEOUT_FLOOR_MS,
  WORKTREE_GC_DEADLOCK_GUARD_MS,
  worktreeGcTimeoutMs,
} from '../../testing/test-timeout-budget';

describe('test-timeout-budget', () => {
  it('harnessTimeoutMs falls back to at least 30000 with the env unset', () => {
    const saved = process.env.BACKEND_TEST_TIMEOUT_MS;
    try {
      delete process.env.BACKEND_TEST_TIMEOUT_MS;
      expect(harnessTimeoutMs()).toBe(HARNESS_TIMEOUT_FLOOR_MS);
      expect(harnessTimeoutMs()).toBe(30000);
    } finally {
      if (saved !== undefined) {
        process.env.BACKEND_TEST_TIMEOUT_MS = saved;
      }
    }
  });

  it('harnessTimeoutMs honours BACKEND_TEST_TIMEOUT_MS=90000', () => {
    const saved = process.env.BACKEND_TEST_TIMEOUT_MS;
    try {
      process.env.BACKEND_TEST_TIMEOUT_MS = '90000';
      expect(harnessTimeoutMs()).toBe(90000);
    } finally {
      if (saved !== undefined) {
        process.env.BACKEND_TEST_TIMEOUT_MS = saved;
      } else {
        delete process.env.BACKEND_TEST_TIMEOUT_MS;
      }
    }
  });

  it('deadlockGuardMs is strictly below harnessTimeoutMs for both the floor and the override', () => {
    const saved = process.env.BACKEND_TEST_TIMEOUT_MS;
    try {
      // Test with default (floor)
      delete process.env.BACKEND_TEST_TIMEOUT_MS;
      const floorHarness = harnessTimeoutMs();
      const floorGuard = deadlockGuardMs();
      expect(floorGuard).toBeLessThan(floorHarness);
      expect(floorGuard).toBe(Math.floor(floorHarness * 0.6));

      // Test with override
      process.env.BACKEND_TEST_TIMEOUT_MS = '90000';
      const overrideHarness = harnessTimeoutMs();
      const overrideGuard = deadlockGuardMs();
      expect(overrideGuard).toBeLessThan(overrideHarness);
      expect(overrideGuard).toBe(Math.floor(overrideHarness * 0.6));
      expect(overrideGuard).toBe(54000); // Math.floor(90000 * 0.6)
    } finally {
      if (saved !== undefined) {
        process.env.BACKEND_TEST_TIMEOUT_MS = saved;
      } else {
        delete process.env.BACKEND_TEST_TIMEOUT_MS;
      }
    }
  });

  it('raceDeadlockGuard rejects a never-settling promise with the label and resolves a settled one', async () => {
    // Test rejection with never-settling promise
    // Use a short timeout to keep test fast; the default is 18000ms (30000*0.6),
    // so we pass an explicit 5ms override for this test case.
    const neverSettles = new Promise<void>(() => {});
    const rejectPromise = raceDeadlockGuard(neverSettles, 'test-deadlock', 5);

    try {
      await rejectPromise;
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      if (err instanceof Error) {
        expect(err.message).toContain('possible deadlock: test-deadlock');
        expect(err.message).toContain('5ms');
      }
    }

    // Test resolution with settled promise
    const settled = Promise.resolve(42);
    const resolvePromise = raceDeadlockGuard(settled, 'test-settled');
    const result = await resolvePromise;
    expect(result).toBe(42);
  });

  it('worktreeGcTimeoutMs and WORKTREE_GC_DEADLOCK_GUARD_MS give the GC suite at least 60000ms', () => {
    const saved = process.env.BACKEND_TEST_TIMEOUT_MS;
    try {
      // Test with default (floor)
      delete process.env.BACKEND_TEST_TIMEOUT_MS;
      expect(worktreeGcTimeoutMs()).toBeGreaterThanOrEqual(60000);
      expect(worktreeGcTimeoutMs()).toBe(100000);
      expect(WORKTREE_GC_DEADLOCK_GUARD_MS).toBeGreaterThanOrEqual(60000);
      expect(WORKTREE_GC_DEADLOCK_GUARD_MS).toBeLessThan(worktreeGcTimeoutMs());

      // Test with override that widens the timeout
      process.env.BACKEND_TEST_TIMEOUT_MS = '150000';
      expect(worktreeGcTimeoutMs()).toBe(150000);
      expect(WORKTREE_GC_DEADLOCK_GUARD_MS).toBeLessThan(worktreeGcTimeoutMs());

      // Verify the harness floor is preserved
      expect(HARNESS_TIMEOUT_FLOOR_MS).toBe(30000);
    } finally {
      if (saved !== undefined) {
        process.env.BACKEND_TEST_TIMEOUT_MS = saved;
      } else {
        delete process.env.BACKEND_TEST_TIMEOUT_MS;
      }
    }
  });
});
