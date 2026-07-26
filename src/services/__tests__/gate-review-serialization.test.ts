/**
 * Regression test lock: gate→review serialization invariants in runLeaf.
 *
 * This file pins three ordering constraints of the mechanical gate / review pipeline:
 * (1) red gate → no review node spawned (gate+review are NOT parallelizable)
 * (2) gate ERROR → pre-review INFRA, no review node (review is blocked)
 * (3) small tier: mergeToEpic observed BEFORE review node (optimistic merge vs post-merge review)
 *
 * See docs/gate-review-serialization.md for the rationale.
 * This is a standalone serialization lock — run it in isolation via:
 *   bun test src/services/__tests__/gate-review-serialization.test.ts
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated ledger dir so resolveBaseGreen's real recordEpicBaseGate/getEpicBaseGate writes
// never touch (or leak into) the developer's real ~/.mermaid-collab store.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'gate-review-serialization-'));

import {
  runLeaf,
  type LeafExecutorDeps,
} from '../leaf-executor';
import type { Todo } from '../todo-store';
import type { NodeSpec } from '../../agent/node-invoker';

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
    servesCriterionId: null, servesCriterionIds: [],
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: [],
    isBucket: false,
    ...over,
  };
}

/** Classify a NodeSpec as 'blueprint' | 'review' | 'implement' for ordering assertions. */
function classify(spec: NodeSpec): 'blueprint' | 'review' | 'implement' {
  const tools = spec.allowedTools ?? '';
  if (tools.includes('Write') && !tools.includes('Edit')) {
    return 'blueprint';
  }
  if (tools.startsWith('Read Grep Glob Bash')) {
    return 'review';
  }
  return 'implement';
}

interface Spies {
  invokeSpecs: NodeSpec[];
  mergeCalls: number;
  completeCalls: Array<{ acceptance: 'accepted' | 'rejected' }>;
  ensureCalls: Array<{ sessionKey: string; opts: { baseBranch?: string; fresh?: boolean } }>;
  removeCalls: string[];
}

/**
 * Build a deps object for gate→review serialization tests.
 * Minimal harness: only the hooks needed for these three cases.
 */
function makeDeps(opts: {
  reviewVerdicts?: string[];
  runGate?: LeafExecutorDeps['runGate'];
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = {
    invokeSpecs: [],
    mergeCalls: 0,
    completeCalls: [],
    ensureCalls: [],
    removeCalls: [],
  };
  let reviewIdx = 0;

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec) {
        spies.invokeSpecs.push(spec);
        const kind = classify(spec);
        if (kind === 'blueprint') {
          return { ok: true, exitCode: 0, stdout: 'done', durationMs: 1, rateLimited: false, authMode: 'subscription', text: 'done' };
        }
        if (kind === 'review') {
          const v = opts.reviewVerdicts?.[reviewIdx] ?? 'VERDICT: FAIL — none';
          reviewIdx += 1;
          return { ok: true, exitCode: 0, stdout: v, durationMs: 1, rateLimited: false, authMode: 'subscription', text: v };
        }
        // implement
        return { ok: true, exitCode: 0, stdout: 'done', durationMs: 1, rateLimited: false, authMode: 'subscription', text: 'done' };
      },
    },
    wm: {
      async ensure(sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
        spies.ensureCalls.push({ sessionKey, opts: o ?? {} });
        return { isGit: true, path: `/tmp/wt/${spies.ensureCalls.length}`, branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
      },
      async remove(sessionKey: string) {
        spies.removeCalls.push(sessionKey);
      },
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => 'subscription',
    async complete(_p, _t, acceptance) {
      spies.completeCalls.push({ acceptance });
      return { effective: acceptance };
    },
    async markRejecting(_p, _leafId) {
      return true;
    },
    async bumpRetry() {
      return true;
    },
    async refundRetry() {
      return true;
    },
    async releaseClaim() {
      return true;
    },
    async holdLeaf() {
      return true;
    },
    async mergeToEpic() {
      spies.mergeCalls += 1;
      return {};
    },
    escalate() { /* no-op */ },
    recordNode: () => null as any,
    setInflight: () => { /* no-op */ },
    clearInflight: () => { /* no-op */ },
    runGate: opts.runGate,
    gateShadowMode: () => false,
    worktreeDirty: () => [],
  } as LeafExecutorDeps;

  return { deps, spies };
}

describe('gate-review-serialization', () => {
  it('red mechanical gate spawns no review node — gate and review are NOT parallelizable', async () => {
    const { deps, spies } = makeDeps({
      runGate: async () => ({
        status: 'fail',
        command: 'npx tsc --noEmit',
        output: '1 fail',
        reasons: ['x'],
        declared: true,
      }),
      reviewVerdicts: ['VERDICT: PASS'], // the executor must never invoke review
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    const kinds = spies.invokeSpecs.map(classify);
    expect(kinds).toContain('implement');
    expect(kinds.filter((k) => k === 'review').length).toBe(0);
  });

  it('gate ERROR parks blocked and spawns no review node — an INFRA gate is pre-review', async () => {
    const { deps, spies } = makeDeps({
      runGate: async () => ({
        status: 'error',
        command: 'no-such-binary --x',
        output: 'ENOENT',
        reasons: [],
        declared: true,
      }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.invokeSpecs.filter((s) => classify(s) === 'review').length).toBe(0);
  });

  it('small tier: mergeToEpic is observed BEFORE the review node — review reads the post-merge tree', async () => {
    const trace: string[] = [];

    const { deps, spies } = makeDeps({
      runGate: async () => ({
        status: 'pass',
        output: '',
        reasons: [],
        declared: true,
      }),
      reviewVerdicts: ['VERDICT: PASS'],
    });

    // Instrument mergeToEpic to push 'merge' to trace
    const originalMerge = deps.mergeToEpic;
    deps.mergeToEpic = async (...args) => {
      trace.push('merge');
      return { merged: true, integrated: true, mergeSha: 'MSHA' };
    };

    // Instrument invoker to push 'review' when the review node is invoked
    const originalInvoke = deps.invoker.invoke;
    deps.invoker.invoke = async (spec: NodeSpec) => {
      if (classify(spec) === 'review') {
        trace.push('review');
      }
      return originalInvoke.call(deps.invoker, spec);
    };

    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);

    // Assert merge happened before review
    expect(trace).toEqual(['merge', 'review']);
    expect(res.outcome).toBe('accepted');
  });
});
