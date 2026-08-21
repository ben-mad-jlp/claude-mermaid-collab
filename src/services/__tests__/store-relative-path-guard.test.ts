/**
 * `openDb`'s public entry point must refuse a relative `project` argument rather than
 * silently resolving it against whatever the process's cwd happens to be — a relative path
 * mints a `.collab/` directory and database wherever cwd points, which is never what a caller
 * meant (see resolveStoreProject, todo-store.ts). This guard is the STORE ENTRY POINT, not
 * canonicalisation — canonicalProjectRoot stays pure path identity (store-paths.test.ts:50).
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storePath, canonicalProjectRoot } from '../store-paths';
import { resolveStoreProject, openDb } from '../todo-store';

describe('openDb refuses a relative project path', () => {
  it('resolved database path for a relative project input is the tmpdir-anchored absolute path', () => {
    const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'store-relative-path-guard-')));
    const subdir = 'sub-project';
    mkdirSync(join(fixtureRoot, subdir), { recursive: true });
    const originalCwd = process.cwd();
    try {
      process.chdir(fixtureRoot);
      expect(storePath('collab', canonicalProjectRoot(subdir))).toBe(
        join(fixtureRoot, subdir, '.collab', 'collab.db'),
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('a store call with a relative project path returns an error object naming the offending path', () => {
    const relResult = resolveStoreProject('proj-test');
    expect('error' in relResult).toBe(true);
    expect((relResult as { error: string }).error).toContain('proj-test');

    const absoluteRoot = realpathSync(mkdtempSync(join(tmpdir(), 'store-relative-path-guard-abs-')));
    try {
      const absResult = resolveStoreProject(absoluteRoot);
      expect('path' in absResult).toBe(true);
    } finally {
      rmSync(absoluteRoot, { recursive: true, force: true });
    }
  });

  it('a listing of the repo root is identical before and after a guarded store call', () => {
    const repoRoot = process.cwd();
    const before = readdirSync(repoRoot).sort();
    expect(() => openDb('proj-test')).toThrow(/proj-test/);
    const after = readdirSync(repoRoot).sort();
    expect(after).toEqual(before);
  });
});
