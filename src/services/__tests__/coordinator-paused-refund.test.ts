import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── mock leaf-executor BEFORE importing coordinator-live ──────────────────────
// runLeaf is a static import in coordinator-live so the mock must be registered
// first. Tests set `leafResult` to control what runLeaf returns.
let leafResult: any = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };
const runLeafCalls: Array<{ project: string; todo: any }> = [];
mock.module('../leaf-executor', () => ({
  runLeaf: async (project: string, todo: any, _deps: any) => {
    runLeafCalls.push({ project, todo });
    return leafResult;
  },
  makeLeafExecutorDeps: async () => ({}),
}));

// ── mock todo-store: track bump/refund and keep a NET retryCount per todo ─────
// The counter mirrors real store semantics (bump +1 / refund -1 floor 0) so the
// repeated-pause test can feed the NET count back into the next dispatch's todo,
// proving the redispatch cap never fires when every dispatch ends in a pause.
const retryCounts = new Map<string, number>();
const bumpCalls: Array<{ id: string; token?: string }> = [];
const refundCalls: Array<{ id: string; token?: string }> = [];
const releaseCalls: Array<{ project: string; id: string }> = [];
const resetTodoCalls: Array<{ id: string; status: string }> = [];
mock.module('../todo-store', () => ({
  listReadyTodos: () => [],
  claimTodo: async () => null,
  releaseExpiredClaims: async () => {},
  completeTodo: async () => ({ completed: { sessionName: 'leaf-test' }, promoted: [], rolledUp: [] }),
  updateTodo: async (_p: string, id: string, patch: any) => ({ id, ...patch }),
  resetTodo: async (_p: string, id: string, status: string) => { resetTodoCalls.push({ id, status }); return { id, status }; },
  getTodo: () => null,
  listTodos: () => [],  // no children → qualifies as headless leaf
  reclaimClaim: async () => 'ready',
  releaseClaim: async (_project: string, id: string) => { releaseCalls.push({ project: _project, id }); },
  reclaimOrphan: async () => null,
  stampEpicLandedAt: async () => {},
  bumpRetryCountIfOwned: async (_p: string, id: string, token?: string) => {
    bumpCalls.push({ id, token });
    retryCounts.set(id, (retryCounts.get(id) ?? 0) + 1);
    return true;
  },
  decrementRetryCountIfOwned: async (_p: string, id: string, token?: string) => {
    refundCalls.push({ id, token });
    retryCounts.set(id, Math.max(0, (retryCounts.get(id) ?? 0) - 1));
    return true;
  },
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
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'mc-paused-refund-sup-'));

import { makeCoordinatorDeps } from '../coordinator-live';
import { resetBreaker } from '../headless-breaker';
import { MAX_REDISPATCH } from '../harness-caps';
import type { Todo } from '../todo-store';
import type { TodoKind } from '../todo-kind';
import type { LeafNodeKind } from '../leaf-executor';
import { mkTodo } from './fixtures/mk-todo';

const TEST_PROJECT = mkdtempSync(join(tmpdir(), 'mc-paused-refund-proj-'));

const CLAIM_TOKEN = 'refund-test-claim-token';
const makeTodo = (over: Partial<Todo> & { kind: TodoKind }): Todo =>
  mkTodo({ id: 'refund-test-todo-01', title: 'Refund leaf', status: 'in_progress', claimToken: CLAIM_TOKEN, ...over });

const pausedPayload = { atNode: 'blueprint' as LeafNodeKind, attempt: 1, nodesSpent: 3, capReset: 0 };
const settle = () => new Promise((r) => setTimeout(r, 0)); // fire-and-track continuation

beforeEach(() => {
  resetBreaker();
  retryCounts.clear();
  bumpCalls.length = 0;
  refundCalls.length = 0;
  releaseCalls.length = 0;
  resetTodoCalls.length = 0;
  createEscalationCalls.length = 0;
  runLeafCalls.length = 0;
  leafResult = { outcome: 'accepted', attempts: 1, nodesSpent: 2 };
});

describe('coordinator paused-outcome retryCount refund (crit-8 cap-neutral pause)', () => {
  it('1: a transient pause refunds the dispatch bump (net retryCount 0), releases the claim, and does not park', async () => {
    leafResult = { outcome: 'paused', paused: pausedPayload, attempts: 1, nodesSpent: 3 };

    const deps = makeCoordinatorDeps();
    const todo = makeTodo({ kind: 'leaf' });
    const result = await deps.launchWorker(TEST_PROJECT, todo);
    await settle();

    expect(result).toBe(true);
    // The dispatch bumped once and the paused path refunded once — cap-neutral.
    expect(bumpCalls.filter((c) => c.id === todo.id).length).toBe(1);
    expect(refundCalls.filter((c) => c.id === todo.id).length).toBe(1);
    expect(retryCounts.get(todo.id)).toBe(0);
    // Ownership-safe: the refund is threaded with THIS dispatch's claim token.
    expect(refundCalls[0].token).toBe(CLAIM_TOKEN);
    // The refund lands BEFORE the claim release (a released row would no-op the
    // guarded decrement in the real store).
    expect(releaseCalls.some((c) => c.id === todo.id)).toBe(true);
    // Not parked: no resetTodo('blocked') hold, no escalation.
    expect(resetTodoCalls.length).toBe(0);
    expect(createEscalationCalls.length).toBe(0);
  });

  it(`2: repeated pauses (> MAX_REDISPATCH=${MAX_REDISPATCH} cycles) never trigger parkRedispatchCap`, async () => {
    leafResult = { outcome: 'paused', paused: pausedPayload, attempts: 1, nodesSpent: 3 };
    const deps = makeCoordinatorDeps();
    const id = 'refund-cycle-todo-1';

    for (let cycle = 0; cycle < MAX_REDISPATCH + 2; cycle++) {
      resetBreaker(); // close the pause window so the next dispatch is admitted
      // Each re-dispatch reads the store's NET retryCount — feed it back in, exactly
      // as a re-claim would.
      const todo = makeTodo({ id, kind: 'leaf', retryCount: retryCounts.get(id) ?? 0 });
      const result = await deps.launchWorker(TEST_PROJECT, todo);
      await settle();
      expect(result).toBe(true); // dispatched — never refused by the cap
    }

    expect(runLeafCalls.length).toBe(MAX_REDISPATCH + 2);
    expect(bumpCalls.length).toBe(MAX_REDISPATCH + 2);
    expect(refundCalls.length).toBe(MAX_REDISPATCH + 2);
    expect(retryCounts.get(id)).toBe(0);
    // parkRedispatchCap never fired: no hold, no re-dispatch-cap escalation.
    expect(resetTodoCalls.length).toBe(0);
    expect(createEscalationCalls.some((c) => String(c.questionText).includes('Re-dispatch cap'))).toBe(false);
  });

  it('3: a genuine (non-paused) outcome still bumps retryCount with NO refund', async () => {
    leafResult = { outcome: 'rejected', attempts: 2, nodesSpent: 6, reason: 'review rejected' };

    const deps = makeCoordinatorDeps();
    const todo = makeTodo({ id: 'refund-genuine-todo-1', kind: 'leaf' });
    const result = await deps.launchWorker(TEST_PROJECT, todo);
    await settle();

    expect(result).toBe(true);
    expect(bumpCalls.filter((c) => c.id === todo.id).length).toBe(1);
    expect(refundCalls.length).toBe(0); // refund is paused-path only
    expect(retryCounts.get(todo.id)).toBe(1); // the dispatch still counts toward the cap
  });

  it('4: the cap still parks a genuinely-looping todo (regression guard on the cap itself)', async () => {
    const deps = makeCoordinatorDeps();
    const todo = makeTodo({ id: 'refund-capped-todo-1', kind: 'leaf', retryCount: MAX_REDISPATCH });
    const result = await deps.launchWorker(TEST_PROJECT, todo);

    expect(result).toBe(false); // refused, not dispatched
    expect(runLeafCalls.length).toBe(0);
    expect(resetTodoCalls.some((c) => c.id === todo.id && c.status === 'blocked')).toBe(true);
    expect(createEscalationCalls.some((c) => c.todoId === todo.id && String(c.questionText).includes('Re-dispatch cap'))).toBe(true);
  });
});
