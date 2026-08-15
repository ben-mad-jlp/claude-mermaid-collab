import { describe, it, expect } from 'bun:test';
import {
  leafExecutorCondition,
  leafParkReasonClass,
  LEAF_EXECUTOR_CONDITION_REASONS,
} from '../leaf-executor-condition-keys';

describe('leafExecutorCondition', () => {
  it('builds conditionKey and conditionTuple from kind and parts', () => {
    const result = leafExecutorCondition('blocker', 'abc12345', 'def67890', 'epic-base-red');
    expect(result.conditionKey).toBe('blocker:abc12345:def67890:epic-base-red');
    expect(result.conditionTuple).toEqual(['blocker', 'abc12345', 'def67890', 'epic-base-red']);
  });

  it('handles a single kind with no parts', () => {
    const result = leafExecutorCondition('empty-diff-declared-changes', 'abc12345');
    expect(result.conditionKey).toBe('empty-diff-declared-changes:abc12345');
    expect(result.conditionTuple).toEqual(['empty-diff-declared-changes', 'abc12345']);
  });

  it('conditionKey joins the same parts as conditionTuple', () => {
    const result = leafExecutorCondition('blocker', 'leafId', 'epicId', 'reason');
    expect(result.conditionKey).toBe(result.conditionTuple.join(':'));
  });
});

describe('leafParkReasonClass', () => {
  it('extracts the part before the first colon', () => {
    expect(leafParkReasonClass('optimistic-merge-revert-failed: some finding detail'))
      .toBe('optimistic-merge-revert-failed');
  });

  it('extracts the part before the first newline when no colon', () => {
    expect(leafParkReasonClass('epic-base-red: cmd\n--- output (tail) ---\nerror line 2'))
      .toBe('epic-base-red');
  });

  it('uses whichever comes first: colon or newline', () => {
    // Colon comes before newline
    expect(leafParkReasonClass('reason: detail\nmore output')).toBe('reason');
    // Newline comes before colon
    expect(leafParkReasonClass('reason\nmore: output')).toBe('reason');
  });

  it('returns the reason unchanged if it contains no separator', () => {
    expect(leafParkReasonClass('empty-diff-spec-demands-changes')).toBe(
      'empty-diff-spec-demands-changes',
    );
    expect(leafParkReasonClass('discarded-not-owned')).toBe('discarded-not-owned');
  });

  it('trims and lowercases the result', () => {
    expect(leafParkReasonClass('  REASON: detail')).toBe('reason');
    expect(leafParkReasonClass('ReAsOn\nmore')).toBe('reason');
  });

  it('returns "unknown" for empty or whitespace input', () => {
    expect(leafParkReasonClass('')).toBe('unknown');
    expect(leafParkReasonClass('   ')).toBe('unknown');
    expect(leafParkReasonClass('\n')).toBe('unknown');
    expect(leafParkReasonClass('\t')).toBe('unknown');
  });

  it('leafParkReasonClass collapses a gate tail and a sha suffix to the same class token', () => {
    // Simulate two identical reasons that differ only in details after the class token
    const reason1 = 'epic-base-red: bun test\n--- output (tail) ---\nTest failed at line 1\nsha1234567890';
    const reason2 =
      'epic-base-red: bun test\n--- output (tail) ---\nTest failed at line 5\nsha9876543210';
    expect(leafParkReasonClass(reason1)).toBe('epic-base-red');
    expect(leafParkReasonClass(reason2)).toBe('epic-base-red');
    expect(leafParkReasonClass(reason1)).toBe(leafParkReasonClass(reason2));
  });
});

describe('LEAF_EXECUTOR_CONDITION_REASONS', () => {
  it('contains all required reason types', () => {
    expect(LEAF_EXECUTOR_CONDITION_REASONS.securityViolation).toBe('security-violation');
    expect(LEAF_EXECUTOR_CONDITION_REASONS.optimisticMergeRevertFailed).toBe(
      'optimistic-merge-revert-failed',
    );
    expect(LEAF_EXECUTOR_CONDITION_REASONS.parkBlocked).toBe('park-blocked');
    expect(LEAF_EXECUTOR_CONDITION_REASONS.nodeCouldNotStart).toBe('node-could-not-start');
    expect(LEAF_EXECUTOR_CONDITION_REASONS.epicBaseRed).toBe('epic-base-red');
    expect(LEAF_EXECUTOR_CONDITION_REASONS.scopeIncident).toBe('scope-incident');
    expect(LEAF_EXECUTOR_CONDITION_REASONS.emptyDiffDeclaredChanges).toBe(
      'empty-diff-declared-changes',
    );
  });

  it('is frozen', () => {
    expect(() => {
      (LEAF_EXECUTOR_CONDITION_REASONS as any).newProperty = 'value';
    }).toThrow();
  });
});
