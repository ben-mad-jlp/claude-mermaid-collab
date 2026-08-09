import { describe, expect, test, beforeEach } from 'bun:test';
import { isEpicLandedInGit, getEpicLandCommit, type GitRunner } from '../epic-landedness.js';
import { resetTrunkLandIndex } from '../trunk-land-index.js';

describe('epic-landedness cost amortization', () => {
  beforeEach(() => {
    resetTrunkLandIndex();
  });

  test('issues exactly one log invocation total across several distinct epic ids', async () => {
    let logCallCount = 0;
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'mastershaa\n' };
      if (args[0] === 'log') {
        logCallCount++;
        return {
          code: 0,
          stdout: '\x1eabc111\t2026-07-01T10:00:00+00:00\tCollab-Epic: epic1\n'
            + '\x1eabc222\t2026-07-01T10:01:00+00:00\tCollab-Epic: epic2\n'
            + '\x1eabc333\t2026-07-01T10:02:00+00:00\tCollab-Epic: epic3\n',
        };
      }
      return { code: 1, stdout: '' };
    };

    // Query three different epic ids
    const result1 = await isEpicLandedInGit('/repo', 'epic1', { runGit });
    const result2 = await isEpicLandedInGit('/repo', 'epic2', { runGit });
    const result3 = await isEpicLandedInGit('/repo', 'epic3', { runGit });

    expect(result1).toBe('landed');
    expect(result2).toBe('landed');
    expect(result3).toBe('landed');
    expect(logCallCount).toBe(1);
  });

  test('issues zero additional log invocations when the trunk tip is unchanged', async () => {
    let logCallCount = 0;
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'mastershaa\n' };
      if (args[0] === 'log') {
        logCallCount++;
        return {
          code: 0,
          stdout: '\x1eabc111\t2026-07-01T10:00:00+00:00\tCollab-Epic: epic1\n',
        };
      }
      return { code: 1, stdout: '' };
    };

    // First query — log is called
    await isEpicLandedInGit('/repo', 'epic1', { runGit });
    expect(logCallCount).toBe(1);

    // Second query with same trunk tip — no additional log call
    await isEpicLandedInGit('/repo', 'epic2', { runGit });
    expect(logCallCount).toBe(1);

    // Third query with same trunk tip — still no additional log call
    await isEpicLandedInGit('/repo', 'epic3', { runGit });
    expect(logCallCount).toBe(1);
  });

  test('issues exactly one fresh log invocation after the trunk tip moves', async () => {
    let logCallCount = 0;
    let tipSha = 'mastershaa';

    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: tipSha + '\n' };
      if (args[0] === 'log') {
        logCallCount++;
        return {
          code: 0,
          stdout: `\x1eabc${logCallCount}\t2026-07-01T10:${logCallCount}:00+00:00\tCollab-Epic: epic1\n`,
        };
      }
      return { code: 1, stdout: '' };
    };

    // First query with tip = mastershaa
    const result1 = await isEpicLandedInGit('/repo', 'epic1', { runGit });
    expect(result1).toBe('landed');
    expect(logCallCount).toBe(1);

    // Move the trunk tip
    tipSha = 'mastershab';

    // Query again — should get one fresh log call
    const result2 = await isEpicLandedInGit('/repo', 'epic1', { runGit });
    expect(result2).toBe('landed');
    expect(logCallCount).toBe(2);

    // Query a different epic with the new tip — no additional log call (cached)
    const result3 = await isEpicLandedInGit('/repo', 'epic2', { runGit });
    expect(logCallCount).toBe(2);
  });

  test('concurrent callers on a cold cache share a single log invocation', async () => {
    let logCallCount = 0;
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'mastershaa\n' };
      if (args[0] === 'log') {
        logCallCount++;
        return {
          code: 0,
          stdout: '\x1eabc111\t2026-07-01T10:00:00+00:00\tCollab-Epic: epic1\n'
            + '\x1eabc222\t2026-07-01T10:01:00+00:00\tCollab-Epic: epic2\n'
            + '\x1eabc333\t2026-07-01T10:02:00+00:00\tCollab-Epic: epic3\n',
        };
      }
      return { code: 1, stdout: '' };
    };

    // Fire three concurrent queries without awaiting the first to settle
    const promise1 = isEpicLandedInGit('/repo', 'epic1', { runGit });
    const promise2 = isEpicLandedInGit('/repo', 'epic2', { runGit });
    const promise3 = isEpicLandedInGit('/repo', 'epic3', { runGit });

    const result1 = await promise1;
    const result2 = await promise2;
    const result3 = await promise3;

    expect(result1).toBe('landed');
    expect(result2).toBe('landed');
    expect(result3).toBe('landed');
    // All three concurrent calls should have shared a single log invocation
    expect(logCallCount).toBe(1);
  });

  test('maps a trailer-present epic to landed with sha/committedAtIso and a trailer-absent epic to not-landed with nulls', async () => {
    const runGit: GitRunner = async (_cwd, args) => {
      if (args[0] === 'symbolic-ref') return { code: 0, stdout: 'master\n' };
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'mastershaa\n' };
      if (args[0] === 'log') {
        return {
          code: 0,
          stdout: '\x1eabc111\t2026-07-01T10:00:00+00:00\tCollab-Epic: epic1\n',
        };
      }
      return { code: 1, stdout: '' };
    };

    // Query the epic with a trailer
    const landedCommit = await getEpicLandCommit('/repo', 'epic1', { runGit });
    expect(landedCommit.status).toBe('landed');
    expect(landedCommit.sha).toBe('abc111');
    expect(landedCommit.committedAtIso).toBe('2026-07-01T10:00:00+00:00');

    // Query an epic without a trailer (same index)
    const notLandedCommit = await getEpicLandCommit('/repo', 'epic2', { runGit });
    expect(notLandedCommit.status).toBe('not-landed');
    expect(notLandedCommit.sha).toBeNull();
    expect(notLandedCommit.committedAtIso).toBeNull();
  });
});
