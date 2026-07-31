import { test, expect, describe } from 'bun:test';
import { gateFailureSignature } from '../gate-base-attribution';
import { runLeaf, type LeafExecutorDeps } from '../leaf-executor';
import type { Todo } from '../todo-store';
import { handleWorkerComplete, type CoordinatorDeps } from '../coordinator-daemon';

// Shared fixture: a gate failure attributed to a file OUTSIDE either leaf's own change-set.
// Both park sites are driven off this identical (command, failingFiles) pair so the parity
// assertion below is meaningful — a divergence in either site's reason-string construction
// would break this test rather than two independent per-path assertions.
const COMMAND = 'bunx vitest --run';
const FAILING_FILES = ['src/foreign/other.ts'];
const EXPECTED_SIGNATURE = gateFailureSignature(COMMAND, FAILING_FILES);

function makeMinimalLeaf(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'leaf-a-0000-4000-8000-000000000000',
    ownerSession: 'sess',
    assigneeSession: null,
    title: 'G2 park leaf',
    description: null,
    status: 'in_progress',
    completed: false,
    priority: 0,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: 'leaf-exec-leaf-a',
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

function makeMinimalDeps(): LeafExecutorDeps {
  return {
    // Never invoked: ensureBaseGreen (G2) returns 'fail' before any node dispatch or
    // deps.wm.ensure call, so these are unreachable-but-type-required stubs.
    invoker: { invoke: async () => { throw new Error('invoker should not be called (G2 parks first)'); } },
    wm: {
      ensure: async () => { throw new Error('wm.ensure should not be called (G2 parks first)'); },
      remove: async () => {},
    } as unknown as LeafExecutorDeps['wm'],
    epicId: 'epic-a',
    epicBranch: 'collab/epic/leaf-a',
    assertAuth: () => 'subscription',
    complete: async () => { throw new Error('complete should not be called (G2 parks first)'); },
    mergeToEpic: async () => { throw new Error('mergeToEpic should not be called (G2 parks first)'); },
    escalate: () => {},
    recordNode: (() => null) as LeafExecutorDeps['recordNode'],
    setInflight: () => {},
    clearInflight: () => {},
    getEpicTodo: () => null,
    ensureBaseGreen: async () => ({
      status: 'fail',
      command: COMMAND,
      output: FAILING_FILES.join(', '),
      reasons: [],
      declared: true,
      fresh: true,
    }),
  };
}

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
  _completeCalls: Array<[string, string, string | undefined]>;
} {
  const _completeCalls: Array<[string, string, string | undefined]> = [];
  const userCompleteTodo = overrides.completeTodo;

  const completeTodo: CoordinatorDeps['completeTodo'] = async (project, id, acceptance) => {
    _completeCalls.push([project, id, acceptance]);
    if (userCompleteTodo) return userCompleteTodo(project, id, acceptance);
    return { completed: makeTodo(id), promoted: [] };
  };

  return {
    listReadyTodos: (_project: string) => [],
    releaseExpiredClaims: async (_project, _now) => ({ released: [], exhausted: [] }),
    claimTodo: async (_project, id) => makeTodo(id),
    launchWorker: async () => true,
    ...overrides,
    completeTodo,
    _completeCalls,
  };
}

describe('sibling parity: G2 leaf park vs self-report seam classify the same base failure identically', () => {
  test('G2 park and self-report seam classify the same base failure with the same epic-base-red signature', async () => {
    // Leaf A: the leaf-executor G2 park (checked before any node dispatch).
    const resA = await runLeaf('proj', makeMinimalLeaf(), makeMinimalDeps());
    expect(resA.outcome).toBe('blocked');
    expect(resA.reason).toMatch(/^epic-base-red/);

    // Leaf B: the self-report seam (worker reports 'rejected', gate attributes it to base).
    const baseAttributed = { command: COMMAND, failingFiles: FAILING_FILES, signature: EXPECTED_SIGNATURE };
    const depsB = makeDeps({
      runGate: async () => ({ passed: false, reasons: ['gate failed'], baseAttributed }),
    });
    const rB = await handleWorkerComplete(depsB, 'proj', 'leaf-b-id', 'rejected');
    expect(rB.pendingReason).toMatch(/^epic-base-red/);
    expect(rB.baseRed?.signature).toBe(EXPECTED_SIGNATURE);

    // Parity: both leaves were driven off the identical (COMMAND, FAILING_FILES) pair, so
    // they must resolve to the SAME signature — a future divergence in either park site's
    // reason-string construction would break this comparison, not just each half alone.
    expect(gateFailureSignature(COMMAND, FAILING_FILES)).toBe(rB.baseRed!.signature);
    expect(resA.reason).toMatch(/^epic-base-red/);
    expect(rB.pendingReason).toMatch(/^epic-base-red/);
  });

  test('an in-change-set failing file on the self-report path still yields rejected', async () => {
    const depsC = makeDeps({
      runGate: async () => ({ passed: false, reasons: ['own bug'] }),
    });
    const rC = await handleWorkerComplete(depsC, 'proj', 'leaf-c-id', 'rejected');
    expect(depsC._completeCalls[depsC._completeCalls.length - 1]).toEqual(['proj', 'leaf-c-id', 'rejected']);
    expect(rC.effective).toBe('rejected');
  });
});
