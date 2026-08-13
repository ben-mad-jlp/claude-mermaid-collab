// Runs via `bun test`. Verifies sweepStrayMutationProbeTemps removes aged mutation-probe
// temp dirs and that tickGcLeafWorktrees wires it into the GC pass. Clock, fs operations,
// and the gc/sweep work are injected so the sweep is exercised deterministically without
// real time or a real git/worktree scan.
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync, rmSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sweepStrayMutationProbeTemps,
  tickGcLeafWorktrees,
  MUTATION_PROBE_TEMP_MAX_AGE_MS,
  WORKTREE_GC_INTERVAL_MS,
  type GcReport,
} from '../leaf-worktree-reaper';

describe('mutation-probe stray sweep', () => {
  it('removes an aged stray collab-mutation-probe temp and returns its path', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'test-sweep-'));
    const agedName = 'collab-mutation-probe-1-2';
    const agedPath = join(tmpRoot, agedName);
    const rmCalls: string[] = [];

    try {
      // Create aged temp directory
      mkdirSync(agedPath, { recursive: true });

      // Backdate mtime to be older than max age
      const now = Date.now();
      const thenMs = now - (2 * MUTATION_PROBE_TEMP_MAX_AGE_MS);
      const thenS = Math.floor(thenMs / 1000);
      utimesSync(agedPath, thenS, thenS);

      const removed = await sweepStrayMutationProbeTemps('/test-project-aged', {
        now,
        tmpRoot,
        remove: async (p) => {
          rmCalls.push(p);
          rmSync(p, { recursive: true, force: true });
        },
      });

      expect(removed.length).toBe(1);
      expect(removed[0]).toBe(agedPath);
      expect(rmCalls).toContain(agedPath);
      expect(existsSync(agedPath)).toBe(false);
    } finally {
      // Cleanup
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('leaves a fresh collab-mutation-probe temp in place', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'test-sweep-'));
    const freshName = 'collab-mutation-probe-3-4';
    const freshPath = join(tmpRoot, freshName);
    const rmCalls: string[] = [];

    try {
      // Create fresh temp
      mkdirSync(freshPath, { recursive: true });

      const now = Date.now();
      const removed = await sweepStrayMutationProbeTemps('/test-project-fresh', {
        now,
        tmpRoot,
        remove: async (p) => {
          rmCalls.push(p);
        },
      });

      expect(removed.length).toBe(0);
      expect(rmCalls.length).toBe(0);
      expect(existsSync(freshPath)).toBe(true);
    } finally {
      // Cleanup
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('leaves an unrelated tmp dir in place', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'test-sweep-'));
    const otherName = 'some-other-tmp';
    const otherPath = join(tmpRoot, otherName);
    const rmCalls: string[] = [];

    try {
      // Create unrelated temp
      mkdirSync(otherPath, { recursive: true });

      const now = Date.now();
      const removed = await sweepStrayMutationProbeTemps('/test-project-other', {
        now,
        tmpRoot,
        remove: async (p) => {
          rmCalls.push(p);
        },
      });

      expect(removed.length).toBe(0);
      expect(rmCalls.length).toBe(0);
      expect(existsSync(otherPath)).toBe(true);
    } finally {
      // Cleanup
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('tickGcLeafWorktrees invokes the stray-temp sweep after its throttle check', async () => {
    const gcCalls: string[] = [];
    const sweepCalls: Array<{ project: string; now?: number }> = [];

    const mockGc = async (_project: string): Promise<GcReport> => {
      gcCalls.push(_project);
      return {
        removed: [],
        refused: [],
        quarantined: [],
        prunedRegistrations: 0,
        scanned: 0,
        records: [],
      };
    };

    const mockSweep = async (project: string, opts?: { now?: number }) => {
      sweepCalls.push({ project, now: opts?.now });
      return [];
    };

    const project = '/test-project-tick';
    const t = 5_000_000;

    // First call within interval should run both
    const res = await tickGcLeafWorktrees(project, { now: t, gc: mockGc, sweep: mockSweep });
    expect(res).not.toBeNull();
    expect(sweepCalls.length).toBe(1);
    expect(sweepCalls[0]).toEqual({ project, now: t });
    expect(gcCalls.length).toBe(1);

    // Second call before interval should skip both
    const skipped = await tickGcLeafWorktrees(project, { now: t + 1, gc: mockGc, sweep: mockSweep });
    expect(skipped).toBeNull();
    expect(sweepCalls.length).toBe(1); // not called again
    expect(gcCalls.length).toBe(1); // not called again
  });

  it('handles remove failure gracefully and continues', async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'test-sweep-'));
    const agedName = 'collab-mutation-probe-5-6';
    const agedPath = join(tmpRoot, agedName);
    const freshName = 'collab-mutation-probe-7-8';
    const freshPath = join(tmpRoot, freshName);

    try {
      // Create aged and fresh temps
      mkdirSync(agedPath, { recursive: true });
      mkdirSync(freshPath, { recursive: true });

      // Backdate aged temp
      const now = Date.now();
      const thenMs = now - (2 * MUTATION_PROBE_TEMP_MAX_AGE_MS);
      const thenS = Math.floor(thenMs / 1000);
      utimesSync(agedPath, thenS, thenS);

      let removeAttempts = 0;
      const removed = await sweepStrayMutationProbeTemps('/test-project-fail', {
        now,
        tmpRoot,
        remove: async (p) => {
          removeAttempts++;
          // Fail on first call, but still continue to process other dirs
          if (removeAttempts === 1) {
            throw new Error('simulated removal failure');
          }
          rmSync(p, { recursive: true, force: true });
        },
      });

      // The failed removal should not be in the removed list
      expect(removed.length).toBe(0);
      expect(removeAttempts).toBe(1);
    } finally {
      // Cleanup
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
