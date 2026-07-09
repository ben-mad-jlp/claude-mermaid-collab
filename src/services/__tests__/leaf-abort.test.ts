/**
 * Unit tests for the cooperative abort predicate (kill-the-running-build epic).
 *
 * `abortReasonFor` is pure (no db/git). The `runLeaf` integration test mocks every
 * effectful dep exactly like leaf-executor.test.ts — no live `claude` node, no real
 * worktree/git.
 */
import { describe, it, expect } from 'bun:test';
import { abortReasonFor } from '../leaf-abort';
import { runLeaf, type LeafExecutorDeps } from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/abcd1234';
const EPIC_ID = 'epic-abcd1234';

function makeLeaf(over: Partial<Todo> = {}): Todo {
  return {
    id: '5c58cf82-87bf-49c4-b01a-bee5fc66502d',
    ownerSession: 'sess',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 'P2 minimal leaf',
    description: 'do the thing',
    status: 'in_progress',
    completed: false,
    priority: 2,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: 'leaf-exec-5c58cf82',
    executedBySession: 'leaf-exec-5c58cf82',
    blueprintId: null,
    type: null,
    kind: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    ...over,
  };
}

function okResult(text: string): NodeResult {
  return { ok: true, exitCode: 0, stdout: text, durationMs: 1, rateLimited: false, authMode: 'subscription', text };
}

describe('abortReasonFor (pure decision)', () => {
  it('missing todo → gone', () => {
    expect(abortReasonFor({ todo: null, launchToken: 'tok' })).toBe('gone');
    expect(abortReasonFor({ todo: undefined, launchToken: null })).toBe('gone');
  });
  it('dropped → dropped (even with a matching token)', () => {
    expect(abortReasonFor({ todo: { status: 'dropped', heldAt: null, claimToken: 'tok' }, launchToken: 'tok' })).toBe('dropped');
  });
  it('heldAt set → held', () => {
    expect(abortReasonFor({ todo: { status: 'in_progress', heldAt: '2026-01-01', claimToken: 'tok' }, launchToken: 'tok' })).toBe('held');
  });
  it('token mismatch → claim-lost', () => {
    expect(abortReasonFor({ todo: { status: 'in_progress', heldAt: null, claimToken: 'other' }, launchToken: 'tok' })).toBe('claim-lost');
  });
  it('token match + planned/in_progress → null', () => {
    expect(abortReasonFor({ todo: { status: 'in_progress', heldAt: null, claimToken: 'tok' }, launchToken: 'tok' })).toBe(null);
    expect(abortReasonFor({ todo: { status: 'planned', heldAt: null, claimToken: 'tok' }, launchToken: 'tok' })).toBe(null);
  });
  it('launchToken null never yields claim-lost (tests/legacy dispatch opt out)', () => {
    expect(abortReasonFor({ todo: { status: 'in_progress', heldAt: null, claimToken: 'anything' }, launchToken: null })).toBe(null);
  });
});

describe('runLeaf — cooperative abort at a node boundary', () => {
  it('shouldAbort firing after the blueprint node stops the run: aborted outcome, worktree reaped, resume cleared, no completion/merge/escalation, no further nodes spent', async () => {
    let shouldAbortCalls = 0;
    const removeCalls: string[] = [];
    const clearResumeCalls: string[] = [];
    let completeCalls = 0;
    let mergeCalls = 0;
    let escalateCalls = 0;
    let invokeCalls = 0;

    const deps: LeafExecutorDeps = {
      invoker: {
        async invoke(_spec: NodeSpec): Promise<NodeResult> {
          invokeCalls += 1;
          return okResult('blueprint text\n```json\n{"schemaVersion":1,"estimatedFiles":1,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":[],"tasks":[]}\n```');
        },
      },
      wm: {
        async ensure(_sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
          return { isGit: true, path: '/tmp/wt/1', branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
        },
        async remove(sessionKey: string) {
          removeCalls.push(sessionKey);
        },
      } as never,
      epicId: EPIC_ID,
      epicBranch: EPIC_BRANCH,
      assertAuth: () => 'subscription',
      async complete(_p, _t, acceptance) {
        completeCalls += 1;
        return { effective: acceptance };
      },
      async mergeToEpic() {
        mergeCalls += 1;
        return {};
      },
      escalate() {
        escalateCalls += 1;
      },
      recordNode: () => null,
      // First call (pre-spawn of the blueprint node) → null (proceed). Second call
      // (post-invoke, right after the blueprint node returns) → 'dropped' (an ancestor
      // drop cascade landed while the node was running) — stop BEFORE implement spawns.
      shouldAbort: () => {
        shouldAbortCalls += 1;
        return shouldAbortCalls >= 2 ? 'dropped' : null;
      },
      clearResume: (leafId: string) => {
        clearResumeCalls.push(leafId);
      },
    };

    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);

    expect(res.outcome).toBe('aborted');
    expect(res.reason).toBe('dropped');
    expect(invokeCalls).toBe(1); // only the blueprint node ran — implement never spawned
    expect(res.nodesSpent).toBe(1); // budget stopped advancing
    expect(removeCalls).toEqual(['leaf-exec-5c58cf82']);
    expect(clearResumeCalls).toEqual([leaf.id]);
    expect(completeCalls).toBe(0);
    expect(mergeCalls).toBe(0);
    expect(escalateCalls).toBe(0);
  });
});
