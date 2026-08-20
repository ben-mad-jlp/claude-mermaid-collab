/**
 * runLeaf-level tests for the bounded in-place transient review re-run (blueprint 5631ee34):
 * a grok-api review failure that looks transient (rate-limit/resource-exhausted/timeout) is
 * re-dispatched on the SAME spec — up to 2 in-place re-runs, the 3rd forced onto the claude
 * invoker — rather than being treated as a real review-vacuous verdict.
 *
 * Mirrors leaf-executor-grok-provider-fallback.test.ts harness conventions: isolate
 * MERMAID_SUPERVISOR_DIR BEFORE importing leaf-executor so the real ledger is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'leaf-executor-transient-review-'));

import {
  runLeaf,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/abcd1234';
const EPIC_ID = 'epic-abcd1234';

const TRANSIENT_RESULT: NodeResult = {
  ok: false,
  exitCode: 1,
  stdout: '',
  durationMs: 1,
  rateLimited: false,
  authMode: 'grok',
  text: 'resource-exhausted: 429 from api.x.ai',
  parseError: 'resource-exhausted',
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

interface RerunSpies {
  xaiSpecs: NodeSpec[];
  claudeSpecs: NodeSpec[];
  nodeRows: Array<Record<string, unknown>>;
}

function takeQueued(queue: NodeResult[]): NodeResult {
  if (queue.length === 0) return okResult('VERDICT: PASS');
  return queue.shift()!;
}

function makeRerunDeps(opts: {
  xaiReviews: NodeResult[];
  claudeReviews: NodeResult[];
}): { deps: LeafExecutorDeps; spies: RerunSpies } {
  const spies: RerunSpies = {
    xaiSpecs: [],
    claudeSpecs: [],
    nodeRows: [],
  };
  const xaiQueue = [...opts.xaiReviews];
  const claudeQueue = [...opts.claudeReviews];

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.claudeSpecs.push(spec);
        if (isBlueprintSpec(spec)) return okResult('done');
        if (isReviewSpec(spec)) return takeQueued(claudeQueue);
        return okResult('done'); // implement / fix
      },
    },
    xaiInvoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.xaiSpecs.push(spec);
        if (isReviewSpec(spec)) return takeQueued(xaiQueue);
        return okResult('done');
      },
    },
    wm: {
      async ensure() {
        return { isGit: true, path: '/tmp/wt/rerun', branch: 'b', baseBranch: 'm' } as never;
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

describe('leaf-executor in-place transient review re-run', () => {
  it('one transient grok-api review failure is followed by a second review invocation with no new implement node', async () => {
    const { deps, spies } = makeRerunDeps({
      xaiReviews: [TRANSIENT_RESULT, okResult('VERDICT: PASS')],
      claudeReviews: [],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // Both review calls went to the xai (grok-api) invoker — no forced-claude hop needed.
    expect(spies.xaiSpecs.filter(isReviewSpec).length).toBe(2);
    expect(spies.claudeSpecs.filter(isReviewSpec).length).toBe(0);
    // Exactly one implement node — the re-run re-invokes review only, not implement.
    expect(spies.claudeSpecs.filter(isImplementSpec).length).toBe(1);
    const rerunRow = spies.nodeRows.find(
      (r) => r.nodeKind === 'grounding-audit' && typeof r.outcomeDetail === 'string' && (r.outcomeDetail as string).includes('transientReviewRerun'),
    );
    expect(rerunRow).toBeDefined();
    const detail = JSON.parse(rerunRow!.outcomeDetail as string);
    expect(detail.transientReviewRerun.n).toBe(1);
    expect(detail.transientReviewRerun.forcedClaude).toBe(false);
  });

  it('after two transient review failures the third review call goes to the claude invoker', async () => {
    const { deps, spies } = makeRerunDeps({
      xaiReviews: [TRANSIENT_RESULT, TRANSIENT_RESULT],
      claudeReviews: [okResult('VERDICT: PASS')],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.xaiSpecs.filter(isReviewSpec).length).toBe(2);
    expect(spies.claudeSpecs.filter(isReviewSpec).length).toBe(1);
    // No fourth review call — the cap is 3 review calls total per attempt.
    expect(spies.xaiSpecs.filter(isReviewSpec).length + spies.claudeSpecs.filter(isReviewSpec).length).toBe(3);
    const forcedRow = spies.nodeRows.find(
      (r) => r.nodeKind === 'grounding-audit' && typeof r.outcomeDetail === 'string' && (r.outcomeDetail as string).includes('"forcedClaude":true'),
    );
    expect(forcedRow).toBeDefined();
  });
});
