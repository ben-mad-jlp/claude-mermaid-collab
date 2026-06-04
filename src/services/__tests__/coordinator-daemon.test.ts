import { test, expect, describe } from 'bun:test';
import type { Todo } from '../todo-store';
import {
  runTick,
  handleWorkerComplete,
  COORDINATOR_ID,
  DEFAULT_LEASE_MS,
  type CoordinatorDeps,
} from '../coordinator-daemon';

function makeTodo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    ownerSession: 'owner',
    assigneeSession: null,
    title: `Todo ${id}`,
    description: null,
    status: 'ready',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

function makeDeps(overrides: Partial<CoordinatorDeps> = {}): CoordinatorDeps & {
  _claimCalls: Array<[string, string, string, number]>;
  _launchCalls: Array<[string, Todo]>;
  _completeCalls: Array<[string, string, string | undefined]>;
} {
  const _claimCalls: Array<[string, string, string, number]> = [];
  const _launchCalls: Array<[string, Todo]> = [];
  const _completeCalls: Array<[string, string, string | undefined]> = [];

  const userClaimTodo = overrides.claimTodo;
  const userLaunchWorker = overrides.launchWorker;
  const userCompleteTodo = overrides.completeTodo;

  const claimTodo: CoordinatorDeps['claimTodo'] = async (project, id, claimedBy, leaseMs) => {
    _claimCalls.push([project, id, claimedBy, leaseMs]);
    if (userClaimTodo) return userClaimTodo(project, id, claimedBy, leaseMs);
    return makeTodo(id);
  };

  const launchWorker: CoordinatorDeps['launchWorker'] = async (project, todo) => {
    _launchCalls.push([project, todo]);
    if (userLaunchWorker) return userLaunchWorker(project, todo);
    return true;
  };

  const completeTodo: CoordinatorDeps['completeTodo'] = async (project, id, acceptance) => {
    _completeCalls.push([project, id, acceptance]);
    if (userCompleteTodo) return userCompleteTodo(project, id, acceptance);
    return { completed: makeTodo(id), promoted: [] };
  };

  return {
    listReadyTodos: (_project: string) => [],
    releaseExpiredClaims: async (_project, _now) => ({ released: [], exhausted: [] }),
    ...overrides,
    claimTodo,
    launchWorker,
    completeTodo,
    _claimCalls,
    _launchCalls,
    _completeCalls,
  };
}

