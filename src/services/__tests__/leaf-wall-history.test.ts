// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordNode, _closeLedgerDb, type LedgerEntry } from '../worker-ledger';
import { classifyWallReason, isHardWall, getLeafWallHistory, sameReviewWall } from '../leaf-wall-history';

let dir: string;

/** Seed one node row with sane defaults. ts is explicit so ordering is deterministic. */
function node(over: Partial<LedgerEntry> & { leafId: string; ts: number }): void {
  const { ts, ...rest } = over;
  recordNode(
    {
      project: '/p',
      todoId: over.leafId,
      session: 'lane',
      authMode: 'subscription',
      nodeKind: 'implement',
      model: 'sonnet',
      nodesSpent: 1,
      ...rest,
    },
    ts,
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-wall-history-'));
  process.env.MERMAID_SUPERVISOR_DIR = dir;
  _closeLedgerDb();
});
afterEach(() => {
  _closeLedgerDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('classifyWallReason', () => {
  test('returns "aborted" when leafOutcome is aborted', () => {
    const result = classifyWallReason({ leafOutcome: 'aborted' });
    expect(result).toBe('aborted');
  });

  test('returns "aborted" when terminal.effectiveOutcome is aborted', () => {
    const result = classifyWallReason({
      terminal: { effectiveOutcome: 'aborted' },
    });
    expect(result).toBe('aborted');
  });

  test('returns "rate-limited" when paused with rate-limited reason', () => {
    const result = classifyWallReason({
      leafOutcome: 'paused',
      terminal: { reason: 'rate-limited: cap reset at ...' },
    });
    expect(result).toBe('rate-limited');
  });

  test('returns "paused" when leafOutcome is paused without rate-limited reason', () => {
    const result = classifyWallReason({
      leafOutcome: 'paused',
      terminal: { reason: 'some-other-reason' },
    });
    expect(result).toBe('paused');
  });

  test('returns "epic-base-moved" when reason starts with epic-base-moved', () => {
    const result = classifyWallReason({
      terminal: { reason: 'epic-base-moved: base advanced' },
    });
    expect(result).toBe('epic-base-moved');
  });

  test('returns "infra" for node-could-not-start', () => {
    const result = classifyWallReason({
      terminal: { reason: 'node-could-not-start: ...' },
    });
    expect(result).toBe('infra');
  });

  test('returns "infra" for working-root-escape', () => {
    const result = classifyWallReason({
      terminal: { reason: 'working-root-escape: ...' },
    });
    expect(result).toBe('infra');
  });

  test('returns "same-wall-twice" when reason starts with same-wall-twice', () => {
    const result = classifyWallReason({
      terminal: { reason: 'same-wall-twice: ...' },
    });
    expect(result).toBe('same-wall-twice');
  });

  test('returns "attempt-cap-exhausted" when reason starts with attempt-cap-exhausted', () => {
    const result = classifyWallReason({
      terminal: { reason: 'attempt-cap-exhausted' },
    });
    expect(result).toBe('attempt-cap-exhausted');
  });

  test('returns "suspect-gate" when review passes but gate rejects', () => {
    const result = classifyWallReason({
      terminal: {
        reviewVerdict: 'pass',
        effectiveOutcome: 'rejected',
      },
    });
    expect(result).toBe('suspect-gate');
  });

  test('returns "suspect-gate" when review passes but gateReasons present', () => {
    const result = classifyWallReason({
      terminal: {
        reviewVerdict: 'pass',
        gateReasons: ['some-gate-failed'],
      },
    });
    expect(result).toBe('suspect-gate');
  });

  test('returns "gate-rejected" when reason is gate-rejected', () => {
    const result = classifyWallReason({
      terminal: { reason: 'gate-rejected' },
    });
    expect(result).toBe('gate-rejected');
  });

  test('returns "gate-rejected" when effectiveOutcome is rejected', () => {
    const result = classifyWallReason({
      terminal: { effectiveOutcome: 'rejected' },
    });
    expect(result).toBe('gate-rejected');
  });

  test('returns "review-fail" when reviewVerdict is fail', () => {
    const result = classifyWallReason({
      terminal: { reviewVerdict: 'fail' },
    });
    expect(result).toBe('review-fail');
  });

  test('returns "none" by default', () => {
    const result = classifyWallReason({});
    expect(result).toBe('none');
  });

  test('returns "none" when terminal is undefined', () => {
    const result = classifyWallReason({ terminal: undefined });
    expect(result).toBe('none');
  });
});

describe('isHardWall', () => {
  test('returns true for review-fail', () => {
    expect(isHardWall('review-fail')).toBe(true);
  });

  test('returns true for gate-rejected', () => {
    expect(isHardWall('gate-rejected')).toBe(true);
  });

  test('returns true for same-wall-twice', () => {
    expect(isHardWall('same-wall-twice')).toBe(true);
  });

  test('returns true for attempt-cap-exhausted', () => {
    expect(isHardWall('attempt-cap-exhausted')).toBe(true);
  });

  test('returns true for suspect-gate', () => {
    expect(isHardWall('suspect-gate')).toBe(true);
  });

  test('returns false for paused', () => {
    expect(isHardWall('paused')).toBe(false);
  });

  test('returns false for rate-limited', () => {
    expect(isHardWall('rate-limited')).toBe(false);
  });

  test('returns false for epic-base-moved', () => {
    expect(isHardWall('epic-base-moved')).toBe(false);
  });

  test('returns false for aborted', () => {
    expect(isHardWall('aborted')).toBe(false);
  });

  test('returns false for infra', () => {
    expect(isHardWall('infra')).toBe(false);
  });

  test('returns false for none', () => {
    expect(isHardWall('none')).toBe(false);
  });
});

describe('sameReviewWall', () => {
  test('returns true when two texts share >=50% defect lines', () => {
    const a = '[UNMET] error on line 10\n[UNMET] failed validation\n[MET] other criteria';
    const b = '[UNMET] error on line 12\n[UNMET] failed validation\n[MET] different criteria';
    expect(sameReviewWall(a, b)).toBe(true);
  });

  test('returns false when no shared defect lines', () => {
    const a = '[UNMET] error A\n[UNMET] failed B';
    const b = '[UNMET] error X\n[UNMET] failed Y';
    expect(sameReviewWall(a, b)).toBe(false);
  });

  test('returns false when either text is empty', () => {
    expect(sameReviewWall('', 'some text')).toBe(false);
    expect(sameReviewWall('some text', '')).toBe(false);
  });

  test('returns false when texts have no significant lines', () => {
    expect(sameReviewWall('short', 'tiny')).toBe(false);
  });
});

describe('getLeafWallHistory', () => {
  test('returns zero history for leaf with no prior runs', () => {
    node({ leafId: 'LX', ts: 1000, nodeKind: 'blueprint', model: 'opus' });
    node({ leafId: 'LX', ts: 2000, nodeKind: 'implement', model: 'sonnet' });
    // No outcome marker = in-flight run
    const history = getLeafWallHistory('LX');
    expect(history.leafId).toBe('LX');
    expect(history.priorRuns).toBe(0);
    expect(history.hardWallCount).toBe(0);
    expect(history.lastReasonClass).toBe('none');
    expect(history.repeatedWall).toBe(false);
    expect(history.suspectGate).toBe(false);
    expect(history.priorImplementModels).toEqual([]);
  });

  test('tracks two-run fixture with hard walls and repeated walls', () => {
    // Run A: blueprint + implement@sonnet + review + outcome with review-fail
    node({ leafId: 'LX', ts: 1000, nodeKind: 'blueprint', model: 'opus' });
    node({ leafId: 'LX', ts: 2000, nodeKind: 'implement', model: 'sonnet' });
    node({
      leafId: 'LX',
      ts: 3000,
      nodeKind: 'review',
      model: 'opus',
      outputText: '[UNMET] defect one\n[UNMET] failed check',
      verdict: 'fail',
    });
    node({
      leafId: 'LX',
      ts: 4000,
      nodeKind: 'outcome',
      model: 'none',
      nodesSpent: 0,
      leafOutcome: 'blocked',
      outcomeDetail: JSON.stringify({ reviewVerdict: 'fail' }),
    });

    // Gap >= RUN_GAP_MS (2 minutes)
    const RUN_GAP_MS = 120_000;
    const gapStart = 4000 + RUN_GAP_MS + 1000; // 125001

    // Run B: blueprint + implement@opus + review + outcome with review-fail
    node({ leafId: 'LX', ts: gapStart, nodeKind: 'blueprint', model: 'opus' });
    node({ leafId: 'LX', ts: gapStart + 1000, nodeKind: 'implement', model: 'opus' });
    node({
      leafId: 'LX',
      ts: gapStart + 2000,
      nodeKind: 'review',
      model: 'opus',
      outputText: '[UNMET] defect one\n[UNMET] failed check\n[MET] other',
      verdict: 'fail',
    });
    node({
      leafId: 'LX',
      ts: gapStart + 3000,
      nodeKind: 'outcome',
      model: 'none',
      nodesSpent: 0,
      leafOutcome: 'blocked',
      outcomeDetail: JSON.stringify({ reviewVerdict: 'fail' }),
    });

    const history = getLeafWallHistory('LX');
    expect(history.priorRuns).toBe(2);
    expect(history.hardWallCount).toBe(2);
    expect(history.lastReasonClass).toBe('review-fail');
    expect(history.repeatedWall).toBe(true); // Same defect lines in both runs
    expect(history.suspectGate).toBe(false); // No suspect-gate classification
    expect(history.priorImplementModels).toEqual(['sonnet', 'opus']);
  });

  test('detects suspect-gate in wall history', () => {
    // Run A: review-pass but gate-rejected
    node({ leafId: 'LX', ts: 1000, nodeKind: 'blueprint', model: 'opus' });
    node({
      leafId: 'LX',
      ts: 2000,
      nodeKind: 'review',
      model: 'opus',
      verdict: 'pass',
    });
    node({
      leafId: 'LX',
      ts: 3000,
      nodeKind: 'outcome',
      model: 'none',
      nodesSpent: 0,
      leafOutcome: 'blocked',
      outcomeDetail: JSON.stringify({
        reviewVerdict: 'pass',
        effectiveOutcome: 'rejected',
        gateReasons: ['tsc-error'],
      }),
    });

    const history = getLeafWallHistory('LX');
    expect(history.priorRuns).toBe(1);
    expect(history.hardWallCount).toBe(1);
    expect(history.suspectGate).toBe(true);
    expect(history.lastReasonClass).toBe('suspect-gate');
  });
});
