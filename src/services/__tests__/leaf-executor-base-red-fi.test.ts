/**
 * G2 base-red park: forward-integrate + re-probe a behind-trunk epic before parking.
 *
 * Everything effectful is mocked — no live `claude` node, no real worktree/git.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'leaf-executor-fi-ledger-'));

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
    title: 'FI reprobe leaf',
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

function isBlueprintSpec(spec: NodeSpec): boolean {
  return (spec.allowedTools ?? '').includes('Write') && !(spec.allowedTools ?? '').includes('Edit');
}

interface Spies {
  escalations: Array<{ kind: string; questionText: string }>;
  behindCalls: number;
  reprobeCalls: number;
}

function makeDeps(opts: {
  reviewVerdicts?: string[];
  ensureBaseGreen?: LeafExecutorDeps['ensureBaseGreen'];
  epicBehindTrunk?: LeafExecutorDeps['epicBehindTrunk'];
  forwardIntegrateAndReprobe?: LeafExecutorDeps['forwardIntegrateAndReprobe'];
  runGate?: LeafExecutorDeps['runGate'];
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = { escalations: [], behindCalls: 0, reprobeCalls: 0 };
  let reviewIdx = 0;

  const epicBehindTrunk = opts.epicBehindTrunk
    ? async () => { spies.behindCalls += 1; return opts.epicBehindTrunk!(); }
    : undefined;
  const forwardIntegrateAndReprobe = opts.forwardIntegrateAndReprobe
    ? async () => { spies.reprobeCalls += 1; return opts.forwardIntegrateAndReprobe!(); }
    : undefined;

  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        const isReview = (spec.allowedTools ?? '').startsWith('Read Grep Glob Bash');
        const isBlueprint = isBlueprintSpec(spec);
        if (isBlueprint) return okResult('done');
        if (isReview) {
          const v = opts.reviewVerdicts?.[reviewIdx] ?? 'VERDICT: FAIL — none';
          reviewIdx += 1;
          return okResult(v);
        }
        return okResult('done');
      },
    },
    wm: {
      async ensure(sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
        return { isGit: true, path: `/tmp/wt/${sessionKey}`, branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
      },
      async remove() {},
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => 'subscription',
    async complete(_p, _t, acceptance) {
      return { effective: acceptance };
    },
    async markRejecting() {
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
      return {};
    },
    escalate(input) {
      spies.escalations.push({ kind: input.kind, questionText: input.questionText });
    },
    recordNode: () => null as any,
    setInflight: () => {},
    clearInflight: () => {},
    runGate: opts.runGate,
    ensureBaseGreen: opts.ensureBaseGreen,
    epicBehindTrunk,
    forwardIntegrateAndReprobe,
  } as LeafExecutorDeps;

  return { deps, spies };
}

describe('G2 base-red park: forward-integrate + re-probe', () => {
  it('behind trunk with a passing re-probe proceeds past the park', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true }),
      ensureBaseGreen: async () => ({
        status: 'fail', command: 'npx tsc --noEmit', output: 'stale red', reasons: [], declared: true, fresh: true,
      }),
      epicBehindTrunk: async () => 2,
      forwardIntegrateAndReprobe: async () => ({
        status: 'pass', output: '', reasons: [], declared: true, fresh: true,
      }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.reason ?? '').not.toMatch(/^epic-base-red/);
    expect(res.outcome).toBe('accepted');
    expect(spies.behindCalls).toBe(1);
    expect(spies.reprobeCalls).toBe(1);
  });

  it('not behind trunk parks base-red without ever calling the re-probe', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      ensureBaseGreen: async () => ({
        status: 'fail', command: 'npx tsc --noEmit', output: 'x', reasons: [], declared: true, fresh: true,
      }),
      epicBehindTrunk: async () => 0,
      forwardIntegrateAndReprobe: async () => {
        throw new Error('should never be called');
      },
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.reason).toMatch(/^epic-base-red/);
    expect(res.nodesSpent).toBe(0);
    expect(spies.reprobeCalls).toBe(0);
  });

  it('a gate could-not-run error parks immediately with no forward-integration attempt', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      ensureBaseGreen: async () => ({
        status: 'error', command: 'bunx vitest --run', output: 'spawn ENOENT', reasons: [], declared: true, fresh: false,
      }),
      epicBehindTrunk: async () => 5,
      forwardIntegrateAndReprobe: async () => {
        throw new Error('should never be called');
      },
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.reason).toMatch(/^epic-base-gate-could-not-run/);
    expect(spies.behindCalls).toBe(0);
    expect(spies.reprobeCalls).toBe(0);
  });
});
