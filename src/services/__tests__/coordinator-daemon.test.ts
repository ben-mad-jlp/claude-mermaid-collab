import { test, expect, describe } from 'bun:test';
import type { Todo } from '../todo-store';
import {
  runTick,
  handleWorkerComplete,
  COORDINATOR_ID,
  DEFAULT_LEASE_MS,
  byClaimPriority,
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

describe('byClaimPriority (priority-ordered claiming)', () => {
  test('sorts by priority ASC (0 first), null last, ord as tiebreak', () => {
    const todos = [
      makeTodo('c', { priority: null, order: 1 }),
      makeTodo('a', { priority: 0, order: 9 }),
      makeTodo('b', { priority: 2, order: 2 }),
      makeTodo('d', { priority: null, order: 0 }),
    ];
    expect([...todos].sort(byClaimPriority).map((t) => t.id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('runTick — priority-ordered claiming', () => {
  test('claims the eligible set in priority order, not creation order', async () => {
    // ord says [low, high, mid]; priority should reorder to [high(0), mid(1), low(3)].
    const todos = [
      makeTodo('low', { priority: 3, order: 0 }),
      makeTodo('high', { priority: 0, order: 1 }),
      makeTodo('mid', { priority: 1, order: 2 }),
    ];
    const deps = makeDeps({ listReadyTodos: () => todos });
    const res = await runTick(deps, 'proj');
    expect(res.claimed).toEqual(['high', 'mid', 'low']);
  });
});

describe('runTick', () => {
  test('notifyTodosChanged fires when the daemon changes a todo status (exhausted→blocked)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      releaseExpiredClaims: async () => ({ released: [], exhausted: ['dead'] }),
      escalateExhausted: async () => {},
      notifyTodosChanged: (p) => calls.push(p),
    });
    await runTick(deps, 'proj');
    expect(calls).toEqual(['proj']); // the stale-Bridge-card fix: server-side block now pushes
  });

  test('notifyTodosChanged does NOT fire when nothing changed (no churn → no broadcast)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      releaseExpiredClaims: async () => ({ released: [], exhausted: [] }),
      notifyTodosChanged: (p) => calls.push(p),
    });
    await runTick(deps, 'proj');
    expect(calls).toEqual([]);
  });

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

  test('P4 claimGuard filters the ready set: a probe-failing todo is NOT claimed (no status write); claimable next tick when it passes', async () => {
    const probeUp = makeTodo('up', { claimProbe: 'tcp://h:1' });
    const probeDown = makeTodo('down', { claimProbe: 'tcp://h:2' });
    let serviceUp = false;
    const deps = makeDeps({
      listReadyTodos: () => [probeUp, probeDown],
      // Pure filter: drop the down-probe todo; never mutate status.
      claimGuard: async (_p, todos) => todos.filter((t) => t.id === 'up' ? true : serviceUp),
    });
    const first = await runTick(deps, 'proj');
    expect(first.claimed).toEqual(['up']);        // probeDown filtered out
    expect(deps._claimCalls.map((c) => c[1])).toEqual(['up']); // claimTodo never called for 'down'
    // Service comes up → next tick the same todo is claimable, no reset/status write.
    serviceUp = true;
    const second = await runTick(deps, 'proj');
    expect(second.claimed).toContain('down');
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

  test('concurrent dispatch: runs up to maxConcurrency leaves at once', async () => {
    const todos = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => makeTodo(id));
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = makeDeps({
      listReadyTodos: () => todos,
      maxConcurrency: () => 3,
      launchWorker: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return true;
      },
    });
    const result = await runTick(deps, 'proj');
    expect(maxInFlight).toBe(3); // bounded by the pool size
    expect(result.spawned.length).toBe(6); // all eventually dispatched
    expect(deps._launchCalls.length).toBe(6);
  });

  test('default (no maxConcurrency) dispatches serially — at most 1 in flight', async () => {
    const todos = ['a', 'b', 'c'].map((id) => makeTodo(id));
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = makeDeps({
      listReadyTodos: () => todos,
      // no maxConcurrency → defaults to 1 (prior serial behaviour)
      launchWorker: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return true;
      },
    });
    const result = await runTick(deps, 'proj');
    expect(maxInFlight).toBe(1);
    expect(result.spawned.length).toBe(3);
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

  test('reapDeadWorkers merges into released/exhausted and escalates dead-exhausted', async () => {
    const escalated: string[] = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      releaseExpiredClaims: async () => ({ released: ['lease-x'], exhausted: [] }),
      reapDeadWorkers: async () => ({ reclaimed: ['dead-ready'], exhausted: ['dead-blocked'] }),
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

  test('enforceBudgetCaps (P1 governance breaker) is invoked each tick', async () => {
    const capCalls: string[] = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      enforceBudgetCaps: async (project) => { capCalls.push(project); return ['parked-x']; },
    });
    await runTick(deps, 'proj');
    expect(capCalls).toEqual(['proj']);
  });

  test('enforceBudgetCaps throwing does NOT abort the tick (ready todos still processed)', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [makeTodo('a')],
      enforceBudgetCaps: async () => { throw new Error('breaker blew up'); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.claimed).toEqual(['a']);
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

describe('runTick — swallowed reaper errors are recorded, not silent', () => {
  test('a clean tick reports an empty tickErrors', async () => {
    const deps = makeDeps({ listReadyTodos: () => [] });
    const result = await runTick(deps, 'proj');
    expect(result.tickErrors).toEqual([]);
  });

  test('a thrown reaper step is captured in tickErrors with its step name + message', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [],
      enforceBudgetCaps: async () => { throw new Error('breaker blew up'); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.tickErrors).toEqual([{ step: 'enforceBudgetCaps', error: 'breaker blew up' }]);
  });

  test('onTickError is invoked once per swallowed error, with project + step + the error', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const deps = makeDeps({
      listReadyTodos: () => [],
      detectStalls: async () => { throw new Error('capture-pane blew up'); },
      onTickError: (project, step, err) => { calls.push([project, step, err]); },
    });
    await runTick(deps, 'proj');
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('proj');
    expect(calls[0][1]).toBe('detectStalls');
    expect((calls[0][2] as Error).message).toBe('capture-pane blew up');
  });

  test('multiple swallowed reaper errors in one tick are all captured, in order', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [],
      reapDeadWorkers: async () => { throw new Error('reap-dead blew up'); },
      detectStalls: async () => { throw new Error('stall-detect blew up'); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.tickErrors).toEqual([
      { step: 'reapDeadWorkers', error: 'reap-dead blew up' },
      { step: 'detectStalls', error: 'stall-detect blew up' },
    ]);
  });

  test('a per-todo claim-dispatch error is captured with the todo id (legacy path)', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [makeTodo('bad-todo')],
      claimTodo: async () => { throw new Error('claim blew up'); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.tickErrors).toEqual([{ step: 'claim-dispatch:bad-todo', error: 'claim blew up' }]);
  });

  test('onTickError itself throwing does not abort the tick or the error recording', async () => {
    const deps = makeDeps({
      listReadyTodos: () => [makeTodo('a')],
      enforceBudgetCaps: async () => { throw new Error('breaker blew up'); },
      onTickError: () => { throw new Error('hook blew up too'); },
    });
    const result = await runTick(deps, 'proj');
    expect(result.tickErrors).toEqual([{ step: 'enforceBudgetCaps', error: 'breaker blew up' }]);
    expect(result.claimed).toEqual(['a']);
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

describe('handleWorkerComplete — authoritative gate (5374e299)', () => {
  test('accepted + gate FAILS → overridden to rejected + escalated; completeTodo gets rejected', async () => {
    const escalated: string[] = [];
    const deps = makeDeps({
      completeTodo: async (_p, _id, _a) => ({ completed: makeTodo('g1'), promoted: [] }),
      escalateRejected: async (_p, id) => { escalated.push(id); },
      runGate: async () => ({ passed: false, reasons: ['fitness too low'] }),
    });
    const r = await handleWorkerComplete(deps, 'proj', 'g1', 'accepted');
    expect(deps._completeCalls[0]).toEqual(['proj', 'g1', 'rejected']); // worker's 'accepted' was overridden
    expect(r.escalated).toBe(true);
    expect(escalated).toEqual(['g1']);
    expect(r.gateOverride?.reasons).toEqual(['fitness too low']);
  });

  test('accepted + gate PASSES → stays accepted (no escalation)', async () => {
    const deps = makeDeps({
      completeTodo: async (_p, _id, _a) => ({ completed: makeTodo('g2'), promoted: ['dep'] }),
      runGate: async () => ({ passed: true, reasons: [] }),
    });
    const r = await handleWorkerComplete(deps, 'proj', 'g2', 'accepted');
    expect(deps._completeCalls[0]).toEqual(['proj', 'g2', 'accepted']);
    expect(r.escalated).toBe(false);
    expect(r.gateOverride).toBeUndefined();
  });

  test('accepted + NO gate declared (null) → honors worker (backward compat)', async () => {
    const deps = makeDeps({
      completeTodo: async (_p, _id, _a) => ({ completed: makeTodo('g3'), promoted: [] }),
      runGate: async () => null,
    });
    await handleWorkerComplete(deps, 'proj', 'g3', 'accepted');
    expect(deps._completeCalls[0]).toEqual(['proj', 'g3', 'accepted']);
  });

  test('accepted + gate THROWS → fail CLOSED (rejected), never auto-accepts', async () => {
    const deps = makeDeps({
      completeTodo: async (_p, _id, _a) => ({ completed: makeTodo('g4'), promoted: [] }),
      runGate: async () => { throw new Error('boom'); },
    });
    const r = await handleWorkerComplete(deps, 'proj', 'g4', 'accepted');
    expect(deps._completeCalls[0]).toEqual(['proj', 'g4', 'rejected']);
    expect(r.gateOverride?.passed).toBe(false);
  });

  test('worker REJECTED → gate is not consulted (already rejected)', async () => {
    let gateCalls = 0;
    const deps = makeDeps({
      completeTodo: async (_p, _id, _a) => ({ completed: makeTodo('g5'), promoted: [] }),
      runGate: async () => { gateCalls++; return { passed: true, reasons: [] }; },
    });
    await handleWorkerComplete(deps, 'proj', 'g5', 'rejected');
    expect(deps._completeCalls[0]).toEqual(['proj', 'g5', 'rejected']);
    expect(gateCalls).toBe(0);
  });
});
