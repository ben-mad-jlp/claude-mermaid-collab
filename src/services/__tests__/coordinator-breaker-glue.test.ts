import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── mock leaf-executor BEFORE importing coordinator-live ──────────────────────
// runLeaf is a static import in coordinator-live (line 23) so the mock must be
// registered first. Tests set `leafResult` to control what runLeaf returns.
let leafResult: any = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };
const runLeafCalls: Array<{ project: string; todo: any }> = [];
mock.module('../leaf-executor', () => ({
  runLeaf: async (project: string, todo: any, _deps: any) => {
    runLeafCalls.push({ project, todo });
    return leafResult;
  },
  makeLeafExecutorDeps: async () => ({}),
}));

// ── mock todo-store ───────────────────────────────────────────────────────────
const releaseCalls: Array<{ project: string; id: string }> = [];
let completeTodoResult: any = { completed: { sessionName: 'leaf-test' }, promoted: [], rolledUp: [] };
mock.module('../todo-store', () => ({
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => completeTodoResult,
  updateTodo: async (_p: string, id: string, patch: any) => ({ id, ...patch }),
  resetTodo: async (_p: string, id: string, status: string) => ({ id, status }),
  getTodo: () => null,
  listTodos: () => [],  // no children → qualifies as headless leaf
  reclaimClaim: async () => 'ready',
  releaseClaim: async (_project: string, id: string) => { releaseCalls.push({ project: _project, id }); },
  reclaimOrphan: async () => null,
}));

// ── mock supervisor-store (createEscalation lives here) ──────────────────────
const createEscalationCalls: Array<any> = [];
mock.module('../supervisor-store', () => ({
  createEscalation: (opts: any) => { createEscalationCalls.push(opts); },
  resolveEscalationsForTodo: () => {},
  recordSupervisorAudit: () => {},
  addSupervised: () => {},
  addWatchedProject: () => {},
  getEscalation: () => null,
  resolveEscalation: () => {},
  isSupervised: () => false,
  removeSupervised: () => {},
  listSupervised: () => [],
}));

// ── mock claude-launch (no tmux) ──────────────────────────────────────────────
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true, tmux: 'mock-tmux' }),
  runTodoInSession: async () => ({ sent: true }),
}));

// Isolate supervisor DB
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'mc-breaker-glue-sup-'));
// Enable headless leaf executor
process.env.LEAF_EXECUTOR = 'on';

import { makeCoordinatorDeps } from '../coordinator-live';
import {
  resetBreaker,
  tripBreaker,
  breakerOpen,
  breakerOpenUntil,
  enqueuePausedLeaf,
  pausedNodesSpent,
  pausedLeavesFor,
  BASE_BACKOFF_MS,
  MAX_TOTAL_WAIT_MS,
} from '../headless-breaker';
import type { Todo } from '../todo-store';
import type { LeafNodeKind } from '../leaf-executor';

const TEST_PROJECT = mkdtempSync(join(tmpdir(), 'mc-breaker-glue-proj-'));

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'test-todo-id-0001',
    title: 'Test leaf todo',
    status: 'in_progress',
    assigneeKind: 'agent',
    parentId: null,
    ...overrides,
  } as Todo;
}

beforeEach(() => {
  resetBreaker();
  runLeafCalls.length = 0;
  releaseCalls.length = 0;
  createEscalationCalls.length = 0;
  leafResult = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };
  completeTodoResult = { completed: { sessionName: 'leaf-test' }, promoted: [], rolledUp: [] };
});

