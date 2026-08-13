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
import {
  noteExecutorAbort,
  resetZeroNodeClaimLostStreak,
  _resetZeroNodeClaimLostState,
  ZERO_NODE_CLAIM_LOST_CARD_AT,
} from '../coordinator-live';
import type { RecordFrictionInput } from '../friction-store';

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

describe('zero-node claim-lost visibility', () => {
  beforeEach(() => {
    _resetZeroNodeClaimLostState();
  });

  test('zero-node claim-lost abort emits a zero-node-claim-lost audit', async () => {
    const audits: Record<string, unknown>[] = [];
    const frictions: RecordFrictionInput[] = [];
    const escalations: Record<string, unknown>[] = [];

    const sinks = {
      audit: (detail: Record<string, unknown>) => {
        audits.push(detail);
      },
      friction: async (project: string, args: RecordFrictionInput) => {
        frictions.push(args);
      },
      escalate: async (args: Record<string, unknown>) => {
        escalations.push(args);
      },
    };

    const result = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId: 'todoabc12345678',
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch1234567890',
      liveClaimToken: 'live1234567890ab',
      sinks,
    });

    expect(result.source).toBe('zero-node-claim-lost');
    expect(result.streak).toBe(1);
    expect(result.escalated).toBe(false);
    expect(audits.length).toBe(1);
    expect(audits[0].source).toBe('zero-node-claim-lost');
    expect(audits[0].todoId).toBe('todoabc12345678');
    expect(audits[0].reason).toBe('claim-lost');
    expect(audits[0].launchToken).toBe('launch12');
    expect(audits[0].liveClaimToken).toBe('live1234');
    expect(audits[0].streak).toBe(1);
  });

  test('claim-lost abort with nodesSpent > 0 stays an executor-aborted audit', async () => {
    const audits: Record<string, unknown>[] = [];
    const frictions: RecordFrictionInput[] = [];
    const escalations: Record<string, unknown>[] = [];

    const sinks = {
      audit: (detail: Record<string, unknown>) => {
        audits.push(detail);
      },
      friction: async (project: string, args: RecordFrictionInput) => {
        frictions.push(args);
      },
      escalate: async (args: Record<string, unknown>) => {
        escalations.push(args);
      },
    };

    const result = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId: 'todoabc12345678',
      reason: 'claim-lost',
      nodesSpent: 2,
      launchToken: 'launch1234567890',
      liveClaimToken: 'live1234567890ab',
      sinks,
    });

    expect(result.source).toBe('executor-aborted');
    expect(result.streak).toBe(0);
    expect(result.escalated).toBe(false);
    expect(audits.length).toBe(1);
    expect(audits[0].source).toBe('executor-aborted');
    expect(frictions.length).toBe(0);
    expect(escalations.length).toBe(0);
  });

  test('friction fires exactly once at the 3rd consecutive zero-node claim-lost abort', async () => {
    const audits: Record<string, unknown>[] = [];
    const frictions: RecordFrictionInput[] = [];
    const escalations: Record<string, unknown>[] = [];

    const sinks = {
      audit: (detail: Record<string, unknown>) => {
        audits.push(detail);
      },
      friction: async (project: string, args: RecordFrictionInput) => {
        frictions.push(args);
      },
      escalate: async (args: Record<string, unknown>) => {
        escalations.push(args);
      },
    };

    const todoId = 'todoabc12345678';

    // First abort
    const r1 = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch1',
      liveClaimToken: 'live1',
      sinks,
    });
    expect(r1.streak).toBe(1);
    expect(r1.escalated).toBe(false);
    expect(frictions.length).toBe(0);
    expect(escalations.length).toBe(0);

    // Second abort
    const r2 = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch2',
      liveClaimToken: 'live2',
      sinks,
    });
    expect(r2.streak).toBe(2);
    expect(r2.escalated).toBe(false);
    expect(frictions.length).toBe(0);
    expect(escalations.length).toBe(0);

    // Third abort — card raised
    const r3 = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch3',
      liveClaimToken: 'live3',
      sinks,
    });
    expect(r3.streak).toBe(3);
    expect(r3.escalated).toBe(true);
    expect(frictions.length).toBe(1);
    expect(escalations.length).toBe(1);

    // Fourth abort — no new card
    const r4 = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch4',
      liveClaimToken: 'live4',
      sinks,
    });
    expect(r4.streak).toBe(4);
    expect(r4.escalated).toBe(false);
    expect(frictions.length).toBe(1);
    expect(escalations.length).toBe(1);
  });

  test('a dispatch that spends a node resets the consecutive streak', async () => {
    const audits: Record<string, unknown>[] = [];
    const frictions: RecordFrictionInput[] = [];
    const escalations: Record<string, unknown>[] = [];

    const sinks = {
      audit: (detail: Record<string, unknown>) => {
        audits.push(detail);
      },
      friction: async (project: string, args: RecordFrictionInput) => {
        frictions.push(args);
      },
      escalate: async (args: Record<string, unknown>) => {
        escalations.push(args);
      },
    };

    const todoId = 'todoabc12345678';

    // Two zero-node aborts
    await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch1',
      liveClaimToken: 'live1',
      sinks,
    });
    await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch2',
      liveClaimToken: 'live2',
      sinks,
    });

    // Reset the streak with a node-spending dispatch
    resetZeroNodeClaimLostStreak(todoId, 1);

    // Two more zero-node aborts, should restart at 1 and not escalate yet
    const r3 = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch3',
      liveClaimToken: 'live3',
      sinks,
    });
    expect(r3.streak).toBe(1);
    expect(r3.escalated).toBe(false);
    expect(frictions.length).toBe(0);
    expect(escalations.length).toBe(0);

    const r4 = await noteExecutorAbort({
      project: '/proj/A',
      session: 'session-1',
      todoId,
      reason: 'claim-lost',
      nodesSpent: 0,
      launchToken: 'launch4',
      liveClaimToken: 'live4',
      sinks,
    });
    expect(r4.streak).toBe(2);
    expect(r4.escalated).toBe(false);
    expect(frictions.length).toBe(0);
    expect(escalations.length).toBe(0);
  });
});
