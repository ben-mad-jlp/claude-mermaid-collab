/**
 * runLeaf-level tests for the empty-text grok review transient rule (blueprint 60b6d914):
 * an ok-but-empty grok review is transient (worth re-dispatching), not a real review-vacuous
 * verdict — classifyTransientReviewFailure grows an empty-text arm inside the grok-api/
 * grok-build branch, and the main loop classifies against the ORIGINALLY resolved provider
 * (lastNodeRequestedProvider), not the provider that actually answered after the in-runNode
 * one-hop grok→claude fallback.
 *
 * Mirrors leaf-executor-transient-review-rerun.test.ts harness conventions: isolate
 * MERMAID_SUPERVISOR_DIR BEFORE importing leaf-executor so the real ledger is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'review-vacuous-fallback-'));

import {
  runLeaf,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/abcd1234';
const EPIC_ID = 'epic-abcd1234';

const EMPTY_RESULT: NodeResult = {
  ok: true,
  exitCode: 0,
  text: '',
  stdout: '',
  durationMs: 1,
  rateLimited: false,
  authMode: 'grok',
};

const FAIL_RESULT: NodeResult = {
  ok: true,
  exitCode: 0,
  text: 'VERDICT: FAIL — nope',
  stdout: 'VERDICT: FAIL — nope',
  durationMs: 1,
  rateLimited: false,
  authMode: 'subscription',
};

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
    servesCriterionId: null, servesCriterionIds: [],
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
    declaredFiles: [],
    isBucket: false,
    nickname: 'nick',
    ...over,
  };
}

function okResult(text: string): NodeResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: text,
    durationMs: 1,
    rateLimited: false,
    authMode: 'subscription',
    text,
  };
}

const isReviewSpec = (spec: NodeSpec): boolean =>
  (spec.allowedTools ?? '').startsWith('Read Grep Glob Bash');

const isBlueprintSpec = (spec: NodeSpec): boolean =>
  (spec.allowedTools ?? '').includes('Write') && !(spec.allowedTools ?? '').includes('Edit');

const isImplementSpec = (spec: NodeSpec): boolean =>
  !isReviewSpec(spec) && !isBlueprintSpec(spec);

interface FallbackSpies {
  xaiSpecs: NodeSpec[];
  claudeSpecs: NodeSpec[];
  nodeRows: Array<Record<string, unknown>>;
  /** Order of review-node invocations across BOTH invokers, in call order. */
  reviewCallOrder: Array<'xai' | 'claude'>;
}

function takeQueued(queue: NodeResult[]): NodeResult {
  if (queue.length === 0) return okResult('VERDICT: PASS');
  return queue.shift()!;
}

function makeFallbackDeps(opts: {
  xaiReviews: NodeResult[];
  claudeReviews: NodeResult[];
  nodeBudget?: number;
}): { deps: LeafExecutorDeps; spies: FallbackSpies } {
  const spies: FallbackSpies = {
    xaiSpecs: [],
    claudeSpecs: [],
    nodeRows: [],
    reviewCallOrder: [],
  };
  const xaiQueue = [...opts.xaiReviews];
  const claudeQueue = [...opts.claudeReviews];

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.claudeSpecs.push(spec);
        if (isBlueprintSpec(spec)) return okResult('done');
        if (isReviewSpec(spec)) {
          spies.reviewCallOrder.push('claude');
          return takeQueued(claudeQueue);
        }
        return okResult('done'); // implement / fix
      },
    },
    xaiInvoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.xaiSpecs.push(spec);
        if (isReviewSpec(spec)) {
          spies.reviewCallOrder.push('xai');
          return takeQueued(xaiQueue);
        }
        return okResult('done');
      },
    },
    wm: {
      async ensure() {
        return { isGit: true, path: '/tmp/wt/fallback', branch: 'b', baseBranch: 'm' } as never;
      },
      async remove() { /* no-op */ },
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    epicBaseSha: 'base-sha-xyz',
    assertAuth: () => 'subscription',
    assertGrokAuth: () => 'grok',
    async complete(_p, _t, acceptance) {
      return { effective: acceptance };
    },
    async markRejecting() { return true; },
    async bumpRetry() { return true; },
    async refundRetry() { return true; },
    async releaseClaim() { return true; },
    async holdLeaf() { return true; },
    async mergeToEpic() { return {}; },
    escalate() { /* no-op */ },
    recordNode: (e) => { spies.nodeRows.push(e as Record<string, unknown>); return null as never; },
    setInflight: () => { /* no-op */ },
    clearInflight: () => { /* no-op */ },
    worktreeDirty: () => [],
    ...(opts.nodeBudget !== undefined ? { nodeBudget: opts.nodeBudget } : {}),
  };
  return { deps, spies };
}

