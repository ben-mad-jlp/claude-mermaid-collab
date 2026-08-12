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
import { isNestedRunnerSource, detectRealGitWorktreeSpawn } from '../nested-runner-lane';

describe('base-gate-lane-admission', () => {
  it('no file in fast is classified as a nested-runner via isNestedRunnerSource or trips detectRealGitWorktreeSpawn', () => {
    const { fast } = collectBackendTestFiles();

    for (const file of fast) {
      const source = readFileSync(file, 'utf8');
      expect(isNestedRunnerSource(source)).toBe(false);
      expect(detectRealGitWorktreeSpawn(source)).toBe(false);
    }
  });

  it('nested contains mutation-check.test.ts and has length <= 5', () => {
    const { nested } = collectBackendTestFiles();

    const hasMutationCheck = nested.some((f) => f.includes('mutation-check.test.ts'));
    expect(hasMutationCheck).toBe(true);
    expect(nested.length).toBeLessThanOrEqual(5);
  });

  it('serial contains orphan-worktree-gc.test.ts and worktree-gc.test.ts', () => {
    const { serial } = collectBackendTestFiles();

    const hasOrphanWorktreeGc = serial.some((f) => f.includes('orphan-worktree-gc.test.ts'));
    const hasWorktreeGc = serial.some((f) => f.includes('worktree-gc.test.ts'));

    expect(hasOrphanWorktreeGc).toBe(true);
    expect(hasWorktreeGc).toBe(true);
  });

  it('fast contains epic-land-gate, verify-epic, gate-status, gate-runner-land-parity test files', () => {
    const { fast } = collectBackendTestFiles();

    const requiredFiles = [
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

  it('leaf-executor runs in the SERIAL lane — moved consciously, not lost', () => {
    // Moved 2026-08-12 (disposition B, mission 0bdbed7e crit 6): 333 cases with 30s per-case
    // budgets fail a DIFFERENT case each 6x-concurrent run (always 332/333, green in
    // isolation) — it blocked three lands and starved crit-6's leaves through 17 claim cycles.
    // Two-sided so the file can neither silently return to the fast lane nor silently vanish.
    const { fast, serial } = collectBackendTestFiles();
    expect(serial.some((f) => f.includes('leaf-executor.test.ts'))).toBe(true);
    expect(fast.some((f) => f.includes('leaf-executor.test.ts'))).toBe(false);
  });
});
