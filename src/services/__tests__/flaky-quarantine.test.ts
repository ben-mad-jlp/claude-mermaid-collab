/**
 * Pure classifier tests for flaky-quarantine.
 * No DB, no I/O — all test data is hand-authored literals.
 */

import { describe, it, expect } from 'vitest';
import {
  type BaseGateTestRunRow,
  type TestQuarantineRow,
} from '../worker-ledger';
import {
  classifyFlakyCandidates,
  filterActiveQuarantine,
  DEFAULT_TTL_MS,
  closeQuarantineOnGreen,
} from '../flaky-quarantine';

describe('flaky-quarantine classifier', () => {
  it('flips across 3 runs at a fixed sha → quarantined', () => {
    const now = 1000;
    const observations: BaseGateTestRunRow[] = [
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'flaky_test.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 200,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'flaky_test.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 100,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'flaky_test.txt',
        failed: true,
        scope: 'base',
        observedAt: now,
      },
    ];

    const candidates = classifyFlakyCandidates(observations, now);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      test: 'flaky_test.txt',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 3, passRuns: 1, failRuns: 2 },
      ttlExpiresAt: now + DEFAULT_TTL_MS,
    });
  });

  it('red-on-branch/green-on-master is never quarantined (base rows alone would qualify as flaky; only the branch veto suppresses it)', () => {
    const now = 1000;
    const observations: BaseGateTestRunRow[] = [
      // Base-scope rows alone would qualify as flaky (mixed pass/fail at a fixed sha)
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'branch_red_test.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 300,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'branch_red_test.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 200,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'branch_red_test.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 100,
      },
      // Red on branch
      {
        project: 'test-proj',
        baseSha: 'xyz789',
        lane: 'branch',
        test: 'branch_red_test.txt',
        failed: true,
        scope: 'branch',
        observedAt: now,
      },
    ];

    const candidates = classifyFlakyCandidates(observations, now);

    expect(candidates).toHaveLength(0);
  });

  it('failure correlating with a specific sha is never quarantined', () => {
    const now = 1000;
    const observations: BaseGateTestRunRow[] = [
      // All fail at sha A
      {
        project: 'test-proj',
        baseSha: 'sha_a',
        lane: 'base',
        test: 'deterministic_fail.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 300,
      },
      {
        project: 'test-proj',
        baseSha: 'sha_a',
        lane: 'base',
        test: 'deterministic_fail.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 200,
      },
      {
        project: 'test-proj',
        baseSha: 'sha_a',
        lane: 'base',
        test: 'deterministic_fail.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 100,
      },
      // All pass at sha B
      {
        project: 'test-proj',
        baseSha: 'sha_b',
        lane: 'base',
        test: 'deterministic_fail.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 60,
      },
      {
        project: 'test-proj',
        baseSha: 'sha_b',
        lane: 'base',
        test: 'deterministic_fail.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 30,
      },
      {
        project: 'test-proj',
        baseSha: 'sha_b',
        lane: 'base',
        test: 'deterministic_fail.txt',
        failed: false,
        scope: 'base',
        observedAt: now,
      },
    ];

    const candidates = classifyFlakyCandidates(observations, now);

    // Each sha is either all-pass or all-fail, so no sha has both → not flaky.
    expect(candidates).toHaveLength(0);
  });

  it('a test that never passed in the window is never quarantined', () => {
    const now = 1000;
    const observations: BaseGateTestRunRow[] = [
      // Only failures
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'always_fails.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 200,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'always_fails.txt',
        failed: true,
        scope: 'base',
        observedAt: now - 100,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'always_fails.txt',
        failed: true,
        scope: 'base',
        observedAt: now,
      },
    ];

    const candidates = classifyFlakyCandidates(observations, now);

    // No passing rows anywhere → skip.
    expect(candidates).toHaveLength(0);
  });

  it('a TTL-expired record is not active', () => {
    const now = 10000;
    const expired: TestQuarantineRow = {
      project: 'test-proj',
      test: 'old_quarantine.txt',
      quarantinedAtSha: 'old_sha',
      evidence: { runs: 5, passRuns: 2, failRuns: 3 },
      ttlExpiresAt: now - 1000, // Expired
      seededFrom: null,
      createdAt: now - 10000,
    };

    const active = filterActiveQuarantine([expired], now);

    expect(active).toHaveLength(0);
  });
});

describe('closeQuarantineOnGreen', () => {
  it('closes the quarantine row and its todo after a green-only observation window', async () => {
    const now = 10000;
    const createdAt = now - 1000;
    const quarantineRecord: TestQuarantineRow = {
      project: 'test-proj',
      test: 'flaky_test.txt',
      quarantinedAtSha: 'abc123',
      evidence: { runs: 5, passRuns: 3, failRuns: 2 },
      ttlExpiresAt: now + 86_400_000,
      seededFrom: null,
      createdAt,
    };

    const greenObservations: BaseGateTestRunRow[] = [
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'flaky_test.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 500,
      },
      {
        project: 'test-proj',
        baseSha: 'abc123',
        lane: 'base',
        test: 'flaky_test.txt',
        failed: false,
        scope: 'base',
        observedAt: now - 100,
      },
    ];

    const removeTestQuarantineCalls: Array<[string, string]> = [];
    const updateTodoCalls: Array<[string, string, { status: string }]> = [];

    await closeQuarantineOnGreen('test-proj', now, {
      listTestQuarantine: () => [quarantineRecord],
      listObservations: () => greenObservations,
      removeTestQuarantine: (project, test) => {
        removeTestQuarantineCalls.push([project, test]);
      },
      listTodos: () => [
        {
          id: 'todo-1',
          title: '[BUG] flaky test quarantined: flaky_test.txt',
          status: 'planned',
          parentId: 'flaky-epic-id',
        } as any,
      ],
      updateTodo: async (project, todoId, updates) => {
        updateTodoCalls.push([project, todoId, updates as { status: string }]);
        return { id: todoId } as any;
      },
    });

    expect(removeTestQuarantineCalls).toHaveLength(1);
    expect(removeTestQuarantineCalls[0]).toEqual(['test-proj', 'flaky_test.txt']);

    expect(updateTodoCalls).toHaveLength(1);
    expect(updateTodoCalls[0][0]).toBe('test-proj');
    expect(updateTodoCalls[0][1]).toBe('todo-1');
    expect(updateTodoCalls[0][2].status).toBe('done');
  });
});