const PREV_REVIEW_PROVIDER = process.env.MERMAID_NODE_PROVIDER_REVIEW;

beforeEach(() => {
  process.env.MERMAID_NODE_PROVIDER_REVIEW = 'grok-api';
});

afterEach(() => {
  if (PREV_REVIEW_PROVIDER === undefined) delete process.env.MERMAID_NODE_PROVIDER_REVIEW;
  else process.env.MERMAID_NODE_PROVIDER_REVIEW = PREV_REVIEW_PROVIDER;
});

describe('leaf-executor empty-text grok review is transient', () => {
  it('an empty-text grok review is followed by a claude review invocation in the same attempt', async () => {
    const { deps, spies } = makeFallbackDeps({
      xaiReviews: [EMPTY_RESULT],
      claudeReviews: [okResult('VERDICT: PASS')],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    // The in-runNode one-hop grok→claude fallback (classifyProviderFallback rule 3) already
    // dispatches the empty-text grok review's retry onto the claude invoker; the new
    // classifyTransientReviewFailure empty-text arm keeps it from being misread as a real
    // review-vacuous verdict once it lands.
    expect(spies.claudeSpecs.filter(isReviewSpec).length).toBeGreaterThanOrEqual(1);
    expect(spies.claudeSpecs.filter(isImplementSpec).length).toBe(1);
    expect(res.outcome).not.toBe('blocked');
  });

  it('the leaf outcome tracks the claude review verdict rather than a review-vacuous park', async () => {
    // A PASS on the claude-side review (reached via the one-hop empty-text fallback) accepts.
    const pass = makeFallbackDeps({
      xaiReviews: [EMPTY_RESULT],
      claudeReviews: [okResult('VERDICT: PASS')],
    });
    const passRes = await runLeaf('proj', makeLeaf(), pass.deps);
    expect(passRes.outcome).toBe('accepted');

    // The mirror run: a claude-side review FAIL (reached via the same one-hop empty-text
    // fallback) is a real verdict, not a review-vacuous park — it has usable, non-empty text,
    // so classifyTransientReviewFailure's case 2 (ok && non-empty text) short-circuits before
    // the new empty-text arm ever runs, and the FAIL composes as a genuine reject. A tight
    // nodeBudget (mirrors leaf-executor-grok-provider-fallback.test.ts's "the claude fallback
    // result is used as-is" case) forces the post-review checkBudget to park deterministically
    // rather than spending extra nodes on the revise loop.
    const fail = makeFallbackDeps({
      xaiReviews: [EMPTY_RESULT],
      claudeReviews: [FAIL_RESULT],
      nodeBudget: 3,
    });
    const failRes = await runLeaf('proj', makeLeaf(), fail.deps);
    expect(failRes.outcome).not.toBe('accepted');
  });

  it('two consecutive empty-text grok reviews end on a claude review invocation with one implement node', async () => {
    const { deps, spies } = makeFallbackDeps({
      xaiReviews: [EMPTY_RESULT, EMPTY_RESULT],
      claudeReviews: [EMPTY_RESULT, okResult('VERDICT: PASS')],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).not.toBe('blocked');
    expect(spies.reviewCallOrder.length).toBeGreaterThanOrEqual(2);
    expect(spies.reviewCallOrder[spies.reviewCallOrder.length - 1]).toBe('claude');
    expect(spies.claudeSpecs.filter(isImplementSpec).length).toBe(1);
  });
});
