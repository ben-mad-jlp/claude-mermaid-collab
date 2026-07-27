import { describe, it, expect } from 'bun:test';
import { runReviewPipeline, runVerifyPipeline } from '../leaf-executor';
import type { LeafRunContext, LeafNodeKind, LeafExecutorDeps } from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

describe('LeafRunContext — mutation visibility', () => {
  it('budgetState mutations inside runReviewPipeline are visible via checkBudget after the call', async () => {
    const state = { attempt: 0, nodesSpent: 0, pathTaken: null as 'floor' | 'waves' | 'review' | null };
    const budgetState = { value: 100, raises: 0 };
    const checkBudget = () => state.nodesSpent <= budgetState.value;

    // Track whether runNode was called and mutated budgetState
    let nodeWasCalled = false;
    const runNode = async (kind: LeafNodeKind, spec: NodeSpec): Promise<NodeResult> => {
      nodeWasCalled = true;
      // Mutate budgetState from inside the pipeline call
      budgetState.value = 200;
      return {
        ok: true,
        exitCode: 0,
        stdout: 'VERDICT: pass',
        durationMs: 100,
        rateLimited: false,
        authMode: 'subscription',
        text: 'VERDICT: pass',
      };
    };

    const escalatedKinds = new Set<LeafNodeKind>();

    const fakeTodo = {
      id: 'test-leaf-1',
      title: 'Test Leaf',
      parentId: null,
    } as any as Todo;

    const fakeDeps: Partial<LeafExecutorDeps> = {
      wm: { ensure: async () => ({ path: '/fake/path' }) } as any,
      collectDiffRisk: async () => ({ files: [], addedLines: 0, deletedLines: 0 }),
      writeArtifact: async () => {},
      recordNode: () => null,
    };

    const ctx: LeafRunContext = {
      project: 'test-project',
      leaf: fakeTodo,
      deps: fakeDeps as LeafExecutorDeps,
      epicId: 'epic-1',
      epicBranch: 'refs/heads/epic-1',
      sessionKey: 'session-1',
      state,
      budgetState,
      escalatedKinds,
      checkBudget,
      runNode,
      parkBlocked: async () => ({ outcome: 'blocked', attempts: 1, nodesSpent: 0 }),
      parkNodeStartFailure: async () => ({ outcome: 'blocked', attempts: 1, nodesSpent: 0 }),
      pausedResult: () => ({ outcome: 'paused', attempts: 1, nodesSpent: 0 }),
      pausedForWorktreeAddFault: () => ({ outcome: 'paused', attempts: 1, nodesSpent: 0 }),
      finalizeReportLeaf: async () => ({ outcome: 'accepted', attempts: 1, nodesSpent: 0 }),
      buildVerifySpec: () => ({ prompt: '', model: '', effort: 'medium', allowedTools: '', cwd: '/fake/path' }),
      nodeModel: () => 'claude-opus',
      nodeEffort: () => 'medium',
      untrackedAtStart: [],
    };

    // Before the pipeline call, budget is at 100
    expect(budgetState.value).toBe(100);
    expect(checkBudget()).toBe(true);

    // Call the actual pipeline function
    await runReviewPipeline(ctx);

    // Verify runNode was called from inside the pipeline
    expect(nodeWasCalled).toBe(true);

    // Verify the mutation made inside runNode (and inside the pipeline) is visible afterward
    expect(budgetState.value).toBe(200);
    expect(ctx.budgetState.value).toBe(200);
    expect(checkBudget()).toBe(true); // 0 <= 200 ✓
  });

  it('escalatedKinds mutations inside runVerifyPipeline are visible after the call', async () => {
    const state = { attempt: 0, nodesSpent: 0, pathTaken: null as 'floor' | 'waves' | 'review' | null };
    const budgetState = { value: 100, raises: 0 };
    const escalatedKinds = new Set<LeafNodeKind>();

    // Track whether runNode was called and mutated escalatedKinds
    let nodeWasCalled = false;
    const runNode = async (kind: LeafNodeKind, spec: NodeSpec): Promise<NodeResult> => {
      nodeWasCalled = true;
      // Mutate escalatedKinds from inside the pipeline call
      escalatedKinds.add('implement');
      return {
        ok: true,
        exitCode: 0,
        stdout: 'pass',
        durationMs: 100,
        rateLimited: false,
        authMode: 'subscription',
        text: 'pass',
      };
    };

    const fakeTodo = {
      id: 'test-leaf-2',
      title: 'Test Leaf',
      parentId: null,
    } as any as Todo;

    const fakeDeps: Partial<LeafExecutorDeps> = {
      wm: { ensure: async () => ({ path: '/fake/path' }) } as any,
      readArtifact: async () => '',
      writeArtifact: async () => {},
      recordNode: () => null,
    };

    const ctx: LeafRunContext = {
      project: 'test-project',
      leaf: fakeTodo,
      deps: fakeDeps as LeafExecutorDeps,
      epicId: 'epic-2',
      epicBranch: 'refs/heads/epic-2',
      sessionKey: 'session-2',
      state,
      budgetState,
      escalatedKinds,
      checkBudget: () => true,
      runNode,
      parkBlocked: async () => ({ outcome: 'blocked', attempts: 1, nodesSpent: 0 }),
      parkNodeStartFailure: async () => ({ outcome: 'blocked', attempts: 1, nodesSpent: 0 }),
      pausedResult: () => ({ outcome: 'paused', attempts: 1, nodesSpent: 0 }),
      pausedForWorktreeAddFault: () => ({ outcome: 'paused', attempts: 1, nodesSpent: 0 }),
      finalizeReportLeaf: async () => ({ outcome: 'accepted', attempts: 1, nodesSpent: 0 }),
      buildVerifySpec: () => ({ prompt: '', model: '', effort: 'medium', allowedTools: '', cwd: '/fake/path' }),
      nodeModel: () => 'claude-opus',
      nodeEffort: () => 'medium',
      untrackedAtStart: [],
    };

    // Before the pipeline call, escalatedKinds is empty
    expect(ctx.escalatedKinds.has('implement')).toBe(false);
    expect(ctx.escalatedKinds.size).toBe(0);

    // Call the actual pipeline function
    await runVerifyPipeline(ctx);

    // Verify runNode was called from inside the pipeline
    expect(nodeWasCalled).toBe(true);

    // Verify the mutation made inside runNode (and inside the pipeline) is visible afterward
    expect(escalatedKinds.has('implement')).toBe(true);
    expect(ctx.escalatedKinds.has('implement')).toBe(true);
    expect(ctx.escalatedKinds.size).toBe(1);
  });
});
