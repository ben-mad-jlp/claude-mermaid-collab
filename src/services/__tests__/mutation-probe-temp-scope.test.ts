// Pure test of probeSweepScanRoots and container-based sweep scoping.
// No git, no tmpdir enumeration — all paths are derived, not enumerated.
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync, rmSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeSweepScanRoots,
  mutationProbeTempRoot,
  MUTATION_PROBE_TEMP_CONTAINER,
  MUTATION_PROBE_TEMP_PREFIX,
} from '../mutation-probe-temp';
import { sweepStrayMutationProbeTemps, MUTATION_PROBE_TEMP_MAX_AGE_MS } from '../leaf-worktree-reaper';

describe('mutation-probe temp scope', () => {
  it('probeSweepScanRoots returns only the container dir when no tmpRoot is supplied', () => {
    const roots = probeSweepScanRoots();
    expect(roots.length).toBe(1);
    expect(roots[0]).toBe(join(tmpdir(), MUTATION_PROBE_TEMP_CONTAINER));
  });

  it('probeSweepScanRoots includes the bare root as well when tmpRoot is supplied', () => {
    const testRoot = '/test/tmp/root';
    const roots = probeSweepScanRoots({ tmpRoot: testRoot });
    expect(roots.length).toBe(2);
    expect(roots[0]).toBe(join(testRoot, MUTATION_PROBE_TEMP_CONTAINER));
    expect(roots[1]).toBe(testRoot);
  });

  it('mutationProbeTempRoot resolves to the container dir under the given root', () => {
    const testRoot = '/custom/tmpdir';
    const resolved = mutationProbeTempRoot(testRoot);
    expect(resolved).toBe(join(testRoot, MUTATION_PROBE_TEMP_CONTAINER));
  });

  it('mutationProbeTempRoot defaults to the system tmpdir container', () => {
    const resolved = mutationProbeTempRoot();
    expect(resolved).toBe(join(tmpdir(), MUTATION_PROBE_TEMP_CONTAINER));
  });

  it('sweepStrayMutationProbeTemps removes an aged probe temp inside the container dir', async () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'test-container-'));
    const containerDir = join(testRoot, MUTATION_PROBE_TEMP_CONTAINER);
    const agedName = `${MUTATION_PROBE_TEMP_PREFIX}123-456`;
    const agedPath = join(containerDir, agedName);
    const rmCalls: string[] = [];

    try {
      // Create container and aged temp
      mkdirSync(agedPath, { recursive: true });

      // Backdate mtime to be older than max age
      const now = Date.now();
      const thenMs = now - (2 * MUTATION_PROBE_TEMP_MAX_AGE_MS);
      const thenS = Math.floor(thenMs / 1000);
      utimesSync(agedPath, thenS, thenS);

      const removed = await sweepStrayMutationProbeTemps('/test-project', {
        now,
        tmpRoot: testRoot,
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
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('sweepStrayMutationProbeTemps skips unreadable container directories', async () => {
    const testRoot = mkdtempSync(join(tmpdir(), 'test-unreadable-'));
    const containerDir = join(testRoot, MUTATION_PROBE_TEMP_CONTAINER);

    try {
      // Create container but do not create any temps
      mkdirSync(containerDir, { recursive: true });

      const removed = await sweepStrayMutationProbeTemps('/test-project', {
        now: Date.now(),
        tmpRoot: testRoot,
      });

      expect(removed.length).toBe(0);
    } finally {
      // Cleanup
      rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
