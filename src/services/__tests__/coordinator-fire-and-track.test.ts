import { test, expect, describe, beforeEach } from 'bun:test';
import type { Todo } from '../todo-store';
import { runTick, type CoordinatorDeps } from '../coordinator-daemon';
import {
  reserveLeafSlot,
  releaseLeafSlot,
  inflightActive,
  maxInflightGlobal,
  maxInflightPerProject,
  _resetLeafSlots,
} from '../inflight-limiter';

// Pin caps so the suite is deterministic regardless of ambient MERMAID_* env.
const GLOBAL_CAP = 4;
const PROJECT_CAP = 2;

beforeEach(() => {
  process.env.MERMAID_MAX_INFLIGHT_GLOBAL = String(GLOBAL_CAP);
  process.env.MERMAID_MAX_INFLIGHT_PROJECT = String(PROJECT_CAP);
  _resetLeafSlots();
});

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

interface Spy { claims: string[]; launches: string[]; }

/** Build deps with the in-flight limiter wired (the fire-and-track path) plus a
 *  configurable launchWorker. `launchFired` = what launchWorker returns (true = the
 *  leaf was fired and owns its slot release; false = it deferred). */
function makeDeps(
  ready: Todo[],
  opts: { launchFired?: boolean; claim?: (id: string) => Todo | null; wireLimiter?: boolean } = {},
): { deps: CoordinatorDeps; spy: Spy } {
  const spy: Spy = { claims: [], launches: [] };
  const wire = opts.wireLimiter ?? true;
  const deps: CoordinatorDeps = {
    listReadyTodos: () => ready,
    releaseExpiredClaims: async () => ({ released: [], exhausted: [] }),
    claimTodo: async (_p, id) => {
      const t = opts.claim ? opts.claim(id) : makeTodo(id);
      if (t) spy.claims.push(id);
      return t;
    },
    launchWorker: async (_p, todo) => {
      spy.launches.push(todo.id);
      return opts.launchFired ?? true;
    },
    completeTodo: async (_p, id) => ({ completed: makeTodo(id), promoted: [] }),
    ...(wire ? { reserveLeafSlot, releaseLeafSlot } : {}),
  };
  return { deps, spy };
}

describe('inflight-limiter', () => {
  test('reserve respects the per-project cap; release frees headroom', () => {
    expect(reserveLeafSlot('A')).toBe(true);
    expect(reserveLeafSlot('A')).toBe(true);
    expect(inflightActive('A')).toBe(PROJECT_CAP);
    expect(reserveLeafSlot('A')).toBe(false); // at per-project cap
    releaseLeafSlot('A');
    expect(reserveLeafSlot('A')).toBe(true); // headroom restored
  });

  test('reserve respects the GLOBAL cap across projects', () => {
    expect(reserveLeafSlot('A')).toBe(true);
    expect(reserveLeafSlot('A')).toBe(true); // A at per-project cap (2)
    expect(reserveLeafSlot('B')).toBe(true);
    expect(reserveLeafSlot('B')).toBe(true); // global now 4
    expect(inflightActive()).toBe(GLOBAL_CAP);
    expect(reserveLeafSlot('C')).toBe(false); // C empty but global is full
  });

  test('release clamps at zero (a stray release cannot inflate headroom)', () => {
    releaseLeafSlot('A');
    releaseLeafSlot('A');
    expect(inflightActive('A')).toBe(0);
    expect(inflightActive()).toBe(0);
  });

  test('caps read from env', () => {
    expect(maxInflightGlobal()).toBe(GLOBAL_CAP);
    expect(maxInflightPerProject()).toBe(PROJECT_CAP);
  });
});

describe('runTick fire-and-track dispatch', () => {
  test('per-project cap bounds launches; remaining stay ready', async () => {
    const ready = ['a', 'b', 'c', 'd', 'e'].map((id) => makeTodo(id));
    const { deps, spy } = makeDeps(ready, { launchFired: true });
    const r = await runTick(deps, '/proj/A');
    expect(spy.launches.length).toBe(PROJECT_CAP); // only 2 launched
    expect(spy.claims.length).toBe(PROJECT_CAP); // stops claiming once caps are full
    expect(r.spawned.length).toBe(PROJECT_CAP);
    expect(inflightActive('/proj/A')).toBe(PROJECT_CAP); // fired leaves still hold their slots
  });

  test('a fired leaf keeps its slot (continuation releases later, not the tick)', async () => {
    const ready = [makeTodo('a')];
    const { deps } = makeDeps(ready, { launchFired: true });
    await runTick(deps, '/proj/A');
    expect(inflightActive('/proj/A')).toBe(1); // tick returned WHILE the leaf is in flight
  });

  test('a NON-fired launch releases the reservation back', async () => {
    const ready = [makeTodo('a'), makeTodo('b')];
    const { deps, spy } = makeDeps(ready, { launchFired: false });
    await runTick(deps, '/proj/A');
    expect(spy.launches.length).toBe(2); // both attempted (each reservation freed after defer)
    expect(inflightActive('/proj/A')).toBe(0); // nothing left reserved
  });

  test('a claim race releases the reservation (no leak, no launch)', async () => {
    const ready = [makeTodo('a')];
    const { deps, spy } = makeDeps(ready, { claim: () => null });
    await runTick(deps, '/proj/A');
    expect(spy.launches.length).toBe(0);
    expect(inflightActive('/proj/A')).toBe(0);
  });

  test('global cap protects OTHER projects from one project hogging the fleet', async () => {
    // Fill the global pool from project A (4 ready, but global cap 4 / per-proj 2 → A gets 2).
    const aReady = ['a1', 'a2', 'a3', 'a4'].map((id) => makeTodo(id));
    const { deps: depsA } = makeDeps(aReady, { launchFired: true });
    await runTick(depsA, '/proj/A');
    expect(inflightActive('/proj/A')).toBe(2);

    // Project B still has its own per-project headroom (global has 2 free).
    const bReady = ['b1', 'b2', 'b3'].map((id) => makeTodo(id));
    const { deps: depsB, spy: spyB } = makeDeps(bReady, { launchFired: true });
    await runTick(depsB, '/proj/B');
    expect(spyB.launches.length).toBe(2); // B gets its 2 (global now full at 4)
    expect(inflightActive()).toBe(GLOBAL_CAP);
  });

  test('legacy path (limiter unwired) launches all ready, unchanged behavior', async () => {
    const ready = ['a', 'b', 'c', 'd', 'e'].map((id) => makeTodo(id));
    const { deps, spy } = makeDeps(ready, { launchFired: true, wireLimiter: false });
    const r = await runTick(deps, '/proj/A');
    expect(spy.launches.length).toBe(5); // no caps → all dispatched
    expect(r.spawned.length).toBe(5);
  });
});
