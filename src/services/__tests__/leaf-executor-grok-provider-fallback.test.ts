/**
 * runLeaf-level tests for grok→claude provider fallback wiring inside runNode.
 *
 * Mirrors leaf-executor.test.ts harness conventions: isolate MERMAID_SUPERVISOR_DIR
 * BEFORE importing leaf-executor so the real ledger is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'leaf-executor-grok-fallback-'));

import {
  runLeaf,
  NODE_PROFILE,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/abcd1234';
const EPIC_ID = 'epic-abcd1234';

const HALT_PARSE_ERROR =
  `grok: HALT: node refused — active auth is 'unknown', not grok OIDC. ` +
  `Run 'grok login' and ensure grok is on PATH (or set GROK_BIN).`;

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

function emptyResult(over: Partial<NodeResult> = {}): NodeResult {
  return {
    ok: false,
    exitCode: 1,
    stdout: '',
    durationMs: 1,
    rateLimited: false,
    authMode: 'grok',
    text: '',
    ...over,
  };
}

function haltResult(): NodeResult {
  return {
    ok: false,
    exitCode: -1,
    stdout: '',
    durationMs: 1,
    rateLimited: false,
    authMode: 'unknown',
    text: undefined,
    parseError: HALT_PARSE_ERROR,
  };
}

const isReviewSpec = (spec: NodeSpec): boolean =>
  (spec.allowedTools ?? '').startsWith('Read Grep Glob Bash');

const isBlueprintSpec = (spec: NodeSpec): boolean =>
  (spec.allowedTools ?? '').includes('Write') && !(spec.allowedTools ?? '').includes('Edit');

interface FallbackSpies {
  grokSpecs: NodeSpec[];
  claudeSpecs: NodeSpec[];
  nodeRows: Array<Record<string, unknown>>;
}

function takeQueued(queue: NodeResult[]): NodeResult {
  if (queue.length === 0) return emptyResult();
  return queue.shift()!;
}

function makeFallbackDeps(opts: {
  grokReviews: NodeResult[];
  claudeReviews: NodeResult[];
  nodeBudget?: number;
}): { deps: LeafExecutorDeps; spies: FallbackSpies } {
  const spies: FallbackSpies = {
    grokSpecs: [],
    claudeSpecs: [],
    nodeRows: [],
  };
  const grokQueue = [...opts.grokReviews];
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
    grokInvoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.grokSpecs.push(spec);
        if (isReviewSpec(spec)) return takeQueued(grokQueue);
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
    ...(opts.nodeBudget != null ? { nodeBudget: opts.nodeBudget } : {}),
  };
  return { deps, spies };
}

const PREV_REVIEW_PROVIDER = process.env.MERMAID_NODE_PROVIDER_REVIEW;

beforeEach(() => {
  process.env.MERMAID_NODE_PROVIDER_REVIEW = 'grok-build';
});

afterEach(() => {
  if (PREV_REVIEW_PROVIDER === undefined) delete process.env.MERMAID_NODE_PROVIDER_REVIEW;
  else process.env.MERMAID_NODE_PROVIDER_REVIEW = PREV_REVIEW_PROVIDER;
});

describe('leaf-executor grok→claude provider fallback', () => {
  it('a grok review node returning the auth-refusal HALT is re-dispatched once on the claude invoker', async () => {
    const { deps, spies } = makeFallbackDeps({
      grokReviews: [haltResult()],
      claudeReviews: [okResult('VERDICT: PASS')],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.grokSpecs.filter(isReviewSpec).length).toBe(1);
    expect(spies.claudeSpecs.filter(isReviewSpec).length).toBe(1);
    // Claude retry uses the ORIGINAL spec model (claude default), not the grok model.
    const claudeReview = spies.claudeSpecs.filter(isReviewSpec)[0]!;
    expect(claudeReview.model).toBe(NODE_PROFILE.review.model);
  });

  it('a grok review node returning empty text is re-dispatched on claude and the leaf does not park with review-vacuous', async () => {
    const { deps, spies } = makeFallbackDeps({
      grokReviews: [emptyResult()],
      claudeReviews: [okResult('VERDICT: PASS')],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).not.toBe('blocked');
    expect(res.reason ?? '').not.toMatch(/review-vacuous/);
    expect(spies.claudeSpecs.filter(isReviewSpec).length).toBe(1);
    expect(res.outcome).toBe('accepted');
  });

  it('the fallback node row is recorded with provider claude and an outcomeDetail providerFallback reason naming the grok failure', async () => {
    const { deps, spies } = makeFallbackDeps({
      grokReviews: [haltResult()],
      claudeReviews: [okResult('VERDICT: PASS')],
    });
    await runLeaf('proj', makeLeaf(), deps);
    const reviewRow = spies.nodeRows.find((r) => r.nodeKind === 'review');
    expect(reviewRow).toBeDefined();
    expect(reviewRow!.provider).toBe('claude');
    expect(typeof reviewRow!.outcomeDetail).toBe('string');
    const detail = JSON.parse(reviewRow!.outcomeDetail as string);
    expect(detail.providerFallback).toBeDefined();
    expect(detail.providerFallback.from).toBe('grok-build');
    expect(detail.providerFallback.to).toBe('claude');
    expect(String(detail.providerFallback.reason)).toContain('grok-auth-refusal');
    expect(String(detail.providerFallback.reason)).toContain('HALT: node refused');
  });

  it('the bounded transient re-run stops after one in-place grok re-run and one forced-claude review hop — the claude result is used as-is and triggers no further fallback', async () => {
    // The grok review results are transient but NOT fallback-eligible: non-empty text
    // keeps classifyProviderFallback's empty-text rule off (and there is no HALT), while
    // the rate-limit token trips TRANSIENT_REVIEW_MATCHERS. So the bounded in-place
    // re-run loop runs: re-run #1 stays on grok, re-run #2 is forced onto claude.
    // The empty claude result is used as-is — no further fallback — and the capped
    // master budget stops the post-review retry cycle from starting a second review.
    const { deps, spies } = makeFallbackDeps({
      grokReviews: [
        emptyResult({ text: 'grok: rate limit exceeded (429)' }),
        emptyResult({ text: 'grok: rate limit exceeded (429)' }),
      ],
      claudeReviews: [emptyResult({ authMode: 'subscription' })],
      nodeBudget: 3,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(spies.grokSpecs.filter(isReviewSpec).length).toBe(2);
    expect(spies.grokSpecs.length).toBe(2);
    expect(spies.claudeSpecs.filter(isReviewSpec).length).toBe(1);
    // Bounded: two grok review invokes + exactly one forced-claude review hop.
    expect(spies.grokSpecs.length + spies.claudeSpecs.filter(isReviewSpec).length).toBe(3);
    expect(res.reason ?? '').not.toMatch(/review-vacuous/);
  });
});
