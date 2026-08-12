// Runs via `bun test`.
import { describe, it, expect } from 'bun:test';
import { runQuarantinePromotionReport } from '../flaky-quarantine-report';
import type { FlakyCandidate } from '../flaky-quarantine';

function makeCandidate(overrides: Partial<FlakyCandidate> = {}): FlakyCandidate & { project: string } {
  return {
    project: '/tmp/fake-project',
    test: overrides.test ?? 'src/foo.test.ts > does the thing',
    quarantinedAtSha: overrides.quarantinedAtSha ?? 'abc1234',
    evidence: overrides.evidence ?? { runs: 10, passRuns: 6, failRuns: 4 },
    ttlExpiresAt: overrides.ttlExpiresAt ?? Date.now() + 86_400_000,
  };
}

describe('runQuarantinePromotionReport', () => {
  it('files exactly one friction call and one createTodo call on promotion', async () => {
    const frictionCalls: unknown[] = [];
    const todoCalls: unknown[] = [];
    const candidate = makeCandidate();

    await runQuarantinePromotionReport(candidate, {
      recordFrictionOnce: async (project, input) => {
        frictionCalls.push({ project, input });
        return true;
      },
      ensureBucket: async () => 'bugfix-epic-id',
      createTodo: async (project, input) => {
        todoCalls.push({ project, input });
        return { id: 'todo-1' } as any;
      },
    });

    expect(frictionCalls.length).toBe(1);
    expect(todoCalls.length).toBe(1);
    const call = todoCalls[0] as { input: { parentId: string; title: string } };
    expect(call.input.parentId).toBe('bugfix-epic-id');
    expect(call.input.title).toBe(`[BUG] flaky test quarantined: ${candidate.test}`);
  });

  it('files createTodo exactly once total across duplicate promotions of the same sha', async () => {
    let frictionCallCount = 0;
    let todoCallCount = 0;
    const candidate = makeCandidate();

    const deps = {
      recordFrictionOnce: async () => {
        frictionCallCount += 1;
        return frictionCallCount === 1;
      },
      ensureBucket: async () => 'bugfix-epic-id',
      createTodo: async () => {
        todoCallCount += 1;
        return { id: 'todo-1' } as any;
      },
    };

    await runQuarantinePromotionReport(candidate, deps);
    await runQuarantinePromotionReport(candidate, deps);

    expect(frictionCallCount).toBe(2);
    expect(todoCallCount).toBe(1);
  });

  it('detail JSON deep-equals an object carrying test/quarantinedAtSha/evidence/ttlExpiresAt', async () => {
    const candidate = makeCandidate();
    let capturedDetail: string | undefined;

    await runQuarantinePromotionReport(candidate, {
      recordFrictionOnce: async (_project, input) => {
        capturedDetail = input.detail;
        return true;
      },
      ensureBucket: async () => 'bugfix-epic-id',
      createTodo: async () => ({ id: 'todo-1' } as any),
    });

    expect(capturedDetail).toBeDefined();
    const parsed = JSON.parse(capturedDetail!);
    expect(parsed.test).toBe(candidate.test);
    expect(parsed.quarantinedAtSha).toBe(candidate.quarantinedAtSha);
    expect(parsed.evidence).toEqual(candidate.evidence);
    expect(parsed.ttlExpiresAt).toBe(candidate.ttlExpiresAt);
  });

  it('does not propagate a throw from createTodo', async () => {
    const candidate = makeCandidate();

    await expect(
      runQuarantinePromotionReport(candidate, {
        recordFrictionOnce: async () => true,
        ensureBucket: async () => 'bugfix-epic-id',
        createTodo: async () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('files exactly one todo when the same test is promoted at three different shas', async () => {
    let createTodoCount = 0;
    let listTodosReturnValue: any[] = [];
    const candidate = makeCandidate();
    const candidate2 = makeCandidate({ quarantinedAtSha: 'sha2' });
    const candidate3 = makeCandidate({ quarantinedAtSha: 'sha3' });

    const deps = {
      recordFrictionOnce: async () => true,
      ensureBucket: async () => 'flaky-epic-id',
      listTodos: () => listTodosReturnValue,
      updateTodo: async () => ({ id: 'todo-1' } as any),
      createTodo: async () => {
        createTodoCount += 1;
        return { id: 'todo-1' } as any;
      },
    };

    await runQuarantinePromotionReport(candidate, deps);
    // Simulate finding the existing todo on the second call
    listTodosReturnValue = [
      {
        id: 'todo-1',
        parentId: 'flaky-epic-id',
        title: `[BUG] flaky test quarantined: ${candidate.test}`,
        status: 'planned',
      },
    ];

    await runQuarantinePromotionReport(candidate2, deps);
    await runQuarantinePromotionReport(candidate3, deps);

    expect(createTodoCount).toBe(1);
  });

  it('files the quarantine todo under the flaky bucket, not the bugfix bucket', async () => {
    const candidate = makeCandidate();
    let ensureBucketArg: string | undefined;

    await runQuarantinePromotionReport(candidate, {
      recordFrictionOnce: async () => true,
      ensureBucket: async (project, type) => {
        ensureBucketArg = type;
        return `${type}-epic-id`;
      },
      listTodos: () => [],
      createTodo: async (project, input) => {
        expect(input.parentId).toBe('flaky-epic-id');
        return { id: 'todo-1' } as any;
      },
    });

    expect(ensureBucketArg).toBe('flaky');
  });

  it('filed row carries the resolved test file path', async () => {
    const candidate = makeCandidate({
      test: 'test suite > test case',
    });
    let capturedDescription: string | null | undefined;
    let capturedTitle: string | undefined;

    await runQuarantinePromotionReport(candidate, {
      recordFrictionOnce: async () => true,
      ensureBucket: async () => 'flaky-epic-id',
      listTodos: () => [],
      createTodo: async (project, input) => {
        capturedTitle = input.title;
        capturedDescription = input.description;
        return { id: 'todo-1' } as any;
      },
      resolveTestFile: (project, test) => 'src/services/__tests__/my-test.test.ts',
    });

    expect(capturedTitle).toBe(`[BUG] flaky test quarantined: ${candidate.test} [src/services/__tests__/my-test.test.ts]`);
    expect(capturedDescription).toContain('Test file: src/services/__tests__/my-test.test.ts');
  });

  it('does not append file path if test string already contains src/ or ui/', async () => {
    const candidate = makeCandidate({
      test: 'src/services/__tests__/sweep-measurement.test.ts > does the thing',
    });
    let capturedTitle: string | undefined;

    await runQuarantinePromotionReport(candidate, {
      recordFrictionOnce: async () => true,
      ensureBucket: async () => 'flaky-epic-id',
      listTodos: () => [],
      createTodo: async (project, input) => {
        capturedTitle = input.title;
        return { id: 'todo-1' } as any;
      },
      resolveTestFile: (project, test) => 'src/services/__tests__/sweep-measurement.test.ts',
    });

    expect(capturedTitle).toBe(`[BUG] flaky test quarantined: ${candidate.test}`);
  });
});
