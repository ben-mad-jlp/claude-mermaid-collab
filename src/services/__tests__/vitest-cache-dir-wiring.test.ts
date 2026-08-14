import { describe, it, expect } from 'bun:test';
import * as path from 'node:path';
import { resolveVitestCacheDir } from '../vitest-cache-dir.ts';

const repoRoot = path.resolve(import.meta.dir, '../../..'); // __tests__ -> services -> src -> repo root
const cfg = (await import('../../../ui/vitest.config.ts')).default;

describe('ui/vitest.config.ts cacheDir wiring', () => {
  it('cfg.cacheDir === resolveVitestCacheDir(repoRoot)', () => {
    expect(cfg.cacheDir).toBe(resolveVitestCacheDir(repoRoot));
  });

  it('cfg.cacheDir is absolute and excludes /node_modules/', () => {
    const cacheDir = cfg.cacheDir;
    expect(typeof cacheDir).toBe('string');
    expect(cacheDir).toBeDefined();
    if (!cacheDir) throw new Error('cfg.cacheDir is undefined');
    expect(cacheDir.length).toBeGreaterThan(0);
    expect(path.isAbsolute(cacheDir)).toBe(true);
    expect(cacheDir.includes('/node_modules/')).toBe(false);
  });

  it('cfg.test.cache.dir === resolveVitestCacheDir(repoRoot)', () => {
    const cache = cfg.test?.cache;
    if (cache === false || cache === undefined) {
      throw new Error('cfg.test.cache must be an object');
    }
    expect(cache.dir).toBe(resolveVitestCacheDir(repoRoot));
  });

  it('both cacheDir knobs are absolute and outside node_modules', () => {
    const topLevelCacheDir = cfg.cacheDir;
    const cache = cfg.test?.cache;
    if (cache === false || cache === undefined) {
      throw new Error('cfg.test.cache must be an object');
    }
    const testCacheDir = cache.dir;

    expect(typeof topLevelCacheDir).toBe('string');
    expect(typeof testCacheDir).toBe('string');
    expect(topLevelCacheDir).toBeDefined();
    expect(testCacheDir).toBeDefined();

    if (!topLevelCacheDir) throw new Error('cfg.cacheDir is undefined');
    if (!testCacheDir) throw new Error('cfg.test.cache.dir is undefined');

    expect(path.isAbsolute(topLevelCacheDir)).toBe(true);
    expect(path.isAbsolute(testCacheDir)).toBe(true);
    expect(topLevelCacheDir.includes('/node_modules/')).toBe(false);
    expect(testCacheDir.includes('/node_modules/')).toBe(false);
  });
});