describe('runTick', () => {
  test('two ready todos, both claimed and spawned', async () => {
    const todos = [makeTodo('a'), makeTodo('b')];
    const deps = makeDeps({
      listReadyTodos: () => todos,
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toEqual(['a', 'b']);
    expect(result.spawned).toEqual(['a', 'b']);
    expect(deps._launchCalls).toHaveLength(2);
  });

  test('claimTodo returns null for one (race) → not in claimed/spawned', async () => {
    const todos = [makeTodo('a'), makeTodo('b')];
    const deps = makeDeps({
      listReadyTodos: () => todos,
      claimTodo: async (_project, id, _claimedBy, _leaseMs) => {
        if (id === 'b') return null;
        return makeTodo(id);
      },
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toEqual(['a']);
    expect(result.spawned).toEqual(['a']);
  });

  test('launchWorker returns false → in claimed but NOT spawned', async () => {
    const todos = [makeTodo('a'), makeTodo('b')];
    const deps = makeDeps({
      listReadyTodos: () => todos,
      launchWorker: async (_project, todo) => todo.id !== 'b',
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toEqual(['a', 'b']);
    expect(result.spawned).toEqual(['a']);
    expect(result.spawned).not.toContain('b');
  });

  test('launchWorker throws for one todo → tick still completes, other todos processed', async () => {
    const todos = [makeTodo('a'), makeTodo('b')];
    const deps = makeDeps({
      listReadyTodos: () => todos,
      launchWorker: async (_project, todo) => {
        if (todo.id === 'a') throw new Error('launch error');
        return true;
      },
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toContain('a');
    expect(result.claimed).toContain('b');
    expect(result.spawned).not.toContain('a');
    expect(result.spawned).toContain('b');
  });

  test('releaseExpiredClaims released ["x"] → result.released === ["x"]', async () => {
    const deps = makeDeps({
      releaseExpiredClaims: async () => ({ released: ['x'], exhausted: [] }),
    });
    const result = await runTick(deps, 'proj');
    expect(result.released).toEqual(['x']);
  });

  test('no ready todos → claimed/spawned empty, released surfaced', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [],
      releaseExpiredClaims: async () => ({ released: ['stale'], exhausted: [] }),
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toEqual([]);
    expect(result.spawned).toEqual([]);
    expect(result.released).toEqual(['stale']);
  });

  test('exhausted claims are surfaced and escalated', async () => {
    const escalated: string[] = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      releaseExpiredClaims: async () => ({ released: [], exhausted: ['dead'] }),
      escalateExhausted: async (_p, id) => { escalated.push(id); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.exhausted).toEqual(['dead']);
    expect(escalated).toEqual(['dead']);
  });

  test('reapDeadClaims merges into released/exhausted and escalates dead-exhausted', async () => {
    const escalated: string[] = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      releaseExpiredClaims: async () => ({ released: ['lease-x'], exhausted: [] }),
      reapDeadClaims: async () => ({ reclaimed: ['dead-ready'], exhausted: ['dead-blocked'] }),
      escalateExhausted: async (_p, id) => { escalated.push(id); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.released.sort()).toEqual(['dead-ready', 'lease-x']);
    expect(result.exhausted).toEqual(['dead-blocked']);
    expect(escalated).toEqual(['dead-blocked']);
  });

  test('detectStalls (DOGFOOD #6) is invoked each tick', async () => {
    const stallCalls: string[] = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      detectStalls: async (project) => { stallCalls.push(project); return ['stalled-x']; },
    });
    await runTick(deps, 'proj');
    expect(stallCalls).toEqual(['proj']);
  });

  test('detectStalls throwing does NOT abort the tick (ready todos still processed)', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [makeTodo('a')],
      detectStalls: async () => { throw new Error('capture-pane blew up'); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toEqual(['a']);
    expect(result.spawned).toEqual(['a']);
  });

  test('claimTodo is called with COORDINATOR_ID and leaseMs', async () => {
    const todos = [makeTodo('t1')];
    const deps = makeDeps({ listReadyTodos: () => todos });
    await runTick(deps, 'myproj', undefined, 9999);
    expect(deps._claimCalls[0]).toEqual(['myproj', 't1', COORDINATOR_ID, 9999]);
  });
});

describe('handleWorkerComplete', () => {
  test('calls completeTodo with accepted and returns promoted', async () => {
    const deps = makeDeps({
      completeTodo: async (_project, _id, _acceptance) => ({
        completed: makeTodo('t1'),
        promoted: ['dep1', 'dep2'],
      }),
    });
    const result = await handleWorkerComplete(deps, 'proj', 't1', 'accepted');
    expect(result.promoted).toEqual(['dep1', 'dep2']);
    expect(deps._completeCalls[0]).toEqual(['proj', 't1', 'accepted']);
  });

  test('calls completeTodo with rejected and returns promoted', async () => {
    const deps = makeDeps({
      completeTodo: async (_project, _id, _acceptance) => ({
        completed: makeTodo('t2'),
        promoted: [],
      }),
    });
    const result = await handleWorkerComplete(deps, 'proj', 't2', 'rejected');
    expect(result.promoted).toEqual([]);
    expect(deps._completeCalls[0]).toEqual(['proj', 't2', 'rejected']);
  });

  test('rejected → escalateRejected is called (escalated=true); accepted does NOT escalate', async () => {
    const escalated: string[] = [];
    const deps = makeDeps({
      completeTodo: async (_p, _id, _a) => ({ completed: makeTodo('t3'), promoted: [] }),
      escalateRejected: async (_p, id) => { escalated.push(id); },
    });
    const rej = await handleWorkerComplete(deps, 'proj', 't3', 'rejected');
    expect(rej.escalated).toBe(true);
    expect(escalated).toEqual(['t3']);

    const acc = await handleWorkerComplete(deps, 'proj', 't4', 'accepted');
    expect(acc.escalated).toBe(false);
    expect(escalated).toEqual(['t3']); // unchanged
  });
});