describe('coordinator breaker glue (Finding 1 + P3 wiring seam)', () => {
  it('1: breaker gate suppresses spawn while window is open', async () => {
    const now = Date.now();
    tripBreaker(undefined, now); // opens the window
    expect(breakerOpen()).toBe(true);

    const deps = makeCoordinatorDeps();
    const todo = makeTodo();
    const result = await deps.launchWorker(TEST_PROJECT, todo);

    expect(result).toBe(false);
    expect(runLeafCalls.length).toBe(0);
    // claim released so todo returns to ready
    expect(releaseCalls.some((c) => c.id === todo.id)).toBe(true);
  });

  it('2: breaker closed → spawn proceeds and returns true for accepted', async () => {
    leafResult = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };
    // breaker is already reset in beforeEach → closed
    expect(breakerOpen()).toBe(false);

    const deps = makeCoordinatorDeps();
    const todo = makeTodo();
    const result = await deps.launchWorker(TEST_PROJECT, todo);

    expect(result).toBe(true);
    expect(runLeafCalls.length).toBe(1);
    expect(runLeafCalls[0].project).toBe(TEST_PROJECT);
  });

  it('3: paused outcome trips the breaker + records the leaf + releases claim', async () => {
    const pausedPayload = { atNode: 'blueprint' as LeafNodeKind, attempt: 1, nodesSpent: 4, capReset: 0 };
    leafResult = { outcome: 'paused', paused: pausedPayload, attempts: 1, nodesSpent: 4 };

    const deps = makeCoordinatorDeps();
    const todo = makeTodo();
    const result = await deps.launchWorker(TEST_PROJECT, todo);

    expect(result).toBe(false);
    expect(breakerOpen()).toBe(true);
    // enqueuePausedLeaf was called via the coordinator — nodesSpent is carried
    expect(pausedNodesSpent(TEST_PROJECT, todo.id)).toBe(4);
    expect(releaseCalls.some((c) => c.id === todo.id)).toBe(true);
  });

  it('4: carried nodesSpent is readable via pausedNodesSpent at dispatch time', async () => {
    // Directly enqueue a paused leaf with a known nodesSpent value
    const pausedPayload = { atNode: 'implement' as LeafNodeKind, attempt: 1, nodesSpent: 7, capReset: 0 };
    enqueuePausedLeaf(TEST_PROJECT, 'other-todo', pausedPayload);

    expect(pausedNodesSpent(TEST_PROJECT, 'other-todo')).toBe(7);
    // makeLeafExecutorDeps is mocked to a no-op so we can't assert deep budget plumbing;
    // the breaker registry correctly carries the value as observed above.
  });

  it('5: accepted outcome resets the backoff streak (Finding 1)', async () => {
    // Build up a streak so the next trip would use multi-minute backoff
    const t0 = Date.now() - 10_000;
    tripBreaker(undefined, t0); // consecutiveTrips = 1
    tripBreaker(undefined, t0); // consecutiveTrips = 2
    tripBreaker(undefined, t0); // consecutiveTrips = 3  → backoff = BASE * 4

    // Now an accepted leaf runs while the breaker is closed (reset breaker to allow spawn)
    resetBreaker(); // clear the hold
    expect(breakerOpen()).toBe(false);
    leafResult = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };

    const deps = makeCoordinatorDeps();
    await deps.launchWorker(TEST_PROJECT, makeTodo());

    // After the accepted run, streak was reset → the next trip should start at BASE
    const t1 = Date.now();
    tripBreaker(undefined, t1);
    // consecutiveTrips was 0 before this trip, so backoff = BASE_BACKOFF_MS * 2^0 = BASE
    const openUntil = breakerOpenUntil();
    expect(openUntil).toBeGreaterThanOrEqual(t1 + BASE_BACKOFF_MS - 5);
    expect(openUntil).toBeLessThanOrEqual(t1 + BASE_BACKOFF_MS + 1000);
  });

  it('6: accepted outcome does NOT clear other paused leaves (resetBreakerStreak, not resetBreaker)', async () => {
    const otherPayload = { atNode: 'review' as LeafNodeKind, attempt: 1, nodesSpent: 3, capReset: 0 };
    enqueuePausedLeaf(TEST_PROJECT, 'other-leaf-id', otherPayload);

    // Drive an accepted run for a DIFFERENT todo
    leafResult = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };
    const deps = makeCoordinatorDeps();
    await deps.launchWorker(TEST_PROJECT, makeTodo({ id: 'different-todo-id' }));

    // The other-leaf-id paused entry must still be in the registry
    expect(pausedNodesSpent(TEST_PROJECT, 'other-leaf-id')).toBe(3);
    expect(pausedLeavesFor(TEST_PROJECT).some((e) => e.todoId === 'other-leaf-id')).toBe(true);
  });

  it('7: 2h exhaustion → escalation filed + leaf removed from registry', async () => {
    const todoId = 'exhausted-todo-id';
    // Enqueue with a firstTrippedAt far in the past so breakerExhausted is true
    const farPast = Date.now() - MAX_TOTAL_WAIT_MS - 5_000;
    const pausedPayload = { atNode: 'implement' as LeafNodeKind, attempt: 1, nodesSpent: 2, capReset: 0 };
    enqueuePausedLeaf(TEST_PROJECT, todoId, pausedPayload, farPast);

    const deps = makeCoordinatorDeps();
    await deps.sweepExhaustedHeadless!(TEST_PROJECT);

    // An escalation should be filed
    expect(createEscalationCalls.length).toBeGreaterThanOrEqual(1);
    const esc = createEscalationCalls.find((c) => c.todoId === todoId);
    expect(esc).toBeDefined();
    expect(esc!.kind).toBe('blocker');

    // The leaf is cleared from the registry after escalation
    expect(pausedLeavesFor(TEST_PROJECT).some((e) => e.todoId === todoId)).toBe(false);
  });
});
