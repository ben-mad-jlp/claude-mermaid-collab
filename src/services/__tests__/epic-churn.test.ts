import { test, expect } from 'bun:test';
import {
  normaliseReason,
  summariseEpicOutcomes,
  detectEpicChurn,
  buildTighterDecompositionHint,
} from '../epic-churn';
import { EPIC_CHURN_REJECT_THRESHOLD as THRESHOLD } from '../harness-caps';
import type { LeafRunSummary } from '../ledger-stats';

function run(over: Partial<LeafRunSummary>): LeafRunSummary {
  return {
    leafId: 'l',
    project: '/p',
    epicId: 'e',
    finalOutcome: 'rejected',
    reviewVerdict: null,
    reason: null,
    pathTaken: null,
    tier: null,
    lastTs: 1,
    nodesSpent: 5,
    costUsd: 1,
    ...over,
  };
}

test('normaliseReason: trim + lowercase + collapse whitespace + sha replacement', () => {
  expect(normaliseReason('  HELLO  WORLD  ')).toBe('hello world');
  expect(normaliseReason('Failed: 1234567')).toBe('failed: <sha>');
  expect(normaliseReason('Failed: 1234567890abcdef')).toBe('failed: <sha>');
  expect(normaliseReason('  ')).toBeNull();
  expect(normaliseReason(null)).toBeNull();
  expect(normaliseReason(undefined)).toBeNull();
  expect(normaliseReason('')).toBeNull();
});

test('normaliseReason: deduplicates reasons that differ only by sha', () => {
  const r1 = normaliseReason('Error at 1234567890abcdef');
  const r2 = normaliseReason('Error at fedcba0987654321');
  expect(r1).toBe(r2);
  expect(r1).toBe('error at <sha>');
});

test('normaliseReason: only matches valid hex tokens (a-f only, not g-z)', () => {
  // 'abcdef' (6 chars, all hex) should NOT match (< 7)
  expect(normaliseReason('test abcdef')).toBe('test abcdef');
  // 'abcdef123' (9 chars, all hex) SHOULD match (>= 7)
  expect(normaliseReason('test abcdef123')).toBe('test <sha>');
  // 'abcdefg' contains 'g' which is not hex, so won't fully match
  expect(normaliseReason('test abcdefg')).toBe('test abcdefg');
});

test('summariseEpicOutcomes: counts by finalOutcome and dedupes reasons', () => {
  const summary = summariseEpicOutcomes([
    run({ finalOutcome: 'rejected', reason: 'Boom error 1234567' }),
    run({ finalOutcome: 'rejected', reason: 'BOOM ERROR fedcba0987654321' }), // deduped with previous
    run({ finalOutcome: 'rejected', reason: 'Other problem' }),
    run({ finalOutcome: 'blocked', reason: 'Timeout' }),
    run({ finalOutcome: 'accepted', reason: null }),
  ]);
  expect(summary.rejectedCount).toBe(3);
  expect(summary.blockedCount).toBe(1);
  expect(summary.acceptedCount).toBe(1);
  expect(summary.distinctReasons).toHaveLength(3);
  expect(summary.distinctReasons[0]).toBe('boom error <sha>');
  expect(summary.distinctReasons[1]).toBe('other problem');
  expect(summary.distinctReasons[2]).toBe('timeout');
});

test('detectEpicChurn: 5 rejected + 1 accepted ⇒ churning false', () => {
  const result = detectEpicChurn({
    runs: [
      run({ finalOutcome: 'rejected' }),
      run({ finalOutcome: 'rejected' }),
      run({ finalOutcome: 'rejected' }),
      run({ finalOutcome: 'rejected' }),
      run({ finalOutcome: 'rejected' }),
      run({ finalOutcome: 'accepted' }),
    ],
  });
  expect(result.churning).toBe(false);
  expect(result.acceptedCount).toBe(1);
});

test('detectEpicChurn: exactly EPIC_CHURN_REJECT_THRESHOLD rejected + 0 accepted ⇒ churning true', () => {
  const result = detectEpicChurn({
    runs: [
      run({ finalOutcome: 'rejected' }),
      run({ finalOutcome: 'rejected' }), // = THRESHOLD
    ],
  });
  expect(THRESHOLD).toBe(2); // verify the constant
  expect(result.churning).toBe(true);
  expect(result.acceptedCount).toBe(0);
});

test('detectEpicChurn: one below threshold ⇒ churning false', () => {
  const result = detectEpicChurn({
    runs: [run({ finalOutcome: 'rejected' })],
  });
  expect(result.churning).toBe(false);
});

test('detectEpicChurn: summary input (already summarized)', () => {
  const summary = summariseEpicOutcomes([
    run({ finalOutcome: 'rejected' }),
    run({ finalOutcome: 'rejected' }),
  ]);
  const result = detectEpicChurn(summary);
  expect(result.churning).toBe(true);
  expect(result.rejectedCount).toBe(2);
});

test('buildTighterDecompositionHint: computes ceiling and renders reasons', () => {
  const output = buildTighterDecompositionHint({
    priorEpicTitle: 'MyEpic',
    priorLeafCount: 6,
    distinctReasons: ['reason 1', 'reason 2'],
  });

  expect(output).toContain('MyEpic');
  expect(output).toContain('6 leaves');
  expect(output).toContain('reason 1');
  expect(output).toContain('reason 2');

  const match = output.match(/at most (\d+) leaves/);
  expect(match).not.toBeNull();
  if (match) {
    const n = parseInt(match[1], 10);
    expect(n).toBeLessThan(6);
    expect(n).toBeGreaterThan(0);
  }
});

test('buildTighterDecompositionHint: empty reasons renders no-recorded message', () => {
  const output = buildTighterDecompositionHint({
    priorEpicTitle: 'Test',
    priorLeafCount: 4,
    distinctReasons: [],
  });

  expect(output).toContain('(no recorded rejection reasons)');
});
