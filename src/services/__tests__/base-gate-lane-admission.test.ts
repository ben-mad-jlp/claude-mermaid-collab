/**
 * @nested-test-runner: inert - discusses nested runners in test names but never executes them
 * @serial-test-lane: inert - discusses git worktree detection in test names but never executes it
 *
 * base-gate-lane-admission.test.ts — two-sided guard over the real collected test set,
 * ensuring admission of fast-lane files and expulsion of nested/serial files based on
 * the actual partition logic.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';
import { collectBackendTestFiles } from '../../../scripts/test-backend';
import { detectNestedRunnerSpawn, detectRealGitWorktreeSpawn } from '../nested-runner-lane';

describe('base-gate-lane-admission', () => {
  it('no file in fast trips detectNestedRunnerSpawn or detectRealGitWorktreeSpawn', () => {
    const { fast } = collectBackendTestFiles();

    for (const file of fast) {
      const source = readFileSync(file, 'utf8');
      expect(detectNestedRunnerSpawn(source)).toBe(false);
      expect(detectRealGitWorktreeSpawn(source)).toBe(false);
    }
  });

  it('nested contains mutation-check.test.ts and has length <= 4', () => {
    const { nested } = collectBackendTestFiles();

    const hasMutationCheck = nested.some((f) => f.includes('mutation-check.test.ts'));
    expect(hasMutationCheck).toBe(true);
    expect(nested.length).toBeLessThanOrEqual(4);
  });

  it('serial contains orphan-worktree-gc.test.ts and worktree-gc.test.ts', () => {
    const { serial } = collectBackendTestFiles();

    const hasOrphanWorktreeGc = serial.some((f) => f.includes('orphan-worktree-gc.test.ts'));
    const hasWorktreeGc = serial.some((f) => f.includes('worktree-gc.test.ts'));

    expect(hasOrphanWorktreeGc).toBe(true);
    expect(hasWorktreeGc).toBe(true);
  });

  it('fast contains leaf-executor, epic-land-gate, verify-epic, gate-status, gate-runner-land-parity test files', () => {
    const { fast } = collectBackendTestFiles();

    const requiredFiles = [
      'leaf-executor.test.ts',
      'epic-land-gate.test.ts',
      'verify-epic.test.ts',
      'gate-status.test.ts',
      'gate-runner-land-parity.test.ts',
    ];

    for (const required of requiredFiles) {
      const found = fast.some((f) => f.includes(required));
      expect(found).toBe(true);
    }
  });
});
