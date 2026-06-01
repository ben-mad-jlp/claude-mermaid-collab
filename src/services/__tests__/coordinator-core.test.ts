import { test, expect, describe } from 'bun:test';
import { planCoordinatorTick } from '../coordinator-core';
import type { Todo } from '../todo-store';

function makeTodo(overrides: Partial<Todo> & { id: string; status: Todo['status'] }): Todo {
  return {
    ownerSession: 'session-1',
    assigneeSession: null,
    title: 'test todo',
    description: null,
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    blueprintId: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    retryCount: 0,
    ...overrides,
  } as Todo;
}

const NOW = '2024-06-01T12:00:00.000Z';

describe('planCoordinatorTick', () => {
  test('empty array returns empty plan', () => {
    expect(planCoordinatorTick([], NOW)).toEqual({ toClaim: [], toRelease: [] });
  });

  test('ready todo with no deps → in toClaim', () => {
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: [] });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toClaim).toContain('a');
    expect(plan.toRelease).toHaveLength(0);
  });

  test('ready todo with all deps done → in toClaim', () => {
    const dep = makeTodo({ id: 'dep1', status: 'done' });
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: ['dep1'] });
    const plan = planCoordinatorTick([dep, todo], NOW);
    expect(plan.toClaim).toContain('a');
  });

  test('ready todo with a pending (non-done) dep → NOT in toClaim', () => {
    const dep = makeTodo({ id: 'dep1', status: 'in_progress' });
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: ['dep1'] });
    const plan = planCoordinatorTick([dep, todo], NOW);
    expect(plan.toClaim).not.toContain('a');
  });

  test('ready todo with an unknown dep id → in toClaim (unknown ignored)', () => {
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: ['nonexistent'] });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toClaim).toContain('a');
  });

  test('in_progress with expired lease → in toRelease', () => {
    const claimedAt = '2024-06-01T11:00:00.000Z'; // 1 hour ago
    const claimLeaseMs = 30 * 60 * 1000; // 30 min lease
    const todo = makeTodo({ id: 'b', status: 'in_progress', claimedAt, claimLeaseMs });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toRelease).toContain('b');
    expect(plan.toClaim).not.toContain('b');
  });

  test('in_progress with unexpired lease → NOT in toRelease', () => {
    const claimedAt = '2024-06-01T11:45:00.000Z'; // 15 min ago
    const claimLeaseMs = 30 * 60 * 1000; // 30 min lease
    const todo = makeTodo({ id: 'b', status: 'in_progress', claimedAt, claimLeaseMs });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toRelease).not.toContain('b');
  });

  test('in_progress with null claimLeaseMs → NOT in toRelease', () => {
    const todo = makeTodo({ id: 'b', status: 'in_progress', claimedAt: '2024-01-01T00:00:00.000Z', claimLeaseMs: null });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toRelease).not.toContain('b');
  });
});
