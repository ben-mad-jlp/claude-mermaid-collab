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
import {
  recordEpicBaseGate, getEpicBaseGate, recordBaseGateVerdict, getBaseGateVerdict,
  listTestObservations, invalidateEpicBaseGate,
} from '../worker-ledger';
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

function isBlueprintSpec(spec: NodeSpec): boolean {
  return (spec.allowedTools ?? '').includes('Write') && !(spec.allowedTools ?? '').includes('Edit');
}

interface Spies {
  escalations: Array<{ kind: string; questionText: string }>;
  behindCalls: number;
  reprobeCalls: number;
  nodeRows: Array<{ nodeKind: string; outcomeDetail?: string | null; outputText?: string | null }>;
  completeCalls: Array<{ acceptance: string }>;
}

function makeDeps(opts: {
  reviewVerdicts?: string[];
  ensureBaseGreen?: LeafExecutorDeps['ensureBaseGreen'];
  epicBehindTrunk?: LeafExecutorDeps['epicBehindTrunk'];
  forwardIntegrateAndReprobe?: LeafExecutorDeps['forwardIntegrateAndReprobe'];
  runGate?: LeafExecutorDeps['runGate'];
  // Empty-diff carve-out seams: scripted change-set (commits vs base), the parent-epic
  // todo reader (baseRepair flag), and a completion gate that can re-red the base.
  changeSet?: string[] | null;
  getEpicTodo?: LeafExecutorDeps['getEpicTodo'];
  completeBaseRed?: { command: string; failingFiles: string[]; signature: string };
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = { escalations: [], behindCalls: 0, reprobeCalls: 0, nodeRows: [], completeCalls: [] };
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
      spies.completeCalls.push({ acceptance });
      if (opts.completeBaseRed) {
        return { effective: 'pending', baseRed: opts.completeBaseRed, pendingReason: `epic-base-red: ${opts.completeBaseRed.command}` };
      }
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
    recordNode: (e: { nodeKind: string; outcomeDetail?: string | null; outputText?: string | null }) => { spies.nodeRows.push(e); return null as any; },
    setInflight: () => {},
    clearInflight: () => {},
    runGate: opts.runGate,
    ensureBaseGreen: opts.ensureBaseGreen,
    epicBehindTrunk,
    forwardIntegrateAndReprobe,
    getEpicTodo: opts.getEpicTodo,
    changeSet: opts.changeSet !== undefined ? async () => opts.changeSet ?? null : undefined,
    // Clean tree by default so the salvage probe never touches the host filesystem.
    worktreeDirty: () => [],
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

// ---------------------------------------------------------------------------------------
// Empty diff on a BASE-REPAIR epic is proof the base is green (flake evidence): the
// repair leaf found nothing to fix, so the cached red verdicts are invalidated, green
// observations accrue for the previously-failing tests, and the leaf settles through the
// NORMAL completion gate (whose re-measure of the now-uncached base is the arbiter).
// ---------------------------------------------------------------------------------------
describe('empty-diff base-repair carve-out', () => {
  const DECLARED = 'Implement ONLY this file: src/foo.ts';
  const redBase = (baseSha: string, failing: string[]): LeafExecutorDeps['ensureBaseGreen'] =>
    async () => ({
      status: 'fail', command: 'bun test', output: `${failing.length} fail`, reasons: [], declared: true, fresh: false,
    });

  it('repair leaf + empty diff + cached red T1,T2: verdicts deleted, epic row cleared, green observations recorded, complete(accepted)', async () => {
    const BASE_SHA = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
    recordEpicBaseGate({
      epicId: EPIC_ID, project: 'proj', baseSha: BASE_SHA, status: 'fail',
      command: 'bun test', output: '2 files FAILED', baselineFailures: { baseTest: ['T1', 'T2'] },
    });
    expect(getEpicBaseGate(EPIC_ID, BASE_SHA)).not.toBeNull();
    expect(recordBaseGateVerdict({
      key: `k:${BASE_SHA}`, project: 'proj', baseSha: BASE_SHA, status: 'fail',
      resultJson: null, quarantineHash: 'qh',
    })).toBe(true);
    const { deps, spies } = makeDeps({
      changeSet: [],
      ensureBaseGreen: redBase(BASE_SHA, ['T1', 'T2']),
      getEpicTodo: () => makeLeaf({ id: EPIC_ID, title: 'green the lane', baseRepair: 1 }),
    });
    const res = await runLeaf('proj', makeLeaf({ description: DECLARED }), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.reason).toBe('empty-diff-repair-base-green');
    // The epic's cached red row is CLEARED — the next gate consult re-measures.
    expect(getEpicBaseGate(EPIC_ID, BASE_SHA)).toBeNull();
    // The shared verdict rows for that baseSha are DELETED.
    expect(getBaseGateVerdict(`k:${BASE_SHA}`)).toBeNull();
    // A GREEN observation exists for each previously-failing test at that sha
    // (pass-and-fail-at-same-sha: the flake signal the quarantine promoter reads).
    for (const t of ['T1', 'T2']) {
      const obs = listTestObservations('proj', t, 0);
      expect(obs.length).toBe(1);
      expect(obs[0]!.baseSha).toBe(BASE_SHA);
      expect(obs[0]!.failed).toBe(false);
      expect(obs[0]!.lane).toBe('baseTest');
      expect(obs[0]!.scope).toBe('base');
    }
    // Settled through the NORMAL completion gate — never bypassed, never escalated.
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    expect(spies.escalations.filter((e) => e.kind === 'empty-diff-declared-changes')).toEqual([]);
    // Forensic ledger row explains the classification.
    const row = spies.nodeRows.find((r) => r.nodeKind === 'empty-diff-repair-base-green');
    expect(row).toBeDefined();
    const detail = JSON.parse(row!.outcomeDetail ?? '{}');
    expect(detail.reason).toBe('empty-diff-repair-base-green');
    expect(detail.baseSha).toBe(BASE_SHA);
    expect(detail.clearedFailing).toEqual(['T1', 'T2']);
  });

  it('NON-repair leaf + empty diff: legacy escalate+park byte-identical, ledger untouched', async () => {
    const BASE_SHA = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';
    recordEpicBaseGate({
      epicId: EPIC_ID, project: 'proj', baseSha: BASE_SHA, status: 'fail',
      command: 'bun test', output: '1 file FAILED', baselineFailures: { baseTest: ['T3'] },
    });
    expect(recordBaseGateVerdict({
      key: `k:${BASE_SHA}`, project: 'proj', baseSha: BASE_SHA, status: 'fail',
      resultJson: null, quarantineHash: 'qh',
    })).toBe(true);
    const { deps, spies } = makeDeps({
      changeSet: [],
      // Base reads green here: a non-repair epic with a red base parks at the base gate
      // long before implement, so the empty-diff site is only reachable on a green base.
      getEpicTodo: () => makeLeaf({ id: EPIC_ID, title: 'ordinary epic', baseRepair: 0 }),
    });
    const res = await runLeaf('proj', makeLeaf({ description: DECLARED }), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('empty-diff-spec-demands-changes');
    const card = spies.escalations.find((e) => e.kind === 'empty-diff-declared-changes');
    expect(card).toBeDefined();
    expect(card!.questionText).toContain('NOT a reviewer rejection');
    // NOTHING invalidated, NOTHING recorded: the carve-out never ran.
    expect(getEpicBaseGate(EPIC_ID, BASE_SHA)).not.toBeNull();
    expect(getBaseGateVerdict(`k:${BASE_SHA}`)).not.toBeNull();
    expect(listTestObservations('proj', 'T3', 0)).toEqual([]);
    // The park's own bookkeeping may mark rejected, but nothing ever settles ACCEPTED.
    expect(spies.completeCalls.filter((c) => c.acceptance === 'accepted')).toEqual([]);
    expect(spies.nodeRows.find((r) => r.nodeKind === 'empty-diff-repair-base-green')).toBeUndefined();
    // Clean the seeded rows out of the shared per-file ledger for the tests that follow.
    invalidateEpicBaseGate(EPIC_ID);
  });

  it('repair leaf + empty diff + completion re-measure reds AGAIN: settles via the base-red park (no accept) — the re-red is evidence the red is real', async () => {
    const BASE_SHA = 'cccc3333cccc3333cccc3333cccc3333cccc3333';
    recordEpicBaseGate({
      epicId: EPIC_ID, project: 'proj', baseSha: BASE_SHA, status: 'fail',
      command: 'bun test', output: '1 file FAILED', baselineFailures: { baseTest: ['T5'] },
    });
    const { deps, spies } = makeDeps({
      changeSet: [],
      ensureBaseGreen: redBase(BASE_SHA, ['T5']),
      getEpicTodo: () => makeLeaf({ id: EPIC_ID, title: 'green the lane', baseRepair: 1 }),
      completeBaseRed: { command: 'bun test', failingFiles: ['src/x.test.ts'], signature: 'sig' },
    });
    const res = await runLeaf('proj', makeLeaf({ description: DECLARED }), deps);
    // The gate WAS consulted (the invalidation makes its re-measure honest)…
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    // …and its fresh red wins: base-red park, never an accept.
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toMatch(/^epic-base-red/);
    // The stale cached red is still cleared — the repair's measurement stands; the NEW red
    // recorded by the re-measure (in prod) is a fresh fact, not this stale row.
    expect(getEpicBaseGate(EPIC_ID, BASE_SHA)).toBeNull();
  });
});
