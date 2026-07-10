// Pure verdict-logic tests for verify-epic.ts — the runner is stubbed,
// so these are hermetic (no real suite, no shell-out). They exercise the
// NET-NEW failures detection (names, not counts) and the distinction between
// an incident (could not run) and a failure (ran and failed).
import { describe, test, expect } from 'bun:test';
import {
  diffNewFailures,
  computeSuiteReport,
  type SuiteRunner,
  type SuiteRunResult,
} from '../verify-epic.js';

/** Stub runner: returns known failing name sets. */
const stub = (base: string[], branch: string[], ran = true): SuiteRunner =>
  async (_cmd, side): Promise<SuiteRunResult> =>
    ran ? { ran: true, failing: side === 'base' ? base : branch }
        : { ran: false, failing: [], error: 'worktree add failed' };

describe('diffNewFailures', () => {
  test('identical sets → no new failures', () => {
    const result = diffNewFailures(['a', 'b'], ['a', 'b']);
    expect(result).toEqual([]);
  });

  test('branch has extra name → new failure detected', () => {
    const result = diffNewFailures(['a', 'c'], ['a']);
    expect(result).toEqual(['c']);
  });

  test('branch fixed a base failure → still passing (subset), no regression', () => {
    const result = diffNewFailures(['a'], ['a', 'b']);
    expect(result).toEqual([]);
  });

  test('inversion guard: swapping operands changes the result', () => {
    const forward = diffNewFailures(['a', 'c'], ['a']);
    expect(forward).toEqual(['c']);

    const backward = diffNewFailures(['a'], ['a', 'c']);
    expect(backward).toEqual([]);
  });

  test('deduplicates duplicates in branch failing set', () => {
    const result = diffNewFailures(['x', 'x', 'y'], ['x']);
    expect(result).toEqual(['y']);
  });
});

describe('computeSuiteReport', () => {
  test('identical sets → ran:true, subsetHolds:true, no reason', () => {
    const report = computeSuiteReport(
      'gate',
      'npm test',
      { ran: true, failing: ['a', 'b'] },
      { ran: true, failing: ['a', 'b'] },
    );
    expect(report.ran).toBe(true);
    expect(report.subsetHolds).toBe(true);
    expect(report.newFailures).toEqual([]);
    expect(report.reason).toBeUndefined();
  });

  test('branch-only failing name → ran:true, subsetHolds:false, newFailures has that name, no reason', () => {
    const report = computeSuiteReport(
      'gate',
      'npm test',
      { ran: true, failing: ['a'] },
      { ran: true, failing: ['a', 'c'] },
    );
    expect(report.ran).toBe(true);
    expect(report.subsetHolds).toBe(false);
    expect(report.newFailures).toEqual(['c']);
    expect(report.reason).toBeUndefined();
  });

  test('base-only failing name → ran:true, subsetHolds:true (branch is subset), no reason', () => {
    const report = computeSuiteReport(
      'gate',
      'npm test',
      { ran: true, failing: ['a', 'b'] },
      { ran: true, failing: ['a'] },
    );
    expect(report.ran).toBe(true);
    expect(report.subsetHolds).toBe(true);
    expect(report.newFailures).toEqual([]);
    expect(report.reason).toBeUndefined();
  });

  test('branch run incident → ran:false, subsetHolds:false, reason set, distinct from failure', () => {
    const report = computeSuiteReport(
      'frontend',
      'npm run test:ui',
      { ran: true, failing: ['a'] },
      { ran: false, failing: [], error: 'worktree add failed' },
    );
    expect(report.ran).toBe(false);
    expect(report.subsetHolds).toBe(false);
    expect(report.reason).toContain('branch');
    expect(report.reason).toContain('could not run');
  });

  test('base run incident → ran:false, subsetHolds:false, reason names base', () => {
    const report = computeSuiteReport(
      'gate',
      'npm test',
      { ran: false, failing: [], error: 'spawn failed' },
      { ran: true, failing: ['x'] },
    );
    expect(report.ran).toBe(false);
    expect(report.subsetHolds).toBe(false);
    expect(report.reason).toContain('base');
  });

  test('both sides incident → ran:false, reason names branch (checked first)', () => {
    const report = computeSuiteReport(
      'gate',
      'npm test',
      { ran: false, failing: [], error: 'base failed' },
      { ran: false, failing: [], error: 'branch failed' },
    );
    expect(report.ran).toBe(false);
    expect(report.reason).toContain('branch');
  });
});
