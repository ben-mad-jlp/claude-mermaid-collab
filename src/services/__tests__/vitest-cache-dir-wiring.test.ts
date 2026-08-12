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
});
