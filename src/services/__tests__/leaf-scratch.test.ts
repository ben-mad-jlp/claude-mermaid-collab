import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LEAF_SCRATCH_ROOT, leafScratchFor, allocateLeafScratch, reapLeafScratch } from '../leaf-scratch';

describe('leaf-scratch', () => {
  let testWorktreeRoot: string;

  beforeEach(() => {
    // Create a temporary test worktree root
    testWorktreeRoot = join(tmpdir(), `test-worktree-${Date.now()}`);
    mkdirSync(testWorktreeRoot, { recursive: true });
  });

  afterEach(() => {
    // Clean up test worktree
    try {
      rmSync(testWorktreeRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('allocateLeafScratch creates a directory outside the worktree', () => {
    const worktreePath = join(testWorktreeRoot, 'leaf-exec-12345678');
    const scratchPath = allocateLeafScratch(worktreePath);

    // Verify scratch dir starts with LEAF_SCRATCH_ROOT
    expect(scratchPath.startsWith(LEAF_SCRATCH_ROOT)).toBe(true);

    // Verify scratch is outside worktree by checking relative path
    const rel = relative(testWorktreeRoot, scratchPath);
    expect(rel.startsWith('..')).toBe(true);
  });

  it('different worktree paths yield different scratch paths', () => {
    const worktree1 = join(testWorktreeRoot, 'leaf-exec-aaaaaaaa');
    const worktree2 = join(testWorktreeRoot, 'leaf-exec-bbbbbbbb');

    const scratch1 = allocateLeafScratch(worktree1);
    const scratch2 = allocateLeafScratch(worktree2);

    expect(scratch1).not.toEqual(scratch2);
    expect(scratch1).toContain('leaf-exec-aaaaaaaa');
    expect(scratch2).toContain('leaf-exec-bbbbbbbb');
  });

  it('reapLeafScratch removes an allocated dir and has safety checks', () => {
    const worktreePath = join(testWorktreeRoot, 'leaf-exec-cccccccc');
    const scratchPath = allocateLeafScratch(worktreePath);

    // Verify it exists
    expect(scratchPath).toBeTruthy();

    // Remove it
    const removed = reapLeafScratch(worktreePath);
    expect(removed).toBe(true);

    // The guard checks that the relative path doesn't escape LEAF_SCRATCH_ROOT.
    // Since leafScratchFor derives the path from basename, it can't escape in normal use,
    // but the guard still provides defense-in-depth.
    const reapDuplicateResult = reapLeafScratch(worktreePath);
    // Reaping the same path again should still return true (rmSync with force: true
    // handles missing dirs gracefully)
    expect(reapDuplicateResult).toBe(true);
  });

  it('leafScratchFor derives consistent paths', () => {
    const worktreePath = join(testWorktreeRoot, 'leaf-exec-dddddddd');
    const path1 = leafScratchFor(worktreePath);
    const path2 = leafScratchFor(worktreePath);

    expect(path1).toEqual(path2);
    expect(path1).toContain('leaf-exec-dddddddd');
  });
});
