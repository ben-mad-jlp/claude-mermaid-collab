import { describe, test, expect, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { LeafGateConfig } from '../leaf-gate.js';
import { requiredDepRoots, probeDepTrees } from '../dep-tree-guard.js';

describe('dep-tree-guard', () => {
  let tempRoot: string;

  describe('requiredDepRoots', () => {
    test('includes the worktree root and a desktop suite lane cwd and excludes a lane cwd with no package.json', async () => {
      tempRoot = await mkdtemp(join(tmpdir(), 'dep-tree-guard-test-'));

      try {
        // Create root package.json
        writeFileSync(join(tempRoot, 'package.json'), '{}');

        // Create desktop/package.json
        await mkdir(join(tempRoot, 'desktop'));
        writeFileSync(join(tempRoot, 'desktop', 'package.json'), '{}');

        // Create pyland/ with NO package.json
        await mkdir(join(tempRoot, 'pyland'));

        const cfg: LeafGateConfig = {
          suites: [
            {
              match: /^desktop\//,
              command: 'bun test',
              cwd: 'desktop',
            },
          ],
          floors: [
            {
              match: /^pyland\//,
              command: 'python -m pytest',
              cwd: 'pyland',
            },
          ],
        };

        const roots = requiredDepRoots(tempRoot, cfg);

        expect(roots).toEqual([tempRoot, join(tempRoot, 'desktop')]);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });
  });

  describe('probeDepTrees', () => {
    test('reports missing for a dangling symlink at desktop/node_modules', async () => {
      tempRoot = await mkdtemp(join(tmpdir(), 'dep-tree-guard-test-'));

      try {
        await mkdir(join(tempRoot, 'desktop'));

        // Create a dangling symlink
        await symlink(join(tempRoot, 'desktop', 'does-not-exist'), join(tempRoot, 'desktop', 'node_modules'));

        const probe = await probeDepTrees([join(tempRoot, 'desktop')]);

        expect(probe.ok).toBe(false);
        expect(probe.missing).toContain(join(tempRoot, 'desktop'));
        expect(probe.detail).toContain(`missing:${join(tempRoot, 'desktop')}`);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });

    test('reports ok for a node_modules symlink pointing at a real directory', async () => {
      tempRoot = await mkdtemp(join(tmpdir(), 'dep-tree-guard-test-'));

      try {
        await mkdir(join(tempRoot, 'desktop'));

        // Create a real target directory
        const realTarget = join(tempRoot, 'real-node-modules');
        await mkdir(realTarget);

        // Symlink it
        await symlink(realTarget, join(tempRoot, 'desktop', 'node_modules'));

        const probe = await probeDepTrees([join(tempRoot, 'desktop')]);

        expect(probe.ok).toBe(true);
        expect(probe.missing).toEqual([]);
        expect(probe.detail).toContain(`ok:${join(tempRoot, 'desktop')}`);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });

    test('fails open and reports ok when the probe hits a non-ENOENT error', async () => {
      tempRoot = await mkdtemp(join(tmpdir(), 'dep-tree-guard-test-'));

      try {
        const errorRoot = join(tempRoot, 'error-root');

        const injectedStatFn = async (_p: string) => {
          const err = new Error('Permission denied') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          throw err;
        };

        const probe = await probeDepTrees([errorRoot], injectedStatFn);

        expect(probe.ok).toBe(true);
        expect(probe.missing).toEqual([]);
        expect(probe.detail).toContain(`probe-failed:${errorRoot}`);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    });
  });
});
