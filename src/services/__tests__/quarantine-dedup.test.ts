// Runs via `bun test`.
import { describe, it, expect } from 'bun:test';
import { quarantineDedupKey, collapseQuarantineDuplicates } from '../quarantine-dedup';
import { runQuarantinePromotionReport } from '../flaky-quarantine-report';
import type { FlakyCandidate } from '../flaky-quarantine';
import type { Todo, UpdateTodoPatch } from '../todo-store';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: overrides.id ?? 'todo-id',
    ownerSession: 'owner',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: overrides.title ?? '[BUG] flaky test quarantined: src/foo.test.ts',
    description: overrides.description ?? null,
    status: overrides.status ?? 'planned',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: overrides.parentId ?? 'flaky-epic-id',
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: overrides.createdAt ?? '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
  } as unknown as Todo;
}

describe('quarantineDedupKey', () => {
  it('collapses progress-counter variants of the same file to one key', () => {
    const a = quarantineDedupKey('(444/492) src/services/__tests__/sweep-measurement.test.ts');
    const b = quarantineDedupKey('(463/514) src/services/__tests__/sweep-measurement.test.ts');
    expect(a).toBe(b);
    expect(a).toBe('src/services/__tests__/sweep-measurement.test.ts');
  });

  it('keeps distinct name-only rows on distinct keys', () => {
    const a = quarantineDedupKey(
      'land_epic async dispatch > on a merge conflict master is untouched…',
    );
    const b = quarantineDedupKey('suites:^ui\\/::unhandled-rejection:…');
    expect(a).not.toBe(b);
  });
});

describe('collapseQuarantineDuplicates', () => {
  it('closes duplicates and leaves 2 open rows across 2 files', async () => {
    const fixture: Todo[] = [
      makeTodo({
        id: 'a-survivor',
        title: '[BUG] flaky test quarantined: (444/492) src/services/__tests__/sweep-measurement.test.ts',
        createdAt: '2026-08-10T00:00:00.000Z',
      }),
      makeTodo({
        id: 'a-dup1',
        title: '[BUG] flaky test quarantined: (463/514) src/services/__tests__/sweep-measurement.test.ts',
        createdAt: '2026-08-11T00:00:00.000Z',
      }),
      makeTodo({
        id: 'a-dup2',
        title: '[BUG] flaky test quarantined: (500/600) src/services/__tests__/sweep-measurement.test.ts',
        createdAt: '2026-08-12T00:00:00.000Z',
      }),
      makeTodo({
        id: 'b-survivor',
        title: '[BUG] flaky test quarantined: src/other/thing.test.ts',
        createdAt: '2026-08-09T00:00:00.000Z',
      }),
      makeTodo({
        id: 'b-dup1',
        title: '[BUG] flaky test quarantined: src/other/thing.test.ts',
        createdAt: '2026-08-10T00:00:00.000Z',
      }),
    ];

    const updateCalls: Array<{ id: string; patch: UpdateTodoPatch }> = [];

    const result = await collapseQuarantineDuplicates('/tmp/fake-project', {
      listTodos: () => fixture,
      updateTodo: async (project: string, id: string, patch: UpdateTodoPatch) => {
        updateCalls.push({ id, patch });
        const row = fixture.find((t) => t.id === id);
        if (row) Object.assign(row, patch);
        return row as Todo;
      },
    });

    expect(result.groups).toBe(2);
    expect(result.survivors).toBe(2);
    expect(result.closed).toBe(3);

    const open = fixture.filter((t) => t.status !== 'done');
    expect(open.length).toBe(2);
    expect(open.map((t) => t.id).sort()).toEqual(['a-survivor', 'b-survivor']);

    const closedIds = updateCalls.map((c) => c.id).sort();
    expect(closedIds).toEqual(['a-dup1', 'a-dup2', 'b-dup1']);

    for (const call of updateCalls) {
      const survivorId = call.id.startsWith('a-') ? 'a-survivor' : 'b-survivor';
      expect(call.patch.description).toContain(survivorId);
    }
  });
});

describe('double-promotion regression', () => {
  it('runQuarantinePromotionReport called twice for the same file at different progress counters leaves exactly one open todo', async () => {
    const todos: Todo[] = [];
    let idCounter = 0;
    let createTodoCallCount = 0;

    const deps = {
      recordFrictionOnce: async () => true,
      ensureBucket: async () => 'flaky-epic-id',
      listTodos: (_project: string) => todos,
      createTodo: async (_project: string, input: any) => {
        createTodoCallCount += 1;
        idCounter += 1;
        const todo = makeTodo({
          id: `todo-${idCounter}`,
          title: input.title,
          parentId: input.parentId,
          status: 'planned',
          createdAt: new Date(idCounter).toISOString(),
        });
        todos.push(todo);
        return todo;
      },
      updateTodo: async (_project: string, id: string, patch: any) => {
        const row = todos.find((t) => t.id === id);
        if (row) Object.assign(row, patch);
        return row as Todo;
      },
    };

    const candidate1: FlakyCandidate & { project: string } = {
      project: '/tmp/fake-project',
      test: '(444/492) src/services/__tests__/sweep-measurement.test.ts',
      quarantinedAtSha: 'sha1',
      evidence: { runs: 10, passRuns: 6, failRuns: 4 },
      ttlExpiresAt: Date.now() + 86_400_000,
    };
    const candidate2: FlakyCandidate & { project: string } = {
      ...candidate1,
      test: '(463/514) src/services/__tests__/sweep-measurement.test.ts',
      quarantinedAtSha: 'sha2',
    };

    await runQuarantinePromotionReport(candidate1, deps);
    await runQuarantinePromotionReport(candidate2, deps);

    expect(createTodoCallCount).toBe(1);
    const open = todos.filter((t) => t.status !== 'done' && t.status !== 'dropped');
    expect(
      open.filter((t) => t.title.startsWith('[BUG] flaky test quarantined: ')).length,
    ).toBe(1);
  });
});
