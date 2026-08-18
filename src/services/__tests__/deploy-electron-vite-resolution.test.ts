import { describe, it, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { resolveElectronViteBin } from '../../../scripts/pack-app-asar';

const savedPath = process.env.PATH;

describe('resolveElectronViteBin', () => {
  afterEach(() => {
    process.env.PATH = savedPath;
  });

  it('resolveElectronViteBin returns an absolute existing path with the bin dir off PATH', () => {
    // Strip the PATH to prove resolution is independent of PATH
    process.env.PATH = '/usr/bin:/bin';

    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const resolved = resolveElectronViteBin(repoRoot);

    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved.includes('desktop/node_modules/.bin/electron-vite')).toBe(true);
  });

  it('runBuild no longer spawns the bare electron-vite name', () => {
    const repoRoot = join(import.meta.dir, '..', '..', '..');
    const packAppAsarPath = join(repoRoot, 'scripts', 'pack-app-asar.ts');
    const src = readFileSync(packAppAsarPath, 'utf-8');

    expect(src.includes("spawnSync('electron-vite'")).toBe(false);
    expect(src.includes('resolveElectronViteBin(')).toBe(true);
  });
});
