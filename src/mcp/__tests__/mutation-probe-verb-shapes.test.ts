/**
 * @nested-test-runner: spawns a nested `bun test` inside a detached git worktree
 * (measured 48.9s wall time, confirmed via process tree)
 *
 * Test: mutation_probe verb — end-to-end shapes on real fixtures
 *
 * Drives handleEpicTool('mutation_probe', ...) against three real mutation-probe fixtures
 * to verify that the three-arm probe correctly classifies execution signals:
 * - never-called: symbol not invoked by test
 * - called-unobserved: symbol invoked but its result is not observed
 * - called-observed: symbol invoked and its result is observed (or a throw is caught)
 *
 * Each probe spawns a detached git worktree + runs three test arms (control/neutered/throw),
 * so a 120s timeout per it block is necessary to accommodate slow CI pools.
 */
import { it, expect, describe, beforeAll } from 'bun:test';
import { handleEpicTool } from '../epic-tools.js';
import { join } from 'node:path';

const project = join(import.meta.dir, '../../..');

// Module-scoped storage for execution values to assert pairwise distinctness
let neverCalledExecution: string;
let calledUnobservedExecution: string;
let calledObservedExecution: string;

describe('mutation_probe verb shapes', () => {
  it(
    'asserts execution===\'never-called\' for neverCalledSubject',
    async () => {
      // This probe spawns two test arms (neutered + throw) plus control in a detached worktree,
      // so 120s accommodates slow CI pools under concurrent gate load.
      const result = await handleEpicTool('mutation_probe', {
        project,
        file: 'src/services/__fixtures__/mutation-probe/never-called-subject.ts',
        symbol: 'neverCalledSubject',
        testCommand: 'bun test ./src/services/__fixtures__/mutation-probe/never-called.fixture-test.ts',
      });

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.control.passed).toBe(true);
      expect(parsed.execution).toBe('never-called');
      neverCalledExecution = parsed.execution;
    },
    { timeout: 120_000 },
  );

  it(
    'asserts execution===\'called-unobserved\' for unawaitedAsyncSubject',
    async () => {
      // This probe spawns two test arms (neutered + throw) plus control in a detached worktree,
      // so 120s accommodates slow CI pools under concurrent gate load.
      const result = await handleEpicTool('mutation_probe', {
        project,
        file: 'src/services/__fixtures__/mutation-probe/unawaited-async-subject.ts',
        symbol: 'unawaitedAsyncSubject',
        testCommand: 'bun test ./src/services/__fixtures__/mutation-probe/unawaited-async.fixture-test.ts',
      });

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.control.passed).toBe(true);
      expect(parsed.execution).toBe('called-unobserved');
      calledUnobservedExecution = parsed.execution;
    },
    { timeout: 120_000 },
  );

  it(
    'asserts execution===\'called-observed\' for observedSubject (neutered.passed===false)',
    async () => {
      // This probe spawns two test arms (neutered + throw) plus control in a detached worktree,
      // so 120s accommodates slow CI pools under concurrent gate load.
      const result = await handleEpicTool('mutation_probe', {
        project,
        file: 'src/services/__fixtures__/mutation-probe/observed-subject.ts',
        symbol: 'observedSubject',
        testCommand: 'bun test ./src/services/__fixtures__/mutation-probe/observed.fixture-test.ts',
      });

      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.control.passed).toBe(true);
      expect(parsed.neutered.passed).toBe(false);
      expect(parsed.execution).toBe('called-observed');
      calledObservedExecution = parsed.execution;
    },
    { timeout: 120_000 },
  );

  it('asserts the three execution values are pairwise distinct', () => {
    // Verify that never-called, called-unobserved, and called-observed do not collapse
    // into the same reading — each arm combination must yield a distinct signal.
    expect(neverCalledExecution).not.toBe(calledUnobservedExecution);
    expect(neverCalledExecution).not.toBe(calledObservedExecution);
    expect(calledUnobservedExecution).not.toBe(calledObservedExecution);
  });
});
