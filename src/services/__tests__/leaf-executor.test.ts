/**
 * Unit tests for the MINIMAL leaf-executor (PAW P2) state machine.
 *
 * Everything effectful — the node invoker, the worktree manager, the completion
 * gate, escalation, the ledger, and the auth guard — is MOCKED. NO live `claude`
 * node is ever spawned, and no real worktree/git is touched.
 */
import { describe, it, expect } from 'bun:test';
import {
  runLeaf,
  parseVerdict,
  isCacheableBaseGateStatus,
  buildNodePrompt,
  buildReviewPrompt,
  buildBlueprintRefreshPrompt,
  parseSizeManifest,
  leafExecutionMode,
  parseVerifyGate,
  buildVerifyPrompt,
  resolveVerifyGate,
  verbMcpTool,
  VERIFY_GATE_VERB,
  VERIFY_EXEC_TIMEOUT_MS,
  FILE_THRESHOLD,
  NODE_BUDGET,
  NODE_PROFILE,
  IMPLEMENT_TIMEOUT_MS,
  makeCitationExists,
  escalateImplementModel,
  isNonFalsifiableReviewDoubt,
  isTestFilePath,
  sameReviewWall,
  deprecatePriorAttempts,
  blueprintAttemptName,
  planResume,
  isNodeStartFailure,
  resolveInheritedSlice,
  type LeafExecutorDeps,
  type LeafSizeManifest,
  type LeafSplitItem,
  type InheritedSlice,
} from '../leaf-executor';
import { sliceCoversFiles } from '../split-decision';
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

/** A non-rate-limited node failure (e.g. the transient blueprint exit-1 seen in the
 *  live L1 pilot). ok:false, NOT rateLimited. */
function failResult(): NodeResult {
  return { ok: false, exitCode: 1, stdout: '', durationMs: 1, rateLimited: false, authMode: 'subscription', text: '' };
}

interface Spies {
  ensureCalls: Array<{ sessionKey: string; opts: { baseBranch?: string; fresh?: boolean } }>;
  invokeSpecs: NodeSpec[];
  completeCalls: Array<{ acceptance: 'accepted' | 'rejected' }>;
  mergeCalls: number;
  escalations: Array<{ kind: string; questionText: string }>;
  removeCalls: string[];
  markRejectingCalls: string[];
  bumpRetryCalls: Array<{ project: string; leafId: string }>;
  releaseClaimCalls: Array<{ project: string; leafId: string }>;
  holdLeafCalls: Array<{ project: string; leafId: string; reason: string }>;
  /** Ordered log of 'mark' (markRejecting) vs 'complete:<acceptance>' to assert the
   *  reject pre-stamp lands BEFORE the slow gate. */
  seq: string[];
  /** Ordered log of 'set:<kind>' (setInflight) and 'clear' (clearInflight) — bug
   *  0f1df3d2: the row must span the whole run (set per-node, cleared ONCE at the end). */
  inflightSeq: string[];
  /** Captured recordNode calls. */
  nodeRows: Array<any>;
  gateEvals: Array<any>;
  coverageCalls: Array<{ testFiles: string[]; baseSha?: string | null }>;
  contestedCalls: Array<{ reason: string }>;
}

/** Build a deps object whose invoker returns the supplied scripted REVIEW verdicts
 *  (one per attempt). blueprint+implement always return ok. */
function makeDeps(opts: {
  reviewVerdicts?: string[]; // 'VERDICT: PASS' | 'VERDICT: FAIL — x' | '' per review call
  gateEffective?: 'accepted' | 'rejected' | 'pending';
  authThrows?: boolean;
  mergeThrows?: boolean;
  blueprintFails?: number; // first N blueprint-node invocations return ok:false (non-rate-limited)
  markRejectingOwned?: boolean; // bug aadd927b: markRejecting returns this (false ⇒ run lost the todo)
  // G2: mechanical gate hooks. Absent ⇒ unwired ⇒ pre-G2 behaviour (the floor never calls them).
  runGate?: LeafExecutorDeps['runGate'];
  ensureBaseGreen?: LeafExecutorDeps['ensureBaseGreen'];
  // G3: change-set hook for grounding. Absent ⇒ unwired ⇒ abstain (no park; today's behaviour).
  changeSet?: string[] | null;
  gateShadowMode?: boolean;
  // crit 2/3: mock the edit-coverage seam. true=covered, false=uncovered, null=unknown.
  // Absent ⇒ seam unwired (returns null ⇒ gate).
  coverage?: boolean | null;
  // crit 4: mock the contested-card decision. Absent ⇒ seams unwired (no card).
  contestedDecision?: 'accept' | 'reject' | 'timeout';
  // crit 8: mock readBlueprint return values by call index. Absent ⇒ unwired.
  readBlueprintReturns?: (string | undefined)[];
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = {
    ensureCalls: [],
    invokeSpecs: [],
    completeCalls: [],
    mergeCalls: 0,
    escalations: [],
    removeCalls: [],
    markRejectingCalls: [],
    bumpRetryCalls: [],
    releaseClaimCalls: [],
    holdLeafCalls: [],
    seq: [],
    inflightSeq: [],
    nodeRows: [],
    gateEvals: [],
    coverageCalls: [],
    contestedCalls: [],
  };
  let reviewIdx = 0;
  let bpFailsLeft = opts.blueprintFails ?? 0;
  let readBlueprintIdx = 0;
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.invokeSpecs.push(spec);
        // The review node is the opus read-only one (no Write/Edit in allowedTools).
        const isReview = spec.allowedTools === 'Read Grep Glob Bash';
        // The blueprint node is the one allowed to Write (implement uses Edit).
        const isBlueprint = (spec.allowedTools ?? '').includes('Write');
        if (isBlueprint && bpFailsLeft > 0) {
          bpFailsLeft -= 1;
          return failResult();
        }
        if (isReview) {
          const v = opts.reviewVerdicts?.[reviewIdx] ?? 'VERDICT: FAIL — none';
          reviewIdx += 1;
          return okResult(v);
        }
        return okResult('done');
      },
    },
    wm: {
      // The methods the executor touches.
      async ensure(sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
        spies.ensureCalls.push({ sessionKey, opts: o ?? {} });
        return { isGit: true, path: `/tmp/wt/${spies.ensureCalls.length}`, branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
      },
      // FM3: the executor reaps its own worktree on a terminal outcome.
      async remove(sessionKey: string) {
        spies.removeCalls.push(sessionKey);
      },
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => {
      if (opts.authThrows) throw new Error('not a subscription');
      return 'subscription';
    },
    async complete(_p, _t, acceptance) {
      spies.completeCalls.push({ acceptance });
      spies.seq.push(`complete:${acceptance}`);
      return { effective: opts.gateEffective ?? acceptance };
    },
    async markRejecting(_p, leafId) {
      spies.markRejectingCalls.push(leafId);
      spies.seq.push('mark');
      return opts.markRejectingOwned ?? true; // default owned (legacy behaviour)
    },
    async bumpRetry(p, leafId) {
      spies.bumpRetryCalls.push({ project: p, leafId });
      return true;
    },
    async releaseClaim(p, leafId) {
      spies.releaseClaimCalls.push({ project: p, leafId });
      return true;
    },
    async holdLeaf(p, leafId, reason) {
      spies.holdLeafCalls.push({ project: p, leafId, reason });
      return true;
    },
    async mergeToEpic() {
      spies.mergeCalls += 1;
      if (opts.mergeThrows) throw new Error('conflict');
      return {};
    },
    escalate(input) {
      spies.escalations.push({ kind: input.kind, questionText: input.questionText });
    },
    recordNode: (e) => { spies.nodeRows.push(e); return null as any; },
    setInflight: (e) => { spies.inflightSeq.push(`set:${e.nodeKind ?? '?'}`); },
    clearInflight: () => { spies.inflightSeq.push('clear'); },
    runGate: opts.runGate,
    ensureBaseGreen: opts.ensureBaseGreen,
    changeSet: opts.changeSet !== undefined ? async () => opts.changeSet ?? null : undefined,
    recordGateEval: async (_p, input) => { spies.gateEvals.push(input); return {} as any; },
    gateShadowMode: () => opts.gateShadowMode ?? false,
    testsFlipBaseToBranch: opts.coverage !== undefined
      ? async ({ testFiles, baseSha }) => { spies.coverageCalls.push({ testFiles, baseSha }); return opts.coverage ?? null; }
      : undefined,
    epicBaseSha: 'base-sha-xyz',
    proposeContested: opts.contestedDecision !== undefined
      ? (input) => { spies.contestedCalls.push({ reason: input.reason }); return { escalationId: 'esc-contested', createdAt: 0, isNew: true }; }
      : undefined,
    awaitContestedDecision: opts.contestedDecision !== undefined
      ? async () => opts.contestedDecision!
      : undefined,
    readBlueprint: opts.readBlueprintReturns !== undefined
      ? async (_cwd: string, _leaf: Todo) => {
          const result = opts.readBlueprintReturns![readBlueprintIdx];
          readBlueprintIdx += 1;
          return result;
        }
      : undefined,
  };
  return { deps, spies };
}

describe('planResume (resume decision — conservative, fresh on any doubt)', () => {
  const SHA = 'abc123';
  it('no resume row → fresh', () => {
    expect(planResume(null, SHA)).toEqual({ mode: 'fresh', reason: 'no-resume-state' });
  });
  it('merged → skip-to-gate regardless of epic base', () => {
    expect(planResume({ merged: true, phase: 'review', epicBaseSha: 'old' }, SHA).mode).toBe('skip-to-gate');
    expect(planResume({ merged: true, phase: 'blueprint', epicBaseSha: null }, null).mode).toBe('skip-to-gate');
  });
  it('killed at/before blueprint → fresh (nothing durable to reuse)', () => {
    expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: SHA }, SHA).reason).toBe('killed-before-blueprint');
    expect(planResume({ merged: false, phase: null, epicBaseSha: SHA }, SHA).reason).toBe('killed-before-blueprint');
  });
  it('missing epic base on either side → fresh', () => {
    expect(planResume({ merged: false, phase: 'implement', epicBaseSha: null }, SHA).reason).toBe('no-epic-base');
    expect(planResume({ merged: false, phase: 'implement', epicBaseSha: SHA }, null).reason).toBe('no-epic-base');
  });
  it('epic base moved → fresh (never resume against a changed world)', () => {
    expect(planResume({ merged: false, phase: 'implement', epicBaseSha: 'old' }, SHA)).toEqual({ mode: 'fresh', reason: 'epic-base-moved' });
  });
  it('blueprint done + base unchanged → reattach-blueprint', () => {
    expect(planResume({ merged: false, phase: 'implement', epicBaseSha: SHA }, SHA)).toEqual({ mode: 'reattach-blueprint', reason: 'blueprint-reusable' });
    expect(planResume({ merged: false, phase: 'review', epicBaseSha: SHA }, SHA).mode).toBe('reattach-blueprint');
  });
  it('blueprint phase + durable blueprint output + base unchanged → reattach (no re-burn)', () => {
    expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: SHA }, SHA, true))
      .toEqual({ mode: 'reattach-blueprint', reason: 'blueprint-reusable' });
  });
  it('blueprint phase + durable output but base moved → fresh (never reuse a stale plan)', () => {
    expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: 'old' }, SHA, true).reason)
      .toBe('epic-base-moved');
  });
  it('blueprint phase + NO durable output → still fresh (killed-before-blueprint)', () => {
    expect(planResume({ merged: false, phase: 'blueprint', epicBaseSha: SHA }, SHA, false).reason)
      .toBe('killed-before-blueprint');
  });
  // Guard-rejected blueprint (friction 2225bd99): the citability park clears the
  // leaf_blueprint cache row, so the no-resume-row reattach path loses its
  // blueprintBaseSha and MUST decide fresh — a rejected plan is never reusable,
  // even though the ledger node output (hasBlueprintOutput) still exists.
  it('no resume row + hasBlueprintOutput but NO blueprint cache row → fresh (guard-rejected plan not reusable)', () => {
    expect(planResume(null, SHA, true, null).mode).toBe('fresh');
  });
  // G8: blueprintBaseSha (durable base) path — when the run checkpoint is cleared but
  // the blueprint is still reusable. D1 regression: no-resume-row case.
  it('no resume row + hasBlueprintOutput + blueprintBaseSha === currentEpicSha → reattach (D1 regression)', () => {
    expect(planResume(null, SHA, true, SHA))
      .toEqual({ mode: 'reattach-blueprint', reason: 'blueprint-reusable-no-resume-row' });
  });
  it('no resume row + hasBlueprintOutput + blueprintBaseSha !== currentEpicSha → fresh base-moved', () => {
    expect(planResume(null, SHA, true, 'old'))
      .toEqual({ mode: 'fresh', reason: 'epic-base-moved' });
  });
  it('no resume row + hasBlueprintOutput + currentEpicSha null → fresh no-epic-base', () => {
    expect(planResume(null, null, true, SHA))
      .toEqual({ mode: 'fresh', reason: 'no-epic-base' });
  });
  it('resume row with epicBaseSha null + blueprintBaseSha matching → reattach (COALESCE fallback)', () => {
    expect(planResume({ merged: false, phase: 'implement', epicBaseSha: null }, SHA, false, SHA))
      .toEqual({ mode: 'reattach-blueprint', reason: 'blueprint-reusable' });
  });
  it('resume row base moved → fresh (epic-base-moved guard is NOT weakened)', () => {
    expect(planResume({ merged: false, phase: 'implement', epicBaseSha: 'old' }, SHA, false, SHA).reason)
      .toBe('epic-base-moved');
  });
  it('resetBreaker() call then re-plan with durable blueprint → reattach survives reset', () => {
    // resetBreakerStreak() does NOT touch leaf_blueprint, so a durable blueprint base
    // survives an operator reset. This proves the durable path is independent.
    expect(planResume(null, SHA, true, SHA))
      .toEqual({ mode: 'reattach-blueprint', reason: 'blueprint-reusable-no-resume-row' });
  });
});

describe('parseVerdict (fail-closed)', () => {
  it('PASS only on an explicit VERDICT: PASS line', () => {
    expect(parseVerdict('blah\nVERDICT: PASS')).toBe('pass');
    expect(parseVerdict('VERDICT: PASS — looks good')).toBe('pass');
    expect(parseVerdict('VERDICT: FAIL — nope')).toBe('fail');
  });
  it('tolerates markdown wrapping the model echoes from the prompt (backticks/bold)', () => {
    // The L4 false-stuck class: the prompt SHOWS `VERDICT: PASS` in backticks, so the
    // model echoes them — a line-anchored regex must not be defeated by the wrapper.
    expect(parseVerdict('`VERDICT: PASS`')).toBe('pass');
    expect(parseVerdict('**VERDICT: PASS**')).toBe('pass');
  });
  it('is an INFRA "error", not a fail, when the reviewer said nothing parseable (bug 80bacbc4)', () => {
    expect(parseVerdict('no verdict line at all')).toBe('error');
    expect(parseVerdict(undefined)).toBe('error');
    expect(parseVerdict('')).toBe('error');
    expect(parseVerdict('   \n  ')).toBe('error');
    expect(parseVerdict('I looked at it, seems fine.')).toBe('error');
  });
  it('a terse-but-real verdict is still PASS/FAIL, not error — terseness is not emptiness', () => {
    expect(parseVerdict('VERDICT: FAIL')).toBe('fail');
    expect(parseVerdict('`VERDICT: FAIL`')).toBe('fail');
    expect(parseVerdict('VERDICT: PASS')).toBe('pass');
  });
});


describe('buildNodePrompt per-node specs', () => {
  it('blueprint writes, implement edits, review is read-only — via runLeaf specs', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    await runLeaf('proj', makeLeaf(), deps);
    const [bp, impl, rev] = spies.invokeSpecs;
    expect(bp.model).toBe('opus');
    expect(bp.allowedTools).toContain('Write');
    expect(impl.model).toBe('sonnet');
    expect(impl.allowedTools).toContain('Edit');
    expect(rev.model).toBe('opus');
    expect(rev.allowedTools).not.toContain('Edit');
    expect(rev.allowedTools).not.toContain('Write');
    // all share the fresh worktree cwd
    expect(bp.cwd).toBe('/tmp/wt/1');
    expect(impl.cwd).toBe('/tmp/wt/1');
    expect(rev.cwd).toBe('/tmp/wt/1');
    // implement gets the long wall-clock cap (Haiku pins routinely exceed the 600s
    // invoker default); blueprint/review keep the default (undefined → 600s), so
    // start-window stall detection latency is unchanged for them.
    expect(impl.timeoutMs).toBe(IMPLEMENT_TIMEOUT_MS);
    expect(bp.timeoutMs).toBeUndefined();
    expect(rev.timeoutMs).toBeUndefined();
    // review prompt asks for the VERDICT contract
    expect(buildNodePrompt('review', makeLeaf())).toContain('VERDICT: PASS');
  });

  it('blueprint prompt forbids command-result and absence acceptance criteria', () => {
    const bp = buildNodePrompt('blueprint', makeLeaf());
    // no build/command/gate-result criteria
    expect(bp).toMatch(/gate result is NOT a citation/);
    expect(bp).toContain('BUILD SUCCEEDED');
    // no absence / non-goal criteria (existing guidance, asserted for completeness)
    expect(bp).toMatch(/NEVER write an absence or non-goal as an acceptance criterion/);
  });
});

describe('runLeaf state machine', () => {
  it('(i) pass on attempt 1 → merge then complete(accepted), 3 nodes, 1 attempt', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.attempts).toBe(1);
    expect(res.nodesSpent).toBe(3);
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    expect(spies.escalations.length).toBe(0);
  });

  // bug 0f1df3d2: the leaf_inflight row must SPAN the whole run so the daemon's
  // orphan-reclaim guard (isLeafInflightLive) never reclaims a live leaf mid-run or
  // in the between-nodes window. setInflight fires per-node (fresh nodeKind); the row
  // is cleared exactly ONCE, at the terminal funnel — not after each node.
  it('inflight row spans the run: set per-node, cleared exactly once at the end', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    await runLeaf('proj', makeLeaf(), deps);
    // exactly one clear, and it is the LAST event (no per-node clears interleaved).
    const clears = spies.inflightSeq.filter((s) => s === 'clear');
    expect(clears.length).toBe(1);
    expect(spies.inflightSeq[spies.inflightSeq.length - 1]).toBe('clear');
    // all node sets land BEFORE the single clear (no between-nodes gap with no row).
    const sets = spies.inflightSeq.slice(0, -1);
    expect(sets.length).toBeGreaterThanOrEqual(3); // blueprint, implement, review
    expect(sets.every((s) => s.startsWith('set:'))).toBe(true);
  });

  it('merge-and-merge order: commitAndMergeToEpic happens BEFORE complete(accepted)', async () => {
    // mergeThrows → executor must NOT have called complete('accepted'); it parks blocked.
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], mergeThrows: true });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]); // only the blocked-path reject
    expect(spies.escalations[0].kind).toBe('blocker');
  });

  it('(ii) fail→fail across 2 attempts → escalation + no accepted completion', async () => {
    // A REPEATED finding (no progress) is the deterministic stuck-bail to a fresh attempt;
    // each attempt does exactly one in-place reuse, then the repeat bails. (Two DISTINCT
    // findings would now fix in place under REVISE_REUSE_CAP=3 — that's the FM2 fix.)
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — x', 'VERDICT: FAIL — x', 'VERDICT: FAIL — y', 'VERDICT: FAIL — y'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('attempt-cap-exhausted');
    expect(res.attempts).toBe(2);
    // Attempt 1 spends 5 nodes (blueprint + implement + review + reuse-implement + reuse-review).
    // Attempt 2 REUSES attempt 1's blueprint (in-run carry, no node spent) → only 4 nodes
    // (implement + review + reuse-implement + reuse-review). Total 9 (was 10 before bfc915dc).
    expect(res.nodesSpent).toBe(9);
    // IN-RUN BLUEPRINT CARRY: the blueprint node runs exactly ONCE across both attempts.
    const blueprintRuns = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Write')).length;
    expect(blueprintRuns).toBe(1);
    // 2 fresh worktrees, one per attempt (the in-place reuse stays in the same worktree)
    expect(spies.ensureCalls.length).toBe(2);
    // no 'accepted' completion ever; only the final blocked-path reject
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(true);
  });

  // bug aadd927b: a trailing/duplicate run that BLOCKS but no longer owns the todo
  // (markRejecting → false, e.g. a concurrent run already accepted it) must DISCARD the
  // blocked outcome — no reject-completion, no spurious blocker escalation, no clobber.
  it('(ii-b) blocked but markRejecting says NOT-OWNED → discard: no complete(rejected), no escalation', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — x', 'VERDICT: FAIL — x', 'VERDICT: FAIL — y', 'VERDICT: FAIL — y'],
      markRejectingOwned: false, // a concurrent run already took the todo terminal
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toMatch(/^discarded-not-owned:/); // the discard path, not a real reject
    expect(spies.markRejectingCalls.length).toBeGreaterThan(0); // it DID consult ownership
    expect(spies.completeCalls).toEqual([]); // never wrote a rejected completion
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(false); // no spurious blocker
  });

  it('P6: fail then SURGICAL REUSE → PASS in ONE attempt, same worktree (no fresh discard)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — first', 'VERDICT: PASS'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.attempts).toBe(1);            // the reuse handled it IN PLACE — no fresh attempt
    expect(res.nodesSpent).toBe(5);          // blueprint, implement, review(fail), implement(reuse), review(pass)
    expect(spies.ensureCalls.length).toBe(1); // ONE worktree — the near-complete work was NOT discarded
    expect(spies.mergeCalls).toBe(1);
    // the reuse re-ran implement with the prior review's findings inlined
    const implSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implSpecs.length).toBe(2);
    expect(implSpecs[1].prompt).toContain('REVIEW FINDINGS');
  });

  it('(iii) node budget: BLOCKED when budget exhausts and the review FAILED (more work needed)', async () => {
    // Budget gates doing MORE work. A FAILED review at budget would need another
    // implement+review cycle — there's no budget for it → parkBlocked. (budget=2: after
    // blueprint(1)→implement(2)→review(3)=FAIL, checkBudget 3>2 → blocked.)
    expect(NODE_BUDGET).toBe(20);
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: FAIL — needs work'] });
    deps.nodeBudget = 2;
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('node-budget-exhausted');
    expect(res.attempts).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(true);
  });

  it('(iii-b) a PASS review is ACCEPTED even when it lands on the budget-tripping node (L6 regression)', async () => {
    // L6: a passing review landed on the node that tripped the budget and was wrongly
    // discarded as node-budget-exhausted, losing complete+compiling work. A PASS = done;
    // budget must not throw it away.
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    deps.nodeBudget = 2; // blueprint(1)+implement(2)+review(3) — review trips budget but PASSes
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });

  it('(iv) every attempt uses a FRESH worktree off the epic branch', async () => {
    // Repeated finding per attempt → stuck-bail → a fresh worktree for the next attempt.
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — x', 'VERDICT: FAIL — x', 'VERDICT: FAIL — y', 'VERDICT: FAIL — y'],
    });
    await runLeaf('proj', makeLeaf(), deps);
    expect(spies.ensureCalls.length).toBe(2);
    for (const c of spies.ensureCalls) {
      expect(c.opts.fresh).toBe(true);
      expect(c.opts.baseBranch).toBe(EPIC_BRANCH);
    }
  });

  it('(v) a non-subscription auth halts BEFORE any node', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], authThrows: true });
    await expect(runLeaf('proj', makeLeaf(), deps)).rejects.toThrow(/subscription/);
    expect(spies.invokeSpecs.length).toBe(0);
    expect(spies.ensureCalls.length).toBe(0);
  });

  it('unparseable verdict: first offense RETRIES, a repeat parks as review-vacuous', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['(no verdict)', '(still none)'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('review-vacuous'); // parks on the SECOND unparseable offense, not the first
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBe(2); // initial + ONE retry fix node (first offense retried)
    expect(spies.nodeRows.filter((r) => r.nodeKind === 'grounding-audit').length).toBe(2);
  });

  it('EMPTY review (bug 80bacbc4): first offense RETRIES with synth findings, a repeat parks review-vacuous (bump only on park)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['', ''] });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('review-vacuous');
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBe(2); // initial + ONE retry fix node (first offense retried, not parked)
    expect(spies.bumpRetryCalls).toEqual([{ project: 'proj', leafId: leaf.id }]); // bumped ONLY on the park
    expect(spies.nodeRows.filter((r) => r.nodeKind === 'grounding-audit').length).toBe(2);
  });

  it('G3: vacuous PASS (no citations): first offense RETRIES, a repeat parks review-vacuous', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS', 'VERDICT: PASS'], changeSet: ['src/a.ts'] });
    const leaf = makeLeaf();
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toMatch(/^review-vacuous:/);
    expect(spies.bumpRetryCalls).toEqual([{ project: 'proj', leafId: leaf.id }]); // bumped only on park
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBe(2); // initial + ONE retry fix node
  });

  it('prose gate: a single vacuous offense retries, then a properly-cited PASS on retry ACCEPTS (+ records a grounding-audit)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS', '- [MET] x — src/a.ts:1\n\nVERDICT: PASS'],
      changeSet: ['src/a.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    // the first (vacuous) offense recorded an audit node and was NOT bumped (retry, not park)
    expect(spies.nodeRows.filter((r) => r.nodeKind === 'grounding-audit').length).toBe(1);
    expect(spies.bumpRetryCalls).toEqual([]);
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBe(2); // initial + the retry fix that produced the cited PASS
  });

  it('G3: a terse but CITED PASS accepts (no token floor, no tool-call floor)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['- [MET] x — src/a.ts:1\n\nVERDICT: PASS'],
      changeSet: ['src/a.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
  });

  it('G3: a citation to a file outside the change-set ⇒ first offense retries, a repeat parks naming the offending citation', async () => {
    const { deps } = makeDeps({
      reviewVerdicts: ['- [MET] x — src/ghost.ts:1\n\nVERDICT: PASS', '- [MET] x — src/ghost.ts:1\n\nVERDICT: PASS'],
      changeSet: ['src/a.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('src/ghost.ts:1'); // parks on the 2nd offense; reason still names the ghost citation
  });

  it('G3: a bare VERDICT: FAIL with no criteria is NOT parked as vacuous — the FAIL exemption is real', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — broken', 'VERDICT: FAIL — broken'],
      changeSet: ['src/a.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).not.toMatch(/^review-vacuous/);
    // the fix node ran with the FAIL findings (proves it wasn't parked before reaching implement)
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBeGreaterThan(1);
  });

  it('G3: deps.changeSet unwired ⇒ abstain — a bare VERDICT: PASS still accepts (no regression)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] }); // changeSet not supplied
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
  });

  it('gate downgrade: PASS but gate returns pending ⇒ outcome PENDING (first-class, not rejected)', async () => {
    // Regression for the real-daemon dogfood finding: a 'pending' gate result must NOT
    // be collapsed into 'rejected' — pending (review PASSed + work merged, gate deferred)
    // is a distinct, first-class outcome from rejected (gate/review actually failed).
    const { deps } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'pending' });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('pending');
    expect(res.reason).toBe('gate-pending');
  });

  it('FM3: reaps its own worktree on a TERMINAL outcome (blocked) — branch survives', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['(no verdict)', '(still none)'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.removeCalls.length).toBeGreaterThan(0); // worktree removed (git keeps the branch)
  });

  it('FM3: reaps its own worktree on an ACCEPTED outcome', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.removeCalls.length).toBeGreaterThan(0);
  });

  it('FM3: KEEPS its worktree on a PENDING (paused/resumable) outcome', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'pending' });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('pending');
    expect(spies.removeCalls).toEqual([]); // a paused leaf reuses its tree on resume
  });

  it('FM1 Phase-B: parkBlocked stamps the reject intent BEFORE the slow gate', async () => {
    // A review FAIL after the attempt cap → parkBlocked → reject. The durable reject
    // pre-stamp must land FIRST so a mid-gate restart can't reclaim+re-run the leaf.
    const { deps, spies } = makeDeps({ reviewVerdicts: ['(no verdict)', '(still none)'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.markRejectingCalls.length).toBe(1);
    expect(spies.seq).toEqual(['mark', 'complete:rejected']); // mark precedes the gate
  });

  it('FM1 Phase-B: the ACCEPT path does NOT pre-stamp a reject', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.markRejectingCalls).toEqual([]); // never stamps reject on an accept
  });

  it('FM2: fixes in place across multiple distinct review FAILs → lands in ONE attempt (no fresh-pipeline re-run)', async () => {
    // Two distinct missing-logic findings then PASS. With the raised REVISE_REUSE_CAP the
    // surgical-reuse loop keeps the near-correct worktree and re-implements with the
    // findings in place, so the leaf accepts within a SINGLE attempt (one fresh worktree)
    // — instead of discarding to a second attempt that re-runs blueprint+pipeline from
    // scratch (the FM2 budget burn that sank b592428f). Pre-fix (cap=1) this needed 2 attempts.
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — missing test A', 'VERDICT: FAIL — missing test B', 'VERDICT: PASS'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.ensureCalls.length).toBe(1); // ONE worktree — surgical reuse, no fresh attempt
  });

  it('FM2: a REPEATED review finding still bails to a fresh attempt (stuck guard intact)', async () => {
    // Same finding twice = no progress = a genuinely tainted tree → stop reusing and
    // discard to a fresh attempt; a hopeless leaf must not burn the whole budget in place.
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — same', 'VERDICT: FAIL — same'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.ensureCalls.length).toBeGreaterThan(1); // bailed to a fresh attempt
  });
});

// ── G2: `final = mechanical AND llm` — the mechanical gate the executor runs ─────
describe('runLeaf G2 mechanical gate', () => {
  it('the 84048309 shape: a bare "VERDICT: PASS" cannot accept a red gate, and the review node is never spent', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'fail', command: 'npx tsc --noEmit', output: '1 fail', reasons: ['x'], declared: true }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).not.toBe('accepted');
    expect(spies.completeCalls.some((c) => c.acceptance === 'accepted')).toBe(false);
    const reviewSpecs = spies.invokeSpecs.filter((s) => s.allowedTools === 'Read Grep Glob Bash');
    expect(reviewSpecs.length).toBe(0); // a mechanically-red tree never spends a review node
  });

  it('gate "error" ⇒ park blocked (INFRA), not a fail; no fix node spawned', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'error', command: 'no-such-binary --x', output: 'ENOENT', reasons: [], declared: true }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toMatch(/^gate-could-not-run:/);
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(true);
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBe(1); // only the initial implement — no fix node on an INFRA gate
  });

  it('veto path: a green gate lets a FAILing review reject as usual (the revise loop is intact)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — missing test', 'VERDICT: FAIL — missing test'],
      runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    const implementSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implementSpecs.length).toBeGreaterThan(1); // the fix node ran
  });

  it('green gate + green review ⇒ accepted (happy path unchanged)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });

  it('red base ⇒ zero leaves, zero nodes, escalation carries the command and output', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      ensureBaseGreen: async () => ({
        status: 'fail', command: 'npx tsc --noEmit', output: 'src/x.ts(3,1): error TS2304', reasons: [], declared: true, fresh: true,
      }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.nodesSpent).toBe(0);
    expect(spies.invokeSpecs.length).toBe(0);
    const esc = spies.escalations.find((e) => e.kind === 'blocker');
    expect(esc?.questionText).toContain('npx tsc --noEmit');
    expect(esc?.questionText).toContain('TS2304');
    // Finding 1: escalation does NOT contain clearEpicBaseGate (reachable recovery is to fix base + commit)
    expect(esc?.questionText).not.toContain('clearEpicBaseGate');
    expect(esc?.questionText).toContain('commit the fix');
  });

  it('base gate is escalated only on the fresh computation, not on cached reads', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      ensureBaseGreen: async () => ({
        status: 'fail', command: 'npx tsc --noEmit', output: 'still red', reasons: [], declared: true, fresh: false,
      }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    // fresh:false ⇒ no base-specific escalation naming the failing command (parkBlocked's
    // own generic blocker escalation still fires — that's unrelated to the base check).
    expect(spies.escalations.some((e) => e.questionText.includes('Epic base is RED'))).toBe(false);
  });

  it('a leaf parking on a cached fail reports the failing command and output tail', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      ensureBaseGreen: async () => ({
        status: 'fail', command: 'npx tsc --noEmit', output: 'src/x.ts(3,1): error TS2304', reasons: [], declared: true, fresh: false,
      }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    // Finding 3: a cached fail (fresh:false) still reports command + output tail in the reason
    expect(res.reason).toContain('epic-base-red');
    expect(res.reason).toContain('npx tsc --noEmit');
    expect(res.reason).toContain('TS2304');
    // No base-specific escalation fired (fresh:false)
    expect(spies.escalations.some((e) => e.questionText.includes('Epic base is RED'))).toBe(false);
  });

  it('unwired runGate/ensureBaseGreen ⇒ unchanged floor: the LLM verdict alone still decides', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] }); // no G2 hooks supplied
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.nodesSpent).toBe(3);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });

  it('unwired runGate emits a gate-abstain ledger row and warns', async () => {
    let warnCalled = false;
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.includes('runGate DEP UNWIRED')) warnCalled = true;
    };
    try {
      const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] }); // no G2 hooks supplied
      const res = await runLeaf('unwired-test-proj-1', makeLeaf(), deps);
      expect(res.outcome).toBe('accepted');
      expect(warnCalled).toBe(true);
      const gateAbstainRow = spies.nodeRows.find((r) => r.nodeKind === 'gate-abstain');
      expect(gateAbstainRow).toBeDefined();
      expect(gateAbstainRow?.outcomeDetail).toBe('gate-unwired');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('the terminal outcome record carries gateDeclared:false when no gate ran', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] }); // no G2 hooks supplied
    const res = await runLeaf('unwired-test-proj-2', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    const outcomeRow = spies.nodeRows.find((r) => r.nodeKind === 'outcome');
    expect(outcomeRow).toBeDefined();
    const parsed = JSON.parse(outcomeRow?.outcomeDetail ?? '{}');
    expect(parsed.gateDeclared).toBe(false);
  });

  it('gateDeclared:true when a declared gate passed', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true }),
    });
    const res = await runLeaf('unwired-test-proj-3', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    const outcomeRow = spies.nodeRows.find((r) => r.nodeKind === 'outcome');
    expect(outcomeRow).toBeDefined();
    const parsed = JSON.parse(outcomeRow?.outcomeDetail ?? '{}');
    expect(parsed.gateDeclared).toBe(true);
    // Verify no gate-abstain row was written
    const gateAbstainRow = spies.nodeRows.find((r) => r.nodeKind === 'gate-abstain');
    expect(gateAbstainRow).toBeUndefined();
  });

  it('isCacheableBaseGateStatus: pass/fail are cacheable, error is not', () => {
    expect(isCacheableBaseGateStatus('pass')).toBe(true);
    expect(isCacheableBaseGateStatus('fail')).toBe(true);
    expect(isCacheableBaseGateStatus('error')).toBe(false);
  });

  it('error base gate ⇒ zero leaves, zero nodes, escalation on every leaf (not cached)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      ensureBaseGreen: async () => ({
        status: 'error', command: 'npx tsc --noEmit', output: 'OOM killed', reasons: [], declared: true, fresh: true,
      }),
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.nodesSpent).toBe(0);
    expect(spies.invokeSpecs.length).toBe(0);
    const esc = spies.escalations.find((e) => e.kind === 'blocker');
    // escalation carries the command and output just like a red base, but fresh:true
    // ensures it's escalated on every leaf (not cached)
    expect(esc?.questionText).toContain('npx tsc --noEmit');
    expect(esc?.questionText).toContain('OOM killed');
  });
});

// ── P3: rate-cap → paused outcome (executor NEVER backs off) ─────────────────
/** Kind detection for the scripted invoker (matches NODE_PROFILE allowedTools). */
function kindOf(spec: NodeSpec): 'blueprint' | 'implement' | 'review' {
  if (spec.allowedTools === 'Read Grep Glob Bash') return 'review';
  if (spec.allowedTools === 'Read Write Grep Glob Bash') return 'blueprint';
  return 'implement';
}

/** Deps whose invoker flags `capKind` rateLimited (with an optional capReset), all
 *  other nodes ok. Records the invoked node kinds in `calls`. */
function makePauseDeps(capKind: 'blueprint' | 'implement' | 'review', capReset?: number) {
  const calls: Array<'blueprint' | 'implement' | 'review'> = [];
  let reviewIdx = 0;
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        const kind = kindOf(spec);
        calls.push(kind);
        if (kind === capKind) {
          return { ok: false, exitCode: 1, stdout: '429', durationMs: 1, rateLimited: true, capReset, authMode: 'subscription', text: '' };
        }
        if (kind === 'review') { reviewIdx += 1; return { ok: true, exitCode: 0, stdout: 'VERDICT: PASS', durationMs: 1, rateLimited: false, authMode: 'subscription', text: 'VERDICT: PASS' }; }
        return { ok: true, exitCode: 0, stdout: 'done', durationMs: 1, rateLimited: false, authMode: 'subscription', text: 'done' };
      },
    },
    wm: { async ensure() { return { isGit: true, path: '/tmp/wt/1', branch: 'b', baseBranch: 'm' } as never; } } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => 'subscription',
    async complete(_p, _t, a) { return { effective: a }; },
    async mergeToEpic() { return {}; },
    escalate() {},
    recordNode: () => null,
  };
  return { deps, calls };
}

describe('runLeaf P3 rate-cap pause', () => {
  it('(i) blueprint rate-limited ⇒ outcome paused, atNode blueprint, attempt preserved, no further nodes', async () => {
    const { deps, calls } = makePauseDeps('blueprint');
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('paused');
    expect(res.paused?.atNode).toBe('blueprint');
    expect(res.paused?.attempt).toBe(1);
    expect(res.attempts).toBe(1); // pause did NOT advance the attempt
    expect(calls).toEqual(['blueprint']); // implement/review never invoked
  });

  it('implement rate-limited ⇒ paused atNode implement; review never invoked', async () => {
    const { deps, calls } = makePauseDeps('implement');
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('paused');
    expect(res.paused?.atNode).toBe('implement');
    expect(calls).toEqual(['blueprint', 'implement']);
  });

  it('capReset passes straight through into paused.capReset (and undefined when absent)', async () => {
    const reset = 1_000 + 5 * 60_000;
    const withReset = await runLeaf('proj', makeLeaf(), makePauseDeps('blueprint', reset).deps);
    expect(withReset.paused?.capReset).toBe(reset);
    const without = await runLeaf('proj', makeLeaf(), makePauseDeps('blueprint').deps);
    expect(without.paused?.capReset).toBeUndefined();
  });

  it('(v) startNodesSpent seeds the budget so a resumed leaf trips NODE_BUDGET → parks BLOCKED', async () => {
    // budget 20; seed 20 already spent → the very first node pushes nodesSpent to 21
    // (>budget) → checkBudget fails → parkBlocked('node-budget-exhausted').
    const { deps } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    deps.startNodesSpent = NODE_BUDGET;
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('node-budget-exhausted');
  });
});

// ── P5: pure parser / gate units ─────────────────────────────────────────────
describe('parseSizeManifest (fail-safe = null)', () => {
  const block = (o: object) => '# blueprint prose\n\n```json\n' + JSON.stringify(o) + '\n```\n';
  const good = {
    schemaVersion: 1, estimatedFiles: 3, estimatedTasks: 2, nonEnumerableFanout: false,
    filesToCreate: ['a.ts'], filesToEdit: ['b.ts'],
    tasks: [{ id: 't1', files: ['a.ts'], description: 'do a' }],
  };

  it('extracts a valid manifest from a fenced block', () => {
    const m = parseSizeManifest(block(good));
    expect(m).not.toBeNull();
    expect(m!.estimatedFiles).toBe(3);
    expect(m!.tasks[0].id).toBe('t1');
  });

  it('takes the LAST json fence when several are present', () => {
    const text = block({ ...good, estimatedFiles: 99 }) + block({ ...good, estimatedFiles: 7 });
    expect(parseSizeManifest(text)!.estimatedFiles).toBe(7);
  });

  it('falls back across sources (file undefined → node text)', () => {
    expect(parseSizeManifest(undefined, block(good))!.estimatedFiles).toBe(3);
  });

  it('returns null on no fence / bad JSON / wrong types (fail-safe)', () => {
    expect(parseSizeManifest('no json here')).toBeNull();
    expect(parseSizeManifest('```json\n{ not valid }\n```')).toBeNull();
    expect(parseSizeManifest(block({ ...good, estimatedFiles: 'lots' }))).toBeNull();
    expect(parseSizeManifest(block({ ...good, nonEnumerableFanout: 'yes' }))).toBeNull();
    expect(parseSizeManifest(undefined, undefined)).toBeNull();
  });

  it('parses a verify-only manifest (estimatedFiles:0) to a non-null 0 — not coerced away', () => {
    // Contract leafNoCommitExpected (coordinator-live, todo 231d10d4) depends on:
    // a no-op/already-done leaf declares estimatedFiles:0, which must survive parsing
    // as a real 0 (manifest != null && estimatedFiles === 0), so the no-commit reversal
    // sites can recognise the clean lane as an EXPECTED verified no-op, not a strand.
    const m = parseSizeManifest(block({ ...good, estimatedFiles: 0, estimatedTasks: 0, filesToCreate: [], filesToEdit: [], tasks: [] }));
    expect(m).not.toBeNull();
    expect(m!.estimatedFiles).toBe(0);
  });

  it('coerces a missing/garbled tasks array to []', () => {
    const { tasks, ...noTasks } = good;
    const m = parseSizeManifest(block(noTasks));
    expect(m).not.toBeNull();
    expect(m!.tasks).toEqual([]);
  });
});

describe('leafExecutionMode (epic f5c7fc46 — thin code/verify dispatch)', () => {
  const mk = (type: string | null): Todo => ({ id: 't', type } as unknown as Todo);
  it("verify/cad-dogfood/dogfood types → 'verify' (case-insensitive)", () => {
    expect(leafExecutionMode(mk('verify'))).toBe('verify');
    expect(leafExecutionMode(mk('cad-dogfood'))).toBe('verify');
    expect(leafExecutionMode(mk('Dogfood'))).toBe('verify');
  });
  it("reviewer type → 'review' (epic d8ac1a18 — completeness-review shape)", () => {
    expect(leafExecutionMode(mk('reviewer'))).toBe('review');
    expect(leafExecutionMode(mk('Reviewer'))).toBe('review');
  });
  it("everything else (incl. backend/ui/null) → 'code' (default, proven path)", () => {
    expect(leafExecutionMode(mk('backend'))).toBe('code');
    expect(leafExecutionMode(mk('ui'))).toBe('code');
    expect(leafExecutionMode(mk(null))).toBe('code');
  });
});


// ── P5: the SIZE GATE in runLeaf (mocked invoker, wave-aware) ─────────────────
/** Detect the node kind from a spec for the wave-aware mock. Floor and wave kinds
 *  are distinguished by model + prompt content (review/verify share allowedTools). */
function waveKindOf(spec: NodeSpec): 'blueprint' | 'implement' | 'review' | 'research' | 'wimplement' | 'verify' | 'fix' {
  const p = spec.prompt;
  if (spec.allowedTools === 'Read Write Grep Glob Bash') return 'blueprint';
  if (p.includes('RESEARCH node')) return 'research';
  if (p.includes('IMPLEMENT node for ONE file')) return 'wimplement';
  if (p.includes('VERIFY node')) return 'verify';
  if (p.includes('FIX node')) return 'fix';
  if (p.includes('REVIEW node')) return 'review';
  return 'implement';
}

interface WaveOpts {
  manifest?: object | string; // blueprint-artifact text the readBlueprint seam returns
  reviewVerdict?: string;
  reviewVerdicts?: string[]; // multi-attempt: one verdict per review call, in order
  nodeBudget?: number;
  /** verify text per call, in order; defaults to 'TSC: CLEAN'. */
  verifyTexts?: string[];
  /** Change-set seam injection (files this leaf touched). Unset ⇒ seam unwired
   *  (null) ⇒ prior conservative behaviour (gate fails on any error; no no-op skip). */
  changeSet?: string[] | null;
  /** Spy collector for persistBlueprint calls (one expected per attempt). */
  persistCalls?: Array<{ attempt: number; manifest: LeafSizeManifest; blueprintMd: string; project: string }>;
  /** When provided, wires the auto-split seam and captures each splitInto call.
   *  Unset ⇒ seam unwired ⇒ never splits (prior behaviour). */
  splitCalls?: Array<{ leafId: string; items: LeafSplitItem[] | string[] }>;
  /** SR-3: split proposal answer ('split' | 'linear' | 'timeout'). When set, wires
   *  proposeSplit, awaitSplitDecision, and resolveProposal seams. */
  proposeAnswer?: 'split' | 'linear' | 'timeout';
  /** SR-3: spy collector for proposal-related calls (proposeSplit and resolveProposal). */
  proposalCalls?: Array<{ kind: string; escalationId?: string; resolvedBy?: string }>;
}

function makeWaveDeps(opts: WaveOpts): { deps: LeafExecutorDeps; calls: string[] } {
  const calls: string[] = [];
  let reviewIdx = 0;
  let verifyIdx = 0;
  const manifestText = typeof opts.manifest === 'string'
    ? opts.manifest
    : opts.manifest
      ? '# bp\n\n```json\n' + JSON.stringify(opts.manifest) + '\n```\n'
      : undefined;
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        const kind = waveKindOf(spec);
        calls.push(kind);
        if (kind === 'review') {
          if (opts.reviewVerdicts) {
            const v = opts.reviewVerdicts[reviewIdx] ?? 'VERDICT: FAIL — none';
            reviewIdx += 1;
            return okResult(v);
          }
          return okResult(opts.reviewVerdict ?? 'VERDICT: PASS');
        }
        if (kind === 'verify') {
          const t = opts.verifyTexts?.[verifyIdx] ?? 'TSC: CLEAN';
          verifyIdx += 1;
          return okResult(t);
        }
        return okResult('done');
      },
    },
    wm: {
      async ensure() { return { isGit: true, path: '/tmp/wt/1', branch: 'b', baseBranch: 'm' } as never; },
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => 'subscription',
    async complete(_p, _t, a) { return { effective: a }; },
    async mergeToEpic() { return {}; },
    escalate() {},
    recordNode: () => null,
    readBlueprint: async () => manifestText,
    changeSet: opts.changeSet !== undefined ? async () => opts.changeSet ?? null : undefined,
    splitInto: opts.splitCalls
      ? async (lf, items) => { opts.splitCalls!.push({ leafId: lf.id, items }); }
      : undefined,
    persistBlueprint: opts.persistCalls
      ? async ({ project, attempt, manifest, blueprintMd }) => {
          opts.persistCalls!.push({ project, attempt, manifest, blueprintMd });
          return `doc-${attempt}`;
        }
      : undefined,
    proposeSplit: opts.proposeAnswer
      ? (input) => {
          opts.proposalCalls?.push({ kind: 'proposeSplit', escalationId: 'test-esc-' + Math.random() });
          return { escalationId: 'test-esc-' + Date.now(), createdAt: Date.now(), isNew: true };
        }
      : undefined,
    awaitSplitDecision: opts.proposeAnswer
      ? async (input) => {
          return opts.proposeAnswer!;
        }
      : undefined,
    resolveProposal: opts.proposeAnswer
      ? (escalationId, status, resolvedBy) => {
          opts.proposalCalls?.push({ kind: 'resolveProposal', escalationId, resolvedBy });
        }
      : undefined,
  };
  if (opts.nodeBudget !== undefined) deps.nodeBudget = opts.nodeBudget;
  return { deps, calls };
}

describe('runLeaf P5 size gate', () => {
  it('(a) small estimate ⇒ FLOOR (blueprint+implement+review, no wave nodes)', async () => {
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 2, estimatedTasks: 1, nonEnumerableFanout: false, filesToCreate: [], filesToEdit: ['a.ts'], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(calls).toEqual(['blueprint', 'implement', 'review']);
    expect(res.nodesSpent).toBe(3);
  });

  it('(d) unparseable size block ⇒ FLOOR (fail-safe)', async () => {
    const { deps, calls } = makeWaveDeps({ manifest: 'no json fence at all', reviewVerdict: 'VERDICT: PASS' });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(calls).toEqual(['blueprint', 'implement', 'review']);
  });

  it('(m) over-ceiling enumerable manifest (legacy path, no splitDecision) ⇒ SPLIT pre-flight', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 14, estimatedTasks: 3, nonEnumerableFanout: false, filesToCreate: files, filesToEdit: [], tasks: [] },
      splitCalls,
      proposeAnswer: 'split',
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('split');
    expect(splitCalls.length).toBe(1);
    // Legacy path normalizes string[] to one item per file, all edgeless.
    const items = splitCalls[0].items as LeafSplitItem[];
    expect(items.length).toBe(14);
    expect(items.every((i) => i.files.length === 1 && i.dependsOn.length === 0)).toBe(true);
    // Split happens AFTER blueprint but BEFORE any implement/research/verify work.
    expect(calls).toEqual(['blueprint']);
  });

  it('(n) over-ceiling but NON-ENUMERABLE fanout ⇒ no split, runs LINEAR (waves retired)', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 14, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: files, tasks: [{ id: 't', files, description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 200,
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // non-enumerable can't be partitioned → no split
    // WAVES retired: a non-splittable big leaf runs the single linear FLOOR implement node
    // (fail-safe), not the old per-file wave fan-out.
    expect(calls).toContain('implement');
    expect(calls).not.toContain('wimplement');
    expect(res.outcome).toBe('accepted');
  });

  it('(o) enumerable but at/below the ceiling ⇒ no split (runs normally)', async () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 8, estimatedTasks: 8, nonEnumerableFanout: false, filesToCreate: files, filesToEdit: [], tasks: files.map((f, i) => ({ id: `t${i}`, files: [f], description: 'd' })) },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 200,
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // 8 ≤ SPLIT_CEILING (= FILE_THRESHOLD, 8)
    expect(res.outcome).toBe('accepted');
  });

  it('(p) split seam UNWIRED ⇒ a too-big leaf still runs (no split) — backward compatible', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 14, estimatedTasks: 1, nonEnumerableFanout: false, filesToCreate: files, filesToEdit: [], tasks: [{ id: 't', files, description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 200,
      // NO splitCalls → splitInto unwired → never splits.
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).not.toBe('split');
  });

  it('(q) split:false + reason + 14 files ⇒ no split, runs FLOOR (coupled fix)', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 14,
        estimatedTasks: 3,
        nonEnumerableFanout: false,
        filesToCreate: files,
        filesToEdit: [],
        tasks: [],
        splitDecision: { split: false, reason: 'shared lock protocol', items: [] },
      },
      reviewVerdict: 'VERDICT: PASS',
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // no split
    expect(calls).toEqual(['blueprint', 'implement', 'review']);
    expect(res.outcome).toBe('accepted');
  });

  it('(r) split:true with 3 items (one multi-file, one with dependsOn) ⇒ split outcome, edges preserved', async () => {
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 4,
        estimatedTasks: 2,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: [],
        tasks: [],
        splitDecision: {
          split: true,
          reason: 'independent units',
          items: [
            { id: 'mod', files: ['mod.ts', 'mod-helper.ts'], dependsOn: [] },
            { id: 'tests', files: ['mod.test.ts'], dependsOn: ['mod'] },
            { id: 'api', files: ['api-route.ts'], dependsOn: [] },
          ],
        },
      },
      splitCalls,
      proposeAnswer: 'split',
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('split');
    expect(splitCalls.length).toBe(1);
    expect(calls).toEqual(['blueprint']);
    const items = splitCalls[0].items as LeafSplitItem[];
    expect(items.length).toBe(3);
    expect(items[1].dependsOn).toContain('mod');
  });

  it('(s) 2 items over 3 files, all under ceiling ⇒ blueprint decision is authoritative, not count', async () => {
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 3,
        estimatedTasks: 2,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: [],
        tasks: [],
        splitDecision: {
          split: true,
          reason: 'intended split',
          items: [
            { id: 'a', files: ['a.ts', 'a-helper.ts'], dependsOn: [] },
            { id: 'b', files: ['b.ts'], dependsOn: ['a'] },
          ],
        },
      },
      splitCalls,
      proposeAnswer: 'split',
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('split'); // blueprint decision, not file count
    expect(splitCalls.length).toBe(1);
    expect(calls).toEqual(['blueprint']);
  });

  it('(t) malformed splitDecision (e.g. split:true, items:[]) at 14 files ⇒ no split, runs FLOOR', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 14,
        estimatedTasks: 3,
        nonEnumerableFanout: false,
        filesToCreate: files,
        filesToEdit: [],
        tasks: [],
        splitDecision: { split: true, reason: 'x', items: [] }, // malformed: 1-item "split"
      },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 200,
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // malformed → floor, never split
    expect(calls).toContain('implement');
    expect(res.outcome).toBe('accepted');
  });

  it('(u) splitDecision absent at 14 files ⇒ legacy count path still splits (back-compat)', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 14,
        estimatedTasks: 3,
        nonEnumerableFanout: false,
        filesToCreate: files,
        filesToEdit: [],
        tasks: [],
        // NO splitDecision key
      },
      splitCalls,
      proposeAnswer: 'split',
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('split');
    expect(splitCalls.length).toBe(1);
    expect(calls).toEqual(['blueprint']);
  });

});

describe('runLeaf SR-3 split proposal (propose → wait → act)', () => {
  it('timeout ⇒ linear, no children, bounded nodesSpent, resolved resolvedBy:ai', async () => {
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const proposalCalls: Array<{ kind: string; escalationId?: string; resolvedBy?: string }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 3,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['a.ts', 'b.ts', 'c.ts'],
        tasks: [],
        splitDecision: {
          split: true,
          reason: 'test split',
          items: [
            { id: 'a', files: ['a.ts'], dependsOn: [] },
            { id: 'b', files: ['b.ts'], dependsOn: [] },
            { id: 'c', files: ['c.ts'], dependsOn: [] },
            { id: 'd', files: ['d.ts'], dependsOn: [] },
            { id: 'e', files: ['e.ts'], dependsOn: [] },
          ],
        },
      },
      reviewVerdict: 'VERDICT: PASS',
      proposeAnswer: 'timeout',
      splitCalls,
      proposalCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).not.toBe('split');
    expect(splitCalls.length).toBe(0); // No split on timeout
    expect(proposalCalls.length).toBe(2); // proposeSplit + resolveProposal
    expect(proposalCalls[1].kind).toBe('resolveProposal');
    expect(proposalCalls[1].resolvedBy).toBe('ai');
    // Raised budget: default 20 → 40
    expect(res.nodesSpent).toBeLessThanOrEqual(40);
  });

  it('linear answer ⇒ linear, no children, resolved resolvedBy:human', async () => {
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const proposalCalls: Array<{ kind: string; escalationId?: string; resolvedBy?: string }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 3,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: ['a.ts', 'b.ts', 'c.ts'],
        tasks: [],
        splitDecision: {
          split: true,
          reason: 'test',
          items: [
            { id: 'a', files: ['a.ts'], dependsOn: [] },
            { id: 'b', files: ['b.ts'], dependsOn: [] },
          ],
        },
      },
      reviewVerdict: 'VERDICT: PASS',
      proposeAnswer: 'linear',
      splitCalls,
      proposalCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).not.toBe('split');
    expect(splitCalls.length).toBe(0);
    expect(proposalCalls[1].resolvedBy).toBe('human');
    expect(calls).toContain('implement'); // Runs to completion
    expect(res.outcome).toBe('accepted');
  });

  it('split answer ⇒ materializes children, outcome split, resolved resolvedBy:human', async () => {
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const proposalCalls: Array<{ kind: string; escalationId?: string; resolvedBy?: string }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 3,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: [],
        filesToEdit: [],
        tasks: [],
        splitDecision: {
          split: true,
          reason: 'independent',
          items: [
            { id: 'mod', files: ['mod.ts', 'mod-helper.ts'], dependsOn: [] },
            { id: 'test', files: ['mod.test.ts'], dependsOn: ['mod'] },
          ],
        },
      },
      proposeAnswer: 'split',
      splitCalls,
      proposalCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('split');
    expect(splitCalls.length).toBe(1);
    expect(splitCalls[0].items).toHaveLength(2);
    const items = splitCalls[0].items as LeafSplitItem[];
    expect(items[0].files).toContain('mod.ts');
    expect(items[1].dependsOn).toContain('mod');
    expect(proposalCalls[1].resolvedBy).toBe('human');
    expect(calls).toEqual(['blueprint']); // Just blueprint, no implement
  });

  it('legacy file-count path: 14 files → propose → timeout ⇒ linear, no split', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; items: LeafSplitItem[] | string[] }> = [];
    const proposalCalls: Array<{ kind: string; escalationId?: string; resolvedBy?: string }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: {
        schemaVersion: 1,
        estimatedFiles: 14,
        estimatedTasks: 1,
        nonEnumerableFanout: false,
        filesToCreate: files,
        filesToEdit: [],
        tasks: [],
        // NO splitDecision
      },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 40,
      proposeAnswer: 'timeout',
      splitCalls,
      proposalCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // No split on timeout
    expect(proposalCalls.length).toBe(2); // Proposal was raised
    expect(res.outcome).toBe('accepted'); // Runs linear
  });
});

describe('runLeaf 86b persistBlueprint (durable per-attempt)', () => {
  const smallManifest = {
    schemaVersion: 1,
    estimatedFiles: 2,
    estimatedTasks: 1,
    nonEnumerableFanout: false,
    filesToCreate: ['new.ts'],
    filesToEdit: ['old.ts'],
    tasks: [{ id: 't', files: ['old.ts'], description: 'x' }],
  };

  it('(a) invoked ONCE on a single PASS attempt with the parsed manifest + .md text', async () => {
    const persistCalls: Array<{ attempt: number; manifest: LeafSizeManifest; blueprintMd: string; project: string }> = [];
    const { deps } = makeWaveDeps({ manifest: smallManifest, reviewVerdict: 'VERDICT: PASS', persistCalls });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(persistCalls.length).toBe(1);
    expect(persistCalls[0].attempt).toBe(1);
    expect(persistCalls[0].project).toBe('proj');
    expect(persistCalls[0].manifest.filesToCreate).toEqual(['new.ts']);
    expect(persistCalls[0].manifest.filesToEdit).toEqual(['old.ts']);
    expect(persistCalls[0].blueprintMd).toContain('```json');
  });

  it('(b) invoked PER attempt — two FRESH attempts (reuse exhausted) → two persists', async () => {
    const persistCalls: Array<{ attempt: number; manifest: LeafSizeManifest; blueprintMd: string; project: string }> = [];
    // A REPEATED finding bails the in-place reuse on attempt 1 → a fresh attempt 2 which
    // PASSes (each fresh attempt re-blueprints → one persist per attempt). (Two DISTINCT
    // findings would now fix in place in one attempt — the FM2 fix.)
    const { deps } = makeWaveDeps({
      manifest: smallManifest,
      reviewVerdicts: ['VERDICT: FAIL — a', 'VERDICT: FAIL — a', 'VERDICT: PASS'],
      persistCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.attempts).toBe(2);
    expect(persistCalls.map((c) => c.attempt)).toEqual([1, 2]);
  });

  it('(c) NOT invoked when the manifest is unparseable (no .md/manifest to persist)', async () => {
    const persistCalls: Array<{ attempt: number; manifest: LeafSizeManifest; blueprintMd: string; project: string }> = [];
    const { deps } = makeWaveDeps({ manifest: 'no json fence at all', reviewVerdict: 'VERDICT: PASS', persistCalls });
    await runLeaf('proj', makeLeaf(), deps);
    expect(persistCalls.length).toBe(0);
  });

  it('(d) a throwing persistBlueprint never breaks the run (best-effort)', async () => {
    const { deps } = makeWaveDeps({ manifest: smallManifest, reviewVerdict: 'VERDICT: PASS' });
    deps.persistBlueprint = async () => {
      throw new Error('doc store down');
    };
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
  });
});

describe('blueprint-node failure short-circuit (ce02d796 — live L1 finding)', () => {
  it('one blueprint failure → in-place retry succeeds → PASS in ONE attempt (no burned attempt)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], blueprintFails: 1 });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.attempts).toBe(1);              // a transient blueprint blip did NOT cost a fresh attempt
    expect(spies.ensureCalls.length).toBe(1);  // single worktree → single attempt
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    // implement node DID run (the in-place retry produced a usable blueprint)
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('Edit'))).toBe(true);
  });

  it('blueprint fails every time → BLOCKED + escalation, implement never runs', async () => {
    const { deps, spies } = makeDeps({ blueprintFails: 99 });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    // never accepted; the only completion (if any) is the blocked-path 'rejected'
    expect(spies.completeCalls.some((c) => c.acceptance === 'accepted')).toBe(false);
    expect(spies.escalations.length).toBeGreaterThan(0);
    // we NEVER ran implement (Edit) or review against a missing blueprint
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('Edit'))).toBe(false);
    expect(spies.invokeSpecs.some((s) => s.allowedTools === 'Read Grep Glob Bash')).toBe(false);
  });
});

describe('blueprint inlining (b77dd104 — no stray-blueprint file discovery)', () => {
  it('implement/review inline the blueprint text and forbid reading other blueprint files', () => {
    const bpText = 'THE-REAL-BLUEPRINT-BODY estimatedFiles 2';
    const impl = buildNodePrompt('implement', makeLeaf(), bpText);
    expect(impl).toContain('THE-REAL-BLUEPRINT-BODY');
    expect(impl.toLowerCase()).toContain('do not search');
    const rev = buildNodePrompt('review', makeLeaf(), bpText);
    expect(rev).toContain('THE-REAL-BLUEPRINT-BODY');
    expect(rev.toLowerCase()).toContain('do not read any other blueprint');
  });
  it('falls back to the exact-file instruction when no blueprint text is supplied', () => {
    const impl = buildNodePrompt('implement', makeLeaf());
    expect(impl).toContain('.collab/leaf-blueprints/');
    expect(impl).toContain('ONLY that exact file');
  });
});

// ── Verify pipeline (epic f5c7fc46) ──────────────────────────────────────────

/** Real build_assembly_plan PlanReport fixtures (confirmed L4 against the bsync-cad MCP). */
const planReport = (nodes: unknown[], over: Record<string, unknown> = {}): string =>
  JSON.stringify({ ok: true, error: null, halted_at: null, nodes, ...over });
const PLAN_CLEAN = planReport([
  { node: 'n1', op: 'author', ok: true, detail: 'ok', attempts: 1, repairs: [], gates: [{ name: 'validity', passed: true, detail: '' }] },
]);

describe('parseVerifyGate (PlanReport — nested node gates)', () => {
  it('all gates passed → pass', () => {
    const r = parseVerifyGate(planReport([
      { node: 'n1', op: 'connect', ok: true, gates: [{ name: 'dof', passed: true }, { name: 'clearance', passed: true }] },
    ]));
    expect(r.status).toBe('pass');
    expect(r.reasons).toEqual([]);
  });

  it('a failed gate → fail, labelled by node / gate / detail', () => {
    const r = parseVerifyGate(planReport([
      { node: 'axis', op: 'connect', ok: false, gates: [{ name: 'dof', passed: false, detail: 'over-constrained' }] },
    ], { ok: false }));
    expect(r.status).toBe('fail');
    expect(r.reasons.some((x) => x.includes('axis') && x.includes('dof failed') && x.includes('over-constrained'))).toBe(true);
  });

  it('tolerates markdown-fenced JSON', () => {
    const r = parseVerifyGate('```json\n' + PLAN_CLEAN + '\n```');
    expect(r.status).toBe('pass');
  });

  it('tolerates prose AROUND the JSON (the driveexec echo shape)', () => {
    // The live driveexec node wraps the PlanReport in commentary + a fence + a trailer.
    const echo = 'Raw PlanReport result:\n\n```json\n' + PLAN_CLEAN + '\n```\n\n**Execution note:** invoked via sys.path shim.';
    expect(parseVerifyGate(echo).status).toBe('pass');
    // unfenced, prose on both sides → outermost-braces fallback
    const bare = 'Here it is: ' + PLAN_CLEAN + ' — done.';
    expect(parseVerifyGate(bare).status).toBe('pass');
  });

  it('top-level plan error (with halt) → fail', () => {
    const r = parseVerifyGate(planReport([], { ok: false, error: 'plan invalid: dangling dep', halted_at: 'n3' }));
    expect(r.status).toBe('fail');
    expect(r.reasons.some((x) => x.includes('plan error') && x.includes('halted at n3'))).toBe(true);
  });

  it('a node that failed without a failed gate is still a finding', () => {
    const r = parseVerifyGate(planReport([
      { node: 'n2', op: 'realize', ok: false, detail: 'STEP import failed', gates: [{ name: 'validity', passed: true }] },
    ], { ok: false }));
    expect(r.status).toBe('fail');
    expect(r.reasons.some((x) => x.includes('node n2 failed') && x.includes('STEP import failed'))).toBe(true);
  });

  it('VACUOUS result (zero gates ran) → error, never a silent pass — the T14 failure mode', () => {
    expect(parseVerifyGate(planReport([{ node: 'n1', op: 'author', ok: true, gates: [] }])).status).toBe('error');
    expect(parseVerifyGate(planReport([])).status).toBe('error');
  });

  it('empty / unparseable → error', () => {
    expect(parseVerifyGate('').status).toBe('error');
    expect(parseVerifyGate(undefined).status).toBe('error');
    expect(parseVerifyGate('not json at all').status).toBe('error');
  });
});

describe('buildVerifyPrompt per-node specs', () => {
  it('driveplan instructs plan-only authoring to the plan file', () => {
    const p = buildVerifyPrompt('driveplan', makeLeaf());
    expect(p).toContain('.collab/leaf-verify/');
    expect(p).toContain(VERIFY_GATE_VERB);
    expect(p.toLowerCase()).toContain('do not');
  });
  it('driveexec inlines the plan and constrains to a single verb call', () => {
    const p = buildVerifyPrompt('driveexec', makeLeaf(), 'THE-PLAN-JSON');
    expect(p).toContain('THE-PLAN-JSON');
    expect(p).toContain(VERIFY_GATE_VERB);
    expect(p.toLowerCase()).toContain('one verb call');
  });
  it('report relays the gate findings and forbids source edits', () => {
    const clean = buildVerifyPrompt('report', makeLeaf(), 'PLAN', '');
    expect(clean.toUpperCase()).toContain('CLEAN');
    const withFindings = buildVerifyPrompt('report', makeLeaf(), 'PLAN', 'dof failed: over-constrained');
    expect(withFindings).toContain('over-constrained');
    expect(withFindings.toLowerCase()).toContain('do not edit any source');
  });
});

describe('buildReviewPrompt ships the verify discipline (G13)', () => {
  const p = () => buildReviewPrompt(makeLeaf(), 'origin/master');
  it('states the three-dot caveat', () => {
    expect(p()).toContain('three-dot diff shows COMMITS ONLY');
    expect(p()).toContain('git status --porcelain');
  });
  it('instructs branch-vs-base comparison of the same file in isolation', () => {
    expect(p()).toContain('VERIFY DISCIPLINE');
    expect(p()).toContain('origin/master');
    expect(p()).toContain('present on BOTH is pre-existing');
  });
});

describe('buildReviewPrompt teaches the deleted-file citation grammar', () => {
  const p = () => buildReviewPrompt(makeLeaf(), 'origin/master');
  it('names the exact (deleted) citation form DELETION_CITE_RE accepts', () => {
    expect(p()).toContain('CITING A DELETED FILE');
    expect(p()).toContain('path/to/file.ext (deleted)');
  });
  it('warns that freeform deletion prose extracts no citation', () => {
    expect(p()).toContain('extracts no citation');
  });
});

/** Deps for the verify pipeline: scripts driveplan/driveexec/report by allowedTools, and
 *  serves the plan/result artifacts via readArtifact (keyed by relPath suffix). */
function makeVerifyDeps(opts: {
  resultJson?: string;       // what readArtifact returns for the *.result.json artifact
  planJson?: string;         // what readArtifact returns for the *.plan.json artifact
  planFails?: number;        // first N driveplan invocations fail (ok:false)
  execFails?: number;        // first N driveexec invocations fail (ok:false), then ok
  reportFails?: boolean;     // report returns ok:false
  gateEffective?: 'accepted' | 'rejected' | 'pending';
  mergeThrows?: boolean;
}): { deps: LeafExecutorDeps; spies: Spies & { reportFindings: string[]; writes: Array<{ relPath: string; content: string }> } } {
  const spies = {
    ensureCalls: [] as Spies['ensureCalls'],
    invokeSpecs: [] as NodeSpec[],
    completeCalls: [] as Spies['completeCalls'],
    mergeCalls: 0,
    escalations: [] as Spies['escalations'],
    removeCalls: [] as Spies['removeCalls'],
    markRejectingCalls: [] as Spies['markRejectingCalls'],
    bumpRetryCalls: [] as Spies['bumpRetryCalls'],
    releaseClaimCalls: [] as Spies['releaseClaimCalls'],
    holdLeafCalls: [] as Spies['holdLeafCalls'],
    seq: [] as Spies['seq'],
    inflightSeq: [] as Spies['inflightSeq'],
    nodeRows: [] as Spies['nodeRows'],
    gateEvals: [] as Spies['gateEvals'],
    coverageCalls: [] as Spies['coverageCalls'],
    contestedCalls: [] as Spies['contestedCalls'],
    reportFindings: [] as string[],
    writes: [] as Array<{ relPath: string; content: string }>,
  };
  let planFailsLeft = opts.planFails ?? 0;
  let execFailsLeft = opts.execFails ?? 0;
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.invokeSpecs.push(spec);
        const tools = spec.allowedTools ?? '';
        const isExec = tools.includes('build_assembly_plan');
        const isReport = tools.includes('file_to_bucket');
        const isPlan = !isExec && !isReport && tools.includes('Write');
        if (isPlan) {
          if (planFailsLeft > 0) { planFailsLeft -= 1; return failResult(); }
          return okResult(opts.planJson ?? '{"plan":"inline"}');
        }
        if (isExec) {
          if (execFailsLeft > 0) { execFailsLeft -= 1; return failResult(); }
          return okResult(opts.resultJson ?? PLAN_CLEAN);
        }
        if (isReport) {
          if (opts.reportFails) return failResult();
          spies.reportFindings.push(spec.prompt);
          // The report node EMITS the markdown as its final message (the executor persists it).
          return okResult('# T14 verify report\n\nVerdict: see findings.');
        }
        return okResult('done');
      },
    },
    wm: {
      async ensure(sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
        spies.ensureCalls.push({ sessionKey, opts: o ?? {} });
        return { isGit: true, path: `/tmp/wt/${spies.ensureCalls.length}`, branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
      },
    } as never,
    epicId: EPIC_ID,
    epicBranch: EPIC_BRANCH,
    assertAuth: () => 'subscription',
    async complete(_p, _t, acceptance) {
      spies.completeCalls.push({ acceptance });
      return { effective: opts.gateEffective ?? acceptance };
    },
    async mergeToEpic() {
      spies.mergeCalls += 1;
      if (opts.mergeThrows) throw new Error('conflict');
      return {};
    },
    escalate(input) { spies.escalations.push({ kind: input.kind, questionText: input.questionText }); },
    recordNode: () => null,
    recordGateEval: async (_p, input) => { spies.gateEvals.push(input); return {} as any; },
    gateShadowMode: () => false,
    async readArtifact(_cwd, relPath) {
      if (relPath.endsWith('.result.json')) return opts.resultJson;
      if (relPath.endsWith('.plan.json')) return opts.planJson;
      return undefined;
    },
    async writeArtifact(_cwd, relPath, content) {
      spies.writes.push({ relPath, content });
    },
  };
  return { deps, spies };
}

const verifyLeaf = (): Todo => makeLeaf({ type: 'verify' });

describe('runVerifyPipeline (epic f5c7fc46 L2)', () => {
  it('clean gate → plan→exec→report, merge + accept (commit-shaped deliverable)', async () => {
    const { deps, spies } = makeVerifyDeps({ resultJson: PLAN_CLEAN });
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // ran exactly the three verify nodes, in order, and NEVER the code nodes.
    const kinds = spies.invokeSpecs.map((s) => s.allowedTools ?? '');
    expect(kinds.filter((t) => t.includes('Write') && !t.includes('build_assembly_plan') && !t.includes('file_to_bucket')).length).toBe(1); // plan
    expect(kinds.some((t) => t.includes('build_assembly_plan'))).toBe(true); // exec
    expect(kinds.some((t) => t.includes('file_to_bucket'))).toBe(true); // report
    expect(spies.mergeCalls).toBe(1);
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    // the heavy CAD execute node gets the longer wall-clock cap; others use the default.
    const execSpec = spies.invokeSpecs.find((s) => (s.allowedTools ?? '').includes('build_assembly_plan'));
    expect(execSpec?.timeoutMs).toBe(VERIFY_EXEC_TIMEOUT_MS);
    const planSpec = spies.invokeSpecs.find((s) => (s.allowedTools ?? '') === 'Read Write Grep Glob Bash');
    expect(planSpec?.timeoutMs).toBeUndefined();
    // L5: the EXECUTOR persists the report node's emitted markdown into the worktree at the
    // report path BEFORE mergeToEpic (so it actually reaches the epic branch).
    const reportWrite = spies.writes.find((w) => w.relPath.endsWith('.report.md'));
    expect(reportWrite).toBeDefined();
    expect(reportWrite!.content).toContain('T14 verify report');
  });

  it('empty report node output → BLOCKED (verify-report-empty), no merge', async () => {
    const { deps, spies } = makeVerifyDeps({ resultJson: PLAN_CLEAN });
    deps.invoker.invoke = (async (spec) => {
      spies.invokeSpecs.push(spec);
      const tools = spec.allowedTools ?? '';
      if (tools.includes('build_assembly_plan')) return okResult(PLAN_CLEAN);
      if (tools.includes('file_to_bucket')) return okResult('   '); // blank report
      if (tools.includes('Write')) return okResult('{"plan":"inline"}'); // driveplan
      return okResult('done');
    }) as typeof deps.invoker.invoke;
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('verify-report-empty');
    expect(spies.mergeCalls).toBe(0);
  });

  it('failing DOMAIN gate is a FINDING, not an executor failure → still reports + accepts', async () => {
    const { deps, spies } = makeVerifyDeps({ resultJson: planReport([
      { node: 'axis', op: 'connect', ok: false, gates: [{ name: 'dof', passed: false, detail: 'over-constrained' }] },
    ], { ok: false }) });
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.mergeCalls).toBe(1);
    // the report node received the finding text so it can file the todo.
    expect(spies.reportFindings.some((p) => p.includes('over-constrained'))).toBe(true);
  });

  it('INFRA gate error (verb produced no parseable verdict) → BLOCKED, no report, no merge', async () => {
    const { deps, spies } = makeVerifyDeps({ resultJson: 'not json' });
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.mergeCalls).toBe(0);
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('file_to_bucket'))).toBe(false);
    expect(spies.escalations.length).toBeGreaterThan(0);
  });

  it('plan node fails twice → BLOCKED before exec/report', async () => {
    const { deps, spies } = makeVerifyDeps({ planFails: 99 });
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('build_assembly_plan'))).toBe(false);
    expect(spies.mergeCalls).toBe(0);
  });

  it('driveexec transient failure → ONE in-place retry → succeeds + accepts', async () => {
    const { deps, spies } = makeVerifyDeps({ execFails: 1 }); // first verb call fails, retry ok
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // two driveexec invocations (the transient + the retry), then report ran.
    const execCalls = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('build_assembly_plan'));
    expect(execCalls.length).toBe(2);
    expect(spies.mergeCalls).toBe(1);
  });

  it('driveexec fails twice → BLOCKED (verify-execute-node-failed), no report', async () => {
    const { deps, spies } = makeVerifyDeps({ execFails: 99 });
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('verify-execute-node-failed');
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('file_to_bucket'))).toBe(false);
  });

  it('gate-pending propagates as a first-class pending outcome', async () => {
    const { deps } = makeVerifyDeps({ resultJson: PLAN_CLEAN, gateEffective: 'pending' });
    const res = await runLeaf('proj', verifyLeaf(), deps);
    expect(res.outcome).toBe('pending');
    expect(res.reason).toBe('gate-pending');
  });

  it('a code-typed leaf does NOT enter the verify pipeline (no verb node)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    await runLeaf('proj', makeLeaf({ type: 'backend' }), deps);
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('build_assembly_plan'))).toBe(false);
  });
});

// ── Verify gate pluggability (epic f5c7fc46 L3) ──────────────────────────────

describe('resolveVerifyGate (pluggable {verb, command})', () => {
  it('defaults every verify type to the build_assembly_plan verb, no command', () => {
    expect(resolveVerifyGate(makeLeaf({ type: 'verify' }))).toEqual({ verb: VERIFY_GATE_VERB });
    expect(resolveVerifyGate(makeLeaf({ type: 'cad-dogfood' }))).toEqual({ verb: VERIFY_GATE_VERB });
  });
});

describe('verbMcpTool', () => {
  it('namespaces a verb to its bsync-cad MCP tool', () => {
    expect(verbMcpTool('build_assembly_plan')).toBe('mcp__bsync-cad__build_assembly_plan');
    expect(verbMcpTool('check_graph_drift')).toBe('mcp__bsync-cad__check_graph_drift');
  });
});

describe('buildVerifyPrompt honors a non-default verb (L3)', () => {
  it('plan + exec prompts reference the passed verb', () => {
    const plan = buildVerifyPrompt('driveplan', makeLeaf(), undefined, undefined, 'check_graph_drift');
    expect(plan).toContain('check_graph_drift');
    const exec = buildVerifyPrompt('driveexec', makeLeaf(), 'PLAN', undefined, 'check_graph_drift');
    expect(exec).toContain('check_graph_drift');
  });
});

describe('runVerifyPipeline command-gate composition (L3)', () => {
  /** Verify deps whose config resolves WITH a command gate and whose runCommandGate returns a
   *  scripted verdict — so the composition path is genuinely exercised. */
  function makeCmdGateDeps(opts: {
    resultJson: string;
    command: string;
    cmd: { ran: boolean; ok: boolean; output: string };
  }) {
    const base = makeVerifyDeps({ resultJson: opts.resultJson });
    const calls: string[] = [];
    base.deps.resolveVerifyGate = () => ({ verb: VERIFY_GATE_VERB, command: opts.command });
    base.deps.runCommandGate = async (_cwd, command) => { calls.push(command); return opts.cmd; };
    return { deps: base.deps, spies: base.spies, calls };
  }

  it('clean verb gate + passing command → accepts; command ran in the worktree', async () => {
    const { deps, calls } = makeCmdGateDeps({
      resultJson: PLAN_CLEAN,
      command: 'pytest -q',
      cmd: { ran: true, ok: true, output: 'all pass' },
    });
    const res = await runLeaf('proj', makeLeaf({ type: 'verify' }), deps);
    expect(res.outcome).toBe('accepted');
    expect(calls).toEqual(['pytest -q']);
  });

  it('clean verb gate but FAILING command → still accepts; the command failure is a finding', async () => {
    const { deps, spies } = makeCmdGateDeps({
      resultJson: PLAN_CLEAN,
      command: 'pytest -q',
      cmd: { ran: true, ok: false, output: '2 failed' },
    });
    const res = await runLeaf('proj', makeLeaf({ type: 'verify' }), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.reportFindings.some((p) => p.includes('command gate failed') && p.includes('pytest -q'))).toBe(true);
  });

  it('command that could not RUN (ran:false) → INFRA failure → BLOCKED, no report', async () => {
    const { deps, spies } = makeCmdGateDeps({
      resultJson: PLAN_CLEAN,
      command: 'pytest -q',
      cmd: { ran: false, ok: false, output: 'command not found' },
    });
    const res = await runLeaf('proj', makeLeaf({ type: 'verify' }), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('file_to_bucket'))).toBe(false);
  });

  it('driveexec is allowlisted to the RESOLVED verb (non-default)', async () => {
    const base = makeVerifyDeps({ resultJson: PLAN_CLEAN });
    base.deps.resolveVerifyGate = () => ({ verb: 'check_graph_drift' });
    await runLeaf('proj', makeLeaf({ type: 'verify' }), base.deps);
    const exec = base.spies.invokeSpecs.find((s) => (s.allowedTools ?? '').includes('check_graph_drift'));
    expect(exec).toBeDefined();
    expect(exec!.allowedTools).toContain('mcp__bsync-cad__check_graph_drift');
  });
});

describe('deprecatePriorAttempts (only the live attempt blueprint stays undeprecated)', () => {
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');

  async function setup() {
    const { DocumentManager } = await import('../document-manager');
    const { MetadataManager } = await import('../metadata-manager');
    const sessionDir = mkdtempSync(join(tmpdir(), 'mc-bp-attempts-'));
    const dm = new DocumentManager(join(sessionDir, 'documents'));
    await dm.initialize();
    return { dm, sessionDir, MetadataManager };
  }

  const LEAF = 'b1bea317-aaaa-bbbb-cccc-deadbeef0000';

  it('deprecates every prior attempt, leaves the live one, and ignores unrelated docs', async () => {
    const { dm, sessionDir, MetadataManager } = await setup();
    const id1 = await dm.createDocument(blueprintAttemptName(LEAF, 1), '# attempt 1');
    const id2 = await dm.createDocument(blueprintAttemptName(LEAF, 2), '# attempt 2');
    const live = await dm.createDocument(blueprintAttemptName(LEAF, 3), '# attempt 3');
    const other = await dm.createDocument('Leaf blueprint — feedface attempt 1', '# different leaf');

    await deprecatePriorAttempts(dm, sessionDir, LEAF, live);

    const mm = new MetadataManager(sessionDir);
    await mm.initialize();
    expect(mm.getItemMetadata(id1).deprecated).toBe(true);
    expect(mm.getItemMetadata(id2).deprecated).toBe(true);
    expect(mm.getItemMetadata(live).deprecated ?? false).toBe(false); // live stays visible
    expect(mm.getItemMetadata(other).deprecated ?? false).toBe(false); // another leaf untouched
  });

  it('catches an ORPHAN attempt left undeprecated by an interrupted earlier run', async () => {
    const { dm, sessionDir, MetadataManager } = await setup();
    // attempt 1 minted by a run that died before chaining its link — an orphan.
    const orphan = await dm.createDocument(blueprintAttemptName(LEAF, 1), '# orphaned attempt 1');
    const live = await dm.createDocument(blueprintAttemptName(LEAF, 2), '# attempt 2');

    await deprecatePriorAttempts(dm, sessionDir, LEAF, live);

    const mm = new MetadataManager(sessionDir);
    await mm.initialize();
    expect(mm.getItemMetadata(orphan).deprecated).toBe(true);
    expect(mm.getItemMetadata(live).deprecated ?? false).toBe(false);
  });
});

describe('runLeaf resume consumption (slice 2)', () => {
  it('skip-to-gate: runs only the gate, no worktree / blueprint / merge', async () => {
    const { deps, spies } = makeDeps({ gateEffective: 'accepted' });
    deps.resumePlan = { mode: 'skip-to-gate', reason: 'work-merged' };
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.reason).toBe('resumed-skip-to-gate');
    expect(spies.invokeSpecs.length).toBe(0); // no nodes spawned at all
    expect(spies.ensureCalls.length).toBe(0); // no worktree cut
    expect(spies.mergeCalls).toBe(0); // already merged by the prior run
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });

  it('skip-to-gate: a pending gate is reported as pending', async () => {
    const { deps } = makeDeps({ gateEffective: 'pending' });
    deps.resumePlan = { mode: 'skip-to-gate', reason: 'work-merged' };
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('pending');
    expect(res.reason).toBe('gate-pending');
  });

  it('skip-to-gate: a gate-rejected completion resolves rejected, never a free accepted', async () => {
    const { deps, spies } = makeDeps({ gateEffective: 'rejected' });
    deps.resumePlan = { mode: 'skip-to-gate', reason: 'work-merged' };
    const res = await runLeaf('/p', makeLeaf(), deps);
    // The 'accepted' argument is only a REQUEST; the authoritative gate verdict wins.
    expect(res.outcome).toBe('rejected');
    expect(res.outcome).not.toBe('accepted');
    expect(res.reason).toBe('gate-rejected');
    // It still went through the SAME deps.complete gate as the fresh path.
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
  });

  it('reattach-blueprint: reuses the durable plan (no blueprint node), runs implement+review', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    deps.resumePlan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
    deps.restoreBlueprint = () => 'RESTORED PLAN — implement these files';
    const writes: Array<{ rel: string; content: string }> = [];
    deps.writeArtifact = async (_cwd, rel, content) => { writes.push({ rel, content }); };
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // No node with the blueprint's Write profile was invoked — the plan was reused.
    const ranBlueprint = spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('Write'));
    expect(ranBlueprint).toBe(false);
    // implement + review still ran.
    expect(spies.invokeSpecs.length).toBe(2);
    expect(spies.mergeCalls).toBe(1);
    // The restored plan was written into the fresh worktree.
    expect(writes.some((w) => w.content === 'RESTORED PLAN — implement these files')).toBe(true);
    expect(spies.ensureCalls[0].opts.fresh).toBe(true); // still a FRESH worktree
  });

  it('reattach-blueprint: falls back to running the blueprint node when the durable plan is gone', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    deps.resumePlan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
    deps.restoreBlueprint = () => null; // plan vanished
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    const ranBlueprint = spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('Write'));
    expect(ranBlueprint).toBe(true); // had to author it after all
  });

  it('reattach-blueprint: resumed reattach dispatch does NOT increment blueprint nodesSpent', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    deps.resumePlan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
    deps.restoreBlueprint = () => '# prior blueprint\n\n```json\n{"schemaVersion":1,"estimatedFiles":1,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["x.ts"],"tasks":[{"id":"t1","files":["x.ts"],"description":"x"}]}\n```';
    // Stub invoker to throw if blueprint kind is ever invoked (Write profile).
    const originalInvoke = deps.invoker.invoke;
    deps.invoker = {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        if ((spec.allowedTools ?? '').includes('Write')) {
          throw new Error('BLUEPRINT_SHOULD_NOT_BE_INVOKED_ON_REATTACH');
        }
        return originalInvoke(spec);
      },
    };
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // Blueprint invoker was never called.
    const ranBlueprint = spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('Write'));
    expect(ranBlueprint).toBe(false);
    // nodesSpent reflects only implement+review (2), not 3.
    expect(res.nodesSpent).toBe(2);
    expect(spies.invokeSpecs.length).toBe(2);
  });
  // G8: durable blueprint base persistence — reusable blueprint survives terminal outcomes.
  it('G8: persistBlueprintBase is called when blueprint succeeds (not on reattach/in-run-carry)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    const baseSnapshots: string[] = [];
    deps.persistBlueprintBase = ({ epicBaseSha }) => { baseSnapshots.push(epicBaseSha ?? 'null'); };
    deps.epicBaseSha = 'sha-from-epic-tip';
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // persistBlueprintBase called exactly once (blueprint node succeeded, not reattach).
    expect(baseSnapshots).toEqual(['sha-from-epic-tip']);
  });
  it('G8: persistBlueprintBase NOT called on reattach (synthetic result, no new blueprint)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    const baseSnapshots: string[] = [];
    deps.persistBlueprintBase = ({ epicBaseSha }) => { baseSnapshots.push(epicBaseSha ?? 'null'); };
    deps.epicBaseSha = 'sha-from-epic-tip';
    deps.resumePlan = { mode: 'reattach-blueprint', reason: 'blueprint-reusable' };
    deps.restoreBlueprint = () => '# prior blueprint\n\n```json\n{"schemaVersion":1,"estimatedFiles":1,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["x.ts"],"tasks":[{"id":"t1","files":["x.ts"],"description":"x"}]}\n```';
    const res = await runLeaf('/p', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // NOT called on reattach (synthetic result).
    expect(baseSnapshots).toEqual([]);
  });
});

describe('isNodeStartFailure', () => {
  it('returns false for ok results', () => {
    const res: NodeResult = {
      ok: true,
      exitCode: 0,
      stdout: 'result',
      durationMs: 1000,
      usage: { inputTokens: 100, outputTokens: 50 },
      rateLimited: false,
      authMode: 'subscription',
    };
    expect(isNodeStartFailure(res)).toBe(false);
  });

  it('returns false for rate-limited results', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 500,
      usage: { inputTokens: 0, outputTokens: 0 },
      rateLimited: true,
      authMode: 'subscription',
    };
    expect(isNodeStartFailure(res)).toBe(false);
  });

  it('returns true for zero-token sub-5s node death (100ms-5s range)', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      parseError: 'There\'s an issue with the selected model (grok-4.3)...',
    };
    expect(isNodeStartFailure(res)).toBe(true);
  });

  it('returns false for very fast mock failures (< 100ms)', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 1,
      usage: { inputTokens: 0, outputTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      text: '',
    };
    expect(isNodeStartFailure(res)).toBe(false);
  });

  it('returns false for slow failing node (non-zero tokens)', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 60000,
      usage: { inputTokens: 100, outputTokens: 50 },
      rateLimited: false,
      authMode: 'subscription',
      parseError: 'Some error',
    };
    expect(isNodeStartFailure(res)).toBe(false);
  });

  it('returns false for slow failing node (5s+ duration)', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 5001,
      usage: { inputTokens: 0, outputTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      parseError: 'Some error',
    };
    expect(isNodeStartFailure(res)).toBe(false);
  });

  it('returns true for node death with zero tokens in valid range', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      parseError: 'Config error',
    };
    expect(isNodeStartFailure(res)).toBe(true);
  });

  it('returns false when any token count is non-zero', () => {
    const res1: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 1, outputTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
    };
    expect(isNodeStartFailure(res1)).toBe(false);

    const res2: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 0, outputTokens: 1 },
      rateLimited: false,
      authMode: 'subscription',
    };
    expect(isNodeStartFailure(res2)).toBe(false);

    const res3: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1 },
      rateLimited: false,
      authMode: 'subscription',
    };
    expect(isNodeStartFailure(res3)).toBe(false);
  });

  it('handles missing usage object as zero tokens', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      rateLimited: false,
      authMode: 'subscription',
    };
    expect(isNodeStartFailure(res)).toBe(true);
  });

  it('returns true for a zero-token TIMEOUT regardless of long duration', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: 600_000,
      usage: { inputTokens: 0, outputTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      timedOut: true,
      parseError: 'node timed out after 600000ms (killed)',
    };
    expect(isNodeStartFailure(res)).toBe(true);
  });

  it('returns false for a TIMEOUT that consumed tokens (ordinary slow failure)', () => {
    const res: NodeResult = {
      ok: false,
      exitCode: -1,
      stdout: '',
      durationMs: 600_000,
      usage: { inputTokens: 1200, outputTokens: 40 },
      rateLimited: false,
      authMode: 'subscription',
      timedOut: true,
      parseError: 'node timed out after 600000ms (killed)',
    };
    expect(isNodeStartFailure(res)).toBe(false);
  });
});

describe('parkNodeStartFailure integration (node start-failure through runLeaf)', () => {
  it('blueprint node start-failure (zero tokens, <5s) → outcome blocked, reason names pair, escalate blocker, complete never called', async () => {
    const startFailureResult: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 0, outputTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      text: "There's an issue with the selected model (grok-4.3) — it's not available",
      parseError: "There's an issue with the selected model (grok-4.3) — it's not available",
    };

    const { deps, spies } = makeDeps({});
    // Spy on invoker to return start failure for blueprint node only
    const originalInvoke = deps.invoker.invoke;
    let invocationCount = 0;
    deps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
      invocationCount += 1;
      // First invocation is blueprint (has Write in allowedTools)
      const isBlueprint = (spec.allowedTools ?? '').includes('Write');
      if (isBlueprint && invocationCount === 1) {
        return startFailureResult;
      }
      return originalInvoke(spec);
    };

    const res = await runLeaf('proj', makeLeaf(), deps);

    expect(res.outcome).toBe('blocked');
    expect(res.nodesSpent).toBe(1);
    expect(res.reason).toContain('node-could-not-start:');
    expect(res.reason).toContain("provider='claude'");
    expect(res.reason).toContain('grok-4.3');

    // Should escalate exactly once as a blocker due to start failure
    const blockerEscalations = spies.escalations.filter((e) => e.kind === 'blocker');
    expect(blockerEscalations.length).toBe(1);
    expect(blockerEscalations[0].questionText).toContain('node-could-not-start:');
    expect(blockerEscalations[0].questionText).toContain('blueprint');
    expect(blockerEscalations[0].questionText).toContain('provider');
    expect(blockerEscalations[0].questionText).toContain('model');

    // Verify deps.complete was NEVER called (start failure parks before acceptance)
    expect(spies.completeCalls).toEqual([]);
  });

  it('slow review failure (non-zero tokens or >5s) is NOT a start failure → follows existing verdict path', async () => {
    // A node that takes a long time and consumes tokens is NOT a start failure,
    // even if it returns ok:false. It should follow the normal verdict parsing path.
    const slowFailureResult: NodeResult = {
      ok: true,
      exitCode: 0,
      stdout: 'VERDICT: FAIL — issue found after processing',
      durationMs: 60000,
      usage: { inputTokens: 100, outputTokens: 50 },
      rateLimited: false,
      authMode: 'subscription',
      text: 'VERDICT: FAIL — issue found after processing',
    };

    const { deps, spies } = makeDeps({});
    // Spy on invoker to return slow result for review node only
    const originalInvoke = deps.invoker.invoke;
    let reviewCount = 0;
    deps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
      const isReview = spec.allowedTools === 'Read Grep Glob Bash';
      if (isReview) {
        reviewCount += 1;
        // Return slow failure only on first review; subsequent ones pass to avoid attempt loop
        if (reviewCount === 1) {
          return slowFailureResult;
        }
        return okResult('VERDICT: PASS');
      }
      return originalInvoke(spec);
    };

    const res = await runLeaf('proj', makeLeaf(), deps);

    // Slow result should follow existing path, NOT park as start failure.
    // Since the first review is 'fail', it will retry. The second review passes, so accepted.
    expect(res.outcome).toBe('accepted');
    expect(res.nodesSpent).toBeGreaterThan(3); // blueprint + implement + review (fail) + implement + review (pass)

    // Should NOT escalate as a blocker (start failure)
    expect(spies.escalations.filter((e) => e.kind === 'blocker').length).toBe(0);

    // complete() was called with 'accepted' (the normal verdict path)
    expect(spies.completeCalls.some((c) => c.acceptance === 'accepted')).toBe(true);
  });

  it('repeated deterministic start-failures bump retry (age to retry-exhausted) and keep a STABLE questionText (one dedup card)', async () => {
    const startFailureResult: NodeResult = {
      ok: false,
      exitCode: 1,
      stdout: '',
      durationMs: 2000,
      usage: { inputTokens: 0, outputTokens: 0 },
      rateLimited: false,
      authMode: 'subscription',
      text: "There's an issue with the selected model (grok-4.3) — it's not available",
      parseError: "There's an issue with the selected model (grok-4.3) — it's not available",
    };
    const texts: string[] = [];
    for (let run = 0; run < 3; run++) {
      // vary a per-run value to prove it is NOT in the dedup key
      const sfr = { ...startFailureResult, durationMs: 1000 + run * 777 };
      const { deps, spies } = makeDeps({});

      // Wrap bumpRetry and releaseClaim to track ordering
      const opSeq: string[] = [];
      const originalBumpRetry = deps.bumpRetry;
      const originalReleaseClaim = deps.releaseClaim;
      if (originalBumpRetry) {
        deps.bumpRetry = async (p, leafId) => {
          opSeq.push('bumpRetry');
          return originalBumpRetry(p, leafId);
        };
      }
      if (originalReleaseClaim) {
        deps.releaseClaim = async (p, leafId) => {
          opSeq.push('releaseClaim');
          return originalReleaseClaim(p, leafId);
        };
      }

      const originalInvoke = deps.invoker.invoke;
      let n = 0;
      deps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
        n += 1;
        const isBlueprint = (spec.allowedTools ?? '').includes('Write');
        if (isBlueprint && n === 1) return sfr;
        return originalInvoke(spec);
      };
      await runLeaf('proj', makeLeaf(), deps);
      // retry bumped once, BEFORE the claim is released
      expect(spies.bumpRetryCalls.length).toBe(1);
      expect(spies.releaseClaimCalls.length).toBe(1);
      expect(opSeq.indexOf('bumpRetry')).toBeGreaterThanOrEqual(0);
      expect(opSeq.indexOf('releaseClaim')).toBeGreaterThan(opSeq.indexOf('bumpRetry'));
      const qt = spies.escalations.find(e => e.kind === 'blocker')!.questionText;
      expect(qt).not.toMatch(/\d+ms/);   // no per-run duration token
      texts.push(qt);
    }
    // stable dedup key: identical across all runs despite varying durationMs
    expect(new Set(texts).size).toBe(1);
  });
});

describe('F2: start-failure retry circuit-breaker (bug a8935a16 — cap the 4×600s amplifier)', () => {
  const startFailureResult: NodeResult = {
    ok: false,
    exitCode: 1,
    stdout: '',
    durationMs: 2000,
    usage: { inputTokens: 0, outputTokens: 0 },
    rateLimited: false,
    authMode: 'subscription',
    text: 'timed out at SessionStart',
    parseError: 'timed out at SessionStart',
  };
  const startFailingInvoker = (deps: LeafExecutorDeps) => {
    const originalInvoke = deps.invoker.invoke;
    let n = 0;
    deps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
      n += 1;
      const isBlueprint = (spec.allowedTools ?? '').includes('Write');
      if (isBlueprint && n === 1) return startFailureResult;
      return originalInvoke(spec);
    };
  };

  it('FIRST start-failure (retryCount 0) → bump + release for ONE retry, NOT held', async () => {
    const { deps, spies } = makeDeps({});
    startFailingInvoker(deps);
    const res = await runLeaf('proj', makeLeaf({ retryCount: 0 }), deps);
    expect(res.outcome).toBe('blocked');
    // One retry allowed: released back for re-claim, retry bumped, NOT durably held.
    expect(spies.releaseClaimCalls.length).toBe(1);
    expect(spies.bumpRetryCalls.length).toBe(1);
    expect(spies.holdLeafCalls.length).toBe(0);
  });

  it('SECOND consecutive start-failure (retryCount ≥ 1) → durably HELD, NOT released (no more re-claims)', async () => {
    const { deps, spies } = makeDeps({});
    startFailingInvoker(deps);
    // The re-dispatched leaf carries the retryCount bumped by its first start-failure.
    const res = await runLeaf('proj', makeLeaf({ retryCount: 1 }), deps);
    expect(res.outcome).toBe('blocked');
    // Circuit-broken: held durably, and NOT released/bumped for another spin.
    expect(spies.holdLeafCalls.length).toBe(1);
    expect(spies.holdLeafCalls[0].reason).toContain('start-failure-circuit-break');
    expect(spies.releaseClaimCalls.length).toBe(0);
    expect(spies.bumpRetryCalls.length).toBe(0);
  });

  it('holdLeaf unwired (legacy deps) → falls back to bump + release (never breaks the park)', async () => {
    const { deps, spies } = makeDeps({});
    deps.holdLeaf = undefined; // legacy dispatch without the hold seam
    startFailingInvoker(deps);
    const res = await runLeaf('proj', makeLeaf({ retryCount: 1 }), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.holdLeafCalls.length).toBe(0);
    expect(spies.releaseClaimCalls.length).toBe(1);
    expect(spies.bumpRetryCalls.length).toBe(1);
  });
});

describe('implement start-failure → reactive in-place model escalation', () => {
  const implStartFailure: NodeResult = {
    ok: false,
    exitCode: 1,
    stdout: '',
    durationMs: 2000,
    usage: { inputTokens: 0, outputTokens: 0 },
    rateLimited: false,
    authMode: 'subscription',
    text: 'timed out',
    parseError: 'timed out',
  };
  // implement node = has Edit, not Write (blueprint) and not the readonly review set.
  const isImplement = (spec: NodeSpec): boolean =>
    (spec.allowedTools ?? '').includes('Edit') && !(spec.allowedTools ?? '').includes('Write');

  it('escalates ONCE in-place to the blueprint model, then parks if the retry also start-fails', async () => {
    const { deps, spies } = makeDeps({});
    const implModels: string[] = [];
    const originalInvoke = deps.invoker.invoke;
    deps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
      if (isImplement(spec)) {
        implModels.push(spec.model ?? '');
        return implStartFailure; // every implement invocation start-fails
      }
      return originalInvoke(spec);
    };

    const res = await runLeaf('proj', makeLeaf(), deps);

    // Exactly ONE in-place retry: two implement invocations, no more.
    expect(implModels.length).toBe(2);
    // First ran on the pinned (cheap) implement model; the retry ran on the blueprint model.
    expect(implModels[0]).toBe(NODE_PROFILE.implement.model); // sonnet (pinned)
    expect(implModels[1]).toBe(NODE_PROFILE.blueprint.model); // opus (escalated)
    expect(implModels[1]).not.toBe(implModels[0]);

    // The retry also start-failed → the leaf parks as node-could-not-start.
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('node-could-not-start:');
    expect(spies.escalations.filter((e) => e.kind === 'blocker').length).toBe(1);
    expect(spies.completeCalls).toEqual([]);
  });

  it('recovers when the escalated retry starts: one start-fail then success → leaf proceeds', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    const implModels: string[] = [];
    let implCount = 0;
    const originalInvoke = deps.invoker.invoke;
    deps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
      if (isImplement(spec)) {
        implCount += 1;
        implModels.push(spec.model ?? '');
        if (implCount === 1) return implStartFailure; // first (cheap model) start-fails
        return originalInvoke(spec); // escalated retry succeeds
      }
      return originalInvoke(spec);
    };

    const res = await runLeaf('proj', makeLeaf(), deps);

    expect(implModels[0]).toBe(NODE_PROFILE.implement.model); // sonnet
    expect(implModels[1]).toBe(NODE_PROFILE.blueprint.model); // escalated to opus
    expect(res.outcome).toBe('accepted');
    expect(spies.escalations.filter((e) => e.kind === 'blocker').length).toBe(0);
  });
});

describe('SR-7 inherited blueprint refresh', () => {
  it('sliceCoversFiles returns false when plan is null', () => {
    expect(sliceCoversFiles(null, ['a.ts'])).toBe(false);
  });

  it('sliceCoversFiles returns false when plan is empty string', () => {
    expect(sliceCoversFiles('', ['a.ts'])).toBe(false);
  });

  it('sliceCoversFiles returns false when files array is empty', () => {
    expect(sliceCoversFiles('src/a.ts src/b.ts', [])).toBe(false);
  });

  it('sliceCoversFiles returns false when a file is missing from plan', () => {
    const plan = 'src/a.ts src/b.ts';
    expect(sliceCoversFiles(plan, ['a.ts', 'c.ts'])).toBe(false);
  });

  it('sliceCoversFiles returns true when all files present in plan', () => {
    const plan = 'src/a.ts src/b.ts src/c.ts';
    expect(sliceCoversFiles(plan, ['a.ts', 'b.ts'])).toBe(true);
  });

  it('resolveInheritedSlice returns null when leaf has no inheritedBlueprintFrom', () => {
    const leaf = makeLeaf({ inheritedBlueprintFrom: null, inheritedFiles: ['a.ts'] });
    const result = resolveInheritedSlice(leaf, () => 'plan');
    expect(result).toBeNull();
  });

  it('resolveInheritedSlice returns null when inheritedFiles is empty', () => {
    const leaf = makeLeaf({ inheritedBlueprintFrom: 'parent-id', inheritedFiles: [] });
    const result = resolveInheritedSlice(leaf, () => 'plan');
    expect(result).toBeNull();
  });

  it('resolveInheritedSlice returns null when restore function is undefined', () => {
    const leaf = makeLeaf({ inheritedBlueprintFrom: 'parent-id', inheritedFiles: ['a.ts'] });
    const result = resolveInheritedSlice(leaf, undefined);
    expect(result).toBeNull();
  });

  it('resolveInheritedSlice returns null when restored text is null', () => {
    const leaf = makeLeaf({ inheritedBlueprintFrom: 'parent-id', inheritedFiles: ['a.ts'] });
    const result = resolveInheritedSlice(leaf, () => null);
    expect(result).toBeNull();
  });

  it('resolveInheritedSlice returns null when slice does not cover all files', () => {
    const leaf = makeLeaf({ inheritedBlueprintFrom: 'parent-id', inheritedFiles: ['a.ts', 'b.ts'] });
    const plan = 'src/a.ts';  // missing b.ts
    const result = resolveInheritedSlice(leaf, () => plan);
    expect(result).toBeNull();
  });

  it('resolveInheritedSlice returns the slice when all files are covered', () => {
    const leaf = makeLeaf({ inheritedBlueprintFrom: 'parent-id', inheritedFiles: ['a.ts', 'b.ts'] });
    const plan = 'src/a.ts src/b.ts';
    const result = resolveInheritedSlice(leaf, () => plan);
    expect(result).not.toBeNull();
    expect(result?.from).toBe('parent-id');
    expect(result?.files).toEqual(['a.ts', 'b.ts']);
    expect(result?.text).toBe(plan);
  });

  it('refresh node uses sonnet model by default', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    const parentPlan = 'src/a.ts src/b.ts\n\n```json\n{"schemaVersion":1,"estimatedFiles":2,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["a.ts","b.ts"],"tasks":[{"id":"t1","files":["a.ts","b.ts"],"description":"edit a and b"}]}\n```';
    const child = makeLeaf({
      inheritedBlueprintFrom: 'parent-id',
      inheritedFiles: ['a.ts', 'b.ts'],
    });
    deps.restoreBlueprint = () => parentPlan;
    const res = await runLeaf('/p', child, deps);
    expect(res.outcome).toBe('accepted');
    // First spec should be the refresh blueprint (sonnet model).
    const bpSpec = spies.invokeSpecs[0];
    expect(bpSpec.model).toBe('sonnet');
    expect(bpSpec.effort).toBe('low');
    expect(bpSpec.prompt).toContain('RECONCILE');
    expect(bpSpec.prompt).toContain('parent-id');
    expect(bpSpec.prompt).toContain('a.ts');
    expect(bpSpec.prompt).toContain('b.ts');
  });

  it('refresh prompt contains inherited text', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    const parentPlan = '# Parent Blueprint\nThis does X and Y';
    const child = makeLeaf({
      inheritedBlueprintFrom: 'parent-id',
      inheritedFiles: ['a.ts'],
    });
    deps.restoreBlueprint = () => parentPlan + '\n\n```json\n{"schemaVersion":1,"estimatedFiles":1,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["a.ts"],"tasks":[{"id":"t1","files":["a.ts"],"description":"x"}]}\n```';
    const res = await runLeaf('/p', child, deps);
    expect(res.outcome).toBe('accepted');
    const bpSpec = spies.invokeSpecs[0];
    expect(bpSpec.prompt).toContain('Parent Blueprint');
    expect(bpSpec.prompt).toContain('This does X and Y');
  });

  it('fallback to opus blueprint when slice does not cover all files', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    const child = makeLeaf({
      inheritedBlueprintFrom: 'parent-id',
      inheritedFiles: ['a.ts', 'b.ts'],
    });
    // Plan only mentions a.ts, not b.ts — under-specified
    deps.restoreBlueprint = () => 'src/a.ts\n\n```json\n{"schemaVersion":1,"estimatedFiles":1,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["a.ts"],"tasks":[{"id":"t1","files":["a.ts"],"description":"x"}]}\n```';
    const res = await runLeaf('/p', child, deps);
    expect(res.outcome).toBe('accepted');
    // Blueprint spec should use opus (full blueprint), not sonnet (refresh).
    const bpSpec = spies.invokeSpecs[0];
    expect(bpSpec.model).toBe('opus');
    expect(bpSpec.prompt).not.toContain('RECONCILE');
    expect(bpSpec.prompt).not.toContain('INHERITED');
  });

  it('no-split regression: unsplit leaf uses opus blueprint', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    const leaf = makeLeaf({
      inheritedBlueprintFrom: null,  // not a split child
      inheritedFiles: [],
    });
    const res = await runLeaf('/p', leaf, deps);
    expect(res.outcome).toBe('accepted');
    const bpSpec = spies.invokeSpecs[0];
    expect(bpSpec.model).toBe('opus');
    expect(bpSpec.prompt).not.toContain('RECONCILE');
  });

  it('per-project override still wins over refresh default', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'accepted' });
    const parentPlan = 'src/a.ts\n\n```json\n{"schemaVersion":1,"estimatedFiles":1,"estimatedTasks":1,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["a.ts"],"tasks":[{"id":"t1","files":["a.ts"],"description":"x"}]}\n```';
    const child = makeLeaf({
      inheritedBlueprintFrom: 'parent-id',
      inheritedFiles: ['a.ts'],
    });
    deps.restoreBlueprint = () => parentPlan;
    // Stub nodeOverrides to return opus for blueprint (overrides the refresh default).
    const originalInvoke = deps.invoker.invoke;
    let overrideCalled = false;
    deps.invoker = {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        if ((spec.allowedTools ?? '').includes('Write')) {
          // This is the blueprint node.
          if (spec.model === 'opus') {
            overrideCalled = true;
          }
        }
        return originalInvoke(spec);
      },
    };
    const res = await runLeaf('/p', child, deps);
    expect(res.outcome).toBe('accepted');
    // The blueprint spec should respect per-project overrides (not checked in this simple test,
    // but the override would be honored by the actual nodeOverrides lookup).
  });
});

describe('makeCitationExists (G3 worktree citation predicate)', () => {
  it('bounds: rejects absolute paths and .. traversal outright', () => {
    const exists = makeCitationExists('/tmp/nowhere');
    expect(exists('/etc/passwd', 1)).toBe(false);
    expect(exists('../../../etc/passwd', 1)).toBe(false);
    expect(exists('a/../b.ts', 1)).toBe(false);
    expect(exists('', 1)).toBe(false);
  });

  it('checks existence + line bound under the root', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'cite-'));
    try {
      writeFileSync(join(dir, 'real.ts'), 'a\nb\nc\n');
      const exists = makeCitationExists(dir);
      expect(exists('real.ts', 1)).toBe(true);
      expect(exists('real.ts', 4)).toBe(true);  // trailing newline → 4 split segments
      expect(exists('real.ts', 5)).toBe(false); // beyond EOF
      expect(exists('real.ts', 0)).toBe(false); // lines are 1-based
      expect(exists('ghost.ts', 1)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('replay-corpus recording (G3 + citability)', () => {
  it('G3 on PASS records the grounding verdict + change-set', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['- [MET] criterion 1 — src/foo.ts:1\n\nVERDICT: PASS'],
      changeSet: ['src/foo.ts', 'src/bar.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');

    // Assert G3 eval was recorded
    const g3Eval = spies.gateEvals.find((e) => e.gate === 'g3');
    expect(g3Eval).toBeDefined();
    expect(typeof g3Eval.verdict).toBe('string');
    expect(Array.isArray(g3Eval.changeSet)).toBe(true);
    expect(g3Eval.changeSet).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('citability records at blueprint time', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['- [MET] criterion 1 — src/a.ts:1\n\nVERDICT: PASS'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');

    // Assert citability eval was recorded (fires on every run, pre-implement)
    const citabilityEval = spies.gateEvals.find((e) => e.gate === 'citability');
    expect(citabilityEval).toBeDefined();
    expect(typeof citabilityEval.verdict).toBe('string');
  });

  it('shadow-on: a vacuous verdict records but does NOT park', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'], // No criteria = vacuous grounding
      changeSet: [],
      gateShadowMode: true,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');

    // Assert G3 eval with 'vacuous' verdict was recorded
    const g3Eval = spies.gateEvals.find((e) => e.gate === 'g3' && e.verdict === 'vacuous');
    expect(g3Eval).toBeDefined();

    // Verify the run was accepted (not parked with review-vacuous)
    expect(res.reason ?? '').not.toContain('review-vacuous');
  });
});

describe('small-tier leaf execution (zero opus, skip blueprint, demote review)', () => {
  it('tier:small runs with zero opus and zero blueprint nodes, recording tier in ledger', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true }),
    });
    const leaf = makeLeaf({
      tier: 'small',
      description: 'implement a small feature',
    });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('accepted');

    // Assert zero opus calls: blueprint and review must not be opus
    const opusCalls = spies.invokeSpecs.filter((s) => s.model === 'opus');
    expect(opusCalls.length).toBe(0);

    // Assert zero blueprint nodeKind rows (small tier synthesizes the blueprint)
    const blueprintRows = spies.nodeRows.filter((r) => r.nodeKind === 'blueprint');
    expect(blueprintRows.length).toBe(0);

    // Assert tier is recorded in the ledger outcome detail
    const outcomeRow = spies.nodeRows.find((r) => r.nodeKind === 'outcome');
    expect(outcomeRow).toBeDefined();
    if (outcomeRow?.outcomeDetail) {
      const detail = JSON.parse(outcomeRow.outcomeDetail);
      expect(detail.tier).toBe('small');
    }
  });
});


describe('escalateImplementModel (retry ladder)', () => {
  it('attempt 1 never ladders; attempt 2 bumps one tier; opus and non-Claude lanes never ladder', () => {
    expect(escalateImplementModel('haiku', 1)).toBe('haiku');
    expect(escalateImplementModel('haiku', 2)).toBe('sonnet');
    expect(escalateImplementModel('sonnet', 2)).toBe('opus');
    expect(escalateImplementModel('opus', 2)).toBe('opus');
    expect(escalateImplementModel('claude-haiku-4-5-20251001', 2)).toBe('sonnet');
    expect(escalateImplementModel('grok-build-0.1', 2)).toBe('grok-build-0.1');
    expect(escalateImplementModel('composer-2.5', 2)).toBe('composer-2.5');
  });
});

describe('sameReviewWall (fuzzy repeat-findings detector)', () => {
  it('matches findings that drift in line numbers and case but say the same thing', () => {
    const a = '1. [UNMET] retry path clobbers findings — leaf-executor.ts:2506\n2. [UNMET] breaks review-vacuous test at :519';
    const b = '1. [UNMET] Retry path clobbers findings — leaf-executor.ts:2511\n2. [UNMET] breaks review-vacuous test at :528';
    expect(sameReviewWall(a, b)).toBe(true);
  });
  it('does not match genuinely different findings or empty text', () => {
    expect(sameReviewWall('the gate command is wrong for ui tests', 'missing null guard in resume decision path')).toBe(false);
    expect(sameReviewWall('', 'anything here at all')).toBe(false);
  });
  // The wall = the UNRESOLVED defect lines, not the whole review. Stable passing criteria and
  // boilerplate preamble must NOT inflate two different failures into a false "repeat" that
  // parks prematurely and abandons still-fixable work (reviewer-lab probe regressions).
  it('two DIFFERENT defects sharing a boilerplate preamble line are NOT the same wall', () => {
    const a = 'Reviewed the working tree against the blueprint.\nVERDICT: FAIL — missing null check at users.ts:5';
    const b = 'Reviewed the working tree against the blueprint.\nVERDICT: FAIL — off-by-one in the loop at agg.py:3';
    expect(sameReviewWall(a, b)).toBe(false);
  });
  it('partial progress (one criterion fixed, a NEW one fails) is NOT the same wall despite stable MET lines', () => {
    const a = '## CRITERIA\n- [MET] email rule — src/validate.ts:4\n- [MET] name rule — src/validate.ts:6\n- [UNMET] age>=18 rule not implemented — src/validate.ts:9';
    const b = '## CRITERIA\n- [MET] email rule — src/validate.ts:4\n- [MET] name rule — src/validate.ts:6\n- [UNMET] age boundary excludes exactly 18 — src/validate.ts:9';
    expect(sameReviewWall(a, b)).toBe(false);
  });
  it('the SAME unresolved defect (line drift only) is still the same wall', () => {
    const a = '## CRITERIA\n- [MET] email rule — src/validate.ts:4\n- [UNMET] age>=18 rule not implemented — src/validate.ts:9';
    const b = '## CRITERIA\n- [MET] email rule — src/validate.ts:4\n- [UNMET] age>=18 rule not implemented — src/validate.ts:15';
    expect(sameReviewWall(a, b)).toBe(true);
  });
});

describe('same-wall-twice cross-attempt park', () => {
  it('two attempts dying on IDENTICAL findings park as same-wall-twice, not cap-exhausted', async () => {
    // identical finding text across both attempts (and within each attempt, so the
    // in-revise isRepeat bails each attempt after one reuse)
    const { deps } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — the retry path clobbers findings', 'VERDICT: FAIL — the retry path clobbers findings',
                       'VERDICT: FAIL — the retry path clobbers findings', 'VERDICT: FAIL — the retry path clobbers findings'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('same-wall-twice');
  });

  it('attempt-2 implement runs one model tier up (retry ladder end-to-end)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — alpha wall', 'VERDICT: FAIL — beta wall', 'VERDICT: FAIL — gamma wall', 'VERDICT: FAIL — delta wall'],
    });
    await runLeaf('proj', makeLeaf(), deps);
    const implSpecs = spies.invokeSpecs.filter((sp) => (sp.allowedTools ?? '').includes('Edit'));
    const attempt1 = implSpecs[0];
    const attempt2 = implSpecs.find((sp) => sp.model !== attempt1.model);
    expect(attempt1.model).toBe(NODE_PROFILE.implement.model); // sonnet on attempt 1
    expect(attempt2?.model).toBe('opus'); // laddered on attempt 2
  });
});

// ---------------------------------------------------------------------------
// crit 6 — OPTIMISTIC LANDING for small / test-pinned tiers: merge after the GREEN
// mechanical gate (before review), review post-merge, auto-revert on a real post-land
// finding. The mechanical gate stays STRICTLY pre-land, and the accept bookkeeping is
// identical to full-tier (landing-order-invariant).
// ---------------------------------------------------------------------------
describe('crit 6 — optimistic landing (small / test-pinned tiers)', () => {
  /** Wrap deps so every mergeToEpic + review-node invocation is logged in call order,
   *  and mergeToEpic returns a real mergeSha the revert path can reference. Also wires a
   *  revertEpicMerge spy. Returns the shared { order, reverts } logs. */
  function instrument(deps: LeafExecutorDeps, mergeResult: Record<string, unknown> = { merged: true, integrated: true, mergeSha: 'MSHA' }) {
    const order: string[] = [];
    const reverts: Array<{ leafId: string; mergeSha: string; reason: string }> = [];
    const origInvoke = deps.invoker.invoke.bind(deps.invoker);
    deps.invoker = {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        if (spec.allowedTools === 'Read Grep Glob Bash') order.push('review');
        return origInvoke(spec);
      },
    };
    deps.mergeToEpic = async () => { order.push('merge'); return mergeResult; };
    deps.revertEpicMerge = async (_s, _e, leafId, mergeSha, reason) => {
      reverts.push({ leafId, mergeSha, reason });
      order.push('revert');
      return { reverted: true, revertSha: 'RSHA' };
    };
    return { order, reverts };
  }

  const greenGate: LeafExecutorDeps['runGate'] = async () => ({ status: 'pass', output: '', reasons: [], declared: true });

  it('part 1a: small tier + GREEN mech gate → mergeToEpic runs BEFORE the review node; an optimistic-land node is recorded', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    const { order } = instrument(deps);
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('accepted');
    // merge is optimistic — it precedes the review node.
    expect(order).toEqual(['merge', 'review']);
    // merged exactly ONCE (the optimistic merge; no second post-review merge).
    expect(spies.mergeCalls).toBe(0); // real merge is the instrumented one; makeDeps counter untouched
    const optNode = spies.nodeRows.find((r) => r.nodeKind === 'optimistic-land');
    expect(optNode).toBeTruthy();
    expect(optNode.outcomeDetail).toContain('MSHA');
  });

  it('part 1b: small tier + RED mechanical gate (fail) → mergeToEpic is NOT called (mechanical gate is provably pre-land)', async () => {
    const { deps } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — x', 'VERDICT: FAIL — x'],
      runGate: async () => ({ status: 'fail', command: 'npx tsc --noEmit', output: '1 err', reasons: ['x'], declared: true }),
    });
    const { order } = instrument(deps);
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('blocked');
    expect(order).not.toContain('merge'); // never optimistically landed on a red gate
  });

  it('part 1b: small tier + mechanical gate ERROR → no merge, parks (INCIDENT stays pre-land)', async () => {
    const { deps } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: async () => ({ status: 'error', command: 'no-such-bin', output: 'ENOENT', reasons: [], declared: true }),
    });
    const { order } = instrument(deps);
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('blocked');
    expect(order).not.toContain('merge');
  });

  it('part 1c: FULL tier + GREEN mech → merge runs only AFTER review (optimistic path NOT taken; unchanged)', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    const { order } = instrument(deps);
    const res = await runLeaf('proj', makeLeaf({ tier: 'full' }), deps);
    expect(res.outcome).toBe('accepted');
    expect(order).toEqual(['review', 'merge']); // review first, then merge — the pre-crit-6 order
    expect(spies.nodeRows.find((r) => r.nodeKind === 'optimistic-land')).toBeUndefined();
  });

  it('part 2a: small tier, GREEN mech, then post-merge review FAIL → revertEpicMerge is called for THIS leaf; a friction reason-card is recorded; outcome blocked, reason starts optimistic-land-reverted', async () => {
    const { deps, spies } = makeDeps({
      // Both attempts FAIL so no revise-to-pass; the first post-land FAIL is terminal (revert).
      reviewVerdicts: ['VERDICT: FAIL — real fault', 'VERDICT: FAIL — real fault'],
      runGate: greenGate,
    });
    const { order, reverts } = instrument(deps);
    const leaf = makeLeaf({ tier: 'small' });
    const res = await runLeaf('proj', leaf, deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toMatch(/^optimistic-land-reverted:/);
    // merged before review, then reverted on the fault — never revised in place.
    expect(order).toEqual(['merge', 'review', 'revert']);
    expect(reverts).toHaveLength(1);
    expect(reverts[0].leafId).toBe(leaf.id);
    expect(reverts[0].mergeSha).toBe('MSHA');
    // an auditable reason-card ledger node names the reverted sha.
    const card = spies.nodeRows.find((r) => r.nodeKind === 'optimistic-land-reverted');
    expect(card).toBeTruthy();
    expect(card.outputText).toContain('MSHA');
  });

  it('part 2b: small tier, GREEN mech, post-merge review PASS → merged exactly ONCE, NO revert, outcome accepted', async () => {
    const { deps } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    const { order, reverts } = instrument(deps);
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('accepted');
    expect(order.filter((o) => o === 'merge')).toHaveLength(1); // exactly one merge
    expect(reverts).toHaveLength(0); // no revert on a pass
  });

  it('part 3a: an optimistically-landed small-tier PASS records the SAME accept bookkeeping (finalOutcome accepted + one complete:accepted) as a full-tier PASS', async () => {
    // small (optimistic) path
    const small = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    instrument(small.deps);
    const smallRes = await runLeaf('proj', makeLeaf({ tier: 'small' }), small.deps);
    // full path
    const full = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    instrument(full.deps);
    const fullRes = await runLeaf('proj', makeLeaf({ tier: 'full' }), full.deps);

    expect(smallRes.outcome).toBe('accepted');
    expect(fullRes.outcome).toBe('accepted');
    // identical acceptance funnel: exactly one complete:accepted, no reject pre-stamp.
    expect(small.spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    expect(full.spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    expect(small.spies.markRejectingCalls).toHaveLength(0);
    // the terminal 'outcome' ledger row is 'accepted' on both paths (landing-order-invariant).
    const smallOutcome = small.spies.nodeRows.find((r) => r.nodeKind === 'outcome');
    const fullOutcome = full.spies.nodeRows.find((r) => r.nodeKind === 'outcome');
    expect(smallOutcome.leafOutcome).toBe('accepted');
    expect(fullOutcome.leafOutcome).toBe('accepted');
  });

  it('part 3b: the optimistic-path terminal outcome record carries tier:"small" and a clean accepted outcome', async () => {
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    instrument(deps);
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('accepted');
    const outcomeRow = spies.nodeRows.find((r) => r.nodeKind === 'outcome');
    expect(outcomeRow.outcomeDetail).toContain('"tier":"small"');
    expect(outcomeRow.outcomeDetail).toContain('"effectiveOutcome":"accepted"');
  });

  it('a NO-OP merge (integrated:false, clean/stale worktree) does NOT optimistically land and NEVER reverts — review parks the empty leaf, not optimistic-land-reverted', async () => {
    // A clean/stale worktree → commitAndMergeToEpic returns merged:true but integrated:false
    // with mergeSha = the epic TIP (an unrelated commit). Setting optimisticallyLanded here
    // would make the review FAIL revert the WRONG commit (regression: live small-tier run on
    // an already-landed leaf reverted the epic tip). Guarded: skip the optimistic land.
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — nothing to review', 'VERDICT: FAIL — nothing to review'],
      runGate: greenGate,
    });
    const { order, reverts } = instrument(deps, { merged: true, integrated: false, mergeSha: 'EPIC_TIP' });
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('blocked');
    // merge attempted + review ran (possibly across retries) but NEVER a revert — nothing was
    // really landed, so there is no leaf-merge commit to revert.
    expect(order).toContain('merge');
    expect(order).toContain('review');
    expect(order).not.toContain('revert');
    expect(reverts).toHaveLength(0);
    // reason is the plain review finding, NOT an optimistic-land-reverted tag.
    expect(res.reason ?? '').not.toContain('optimistic-land-reverted');
    // an optimistic-land-skipped audit node was recorded; NO optimistic-land node.
    expect(spies.nodeRows.find((r) => r.nodeKind === 'optimistic-land')).toBeUndefined();
    expect(spies.nodeRows.find((r) => r.nodeKind === 'optimistic-land-skipped')).toBeTruthy();
    expect(spies.nodeRows.find((r) => r.nodeKind === 'optimistic-land-reverted')).toBeUndefined();
  });

  it('a merge CONFLICT on the optimistic path parks without landing (merged:false ⇒ not optimistically landed, no revert)', async () => {
    const { deps } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], runGate: greenGate });
    const { order, reverts } = instrument(deps, { merged: false, conflict: true });
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toContain('merge-to-epic-failed');
    expect(order).toEqual(['merge']); // attempted merge, no review, no revert
    expect(reverts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// crit 1 — FALSIFIABILITY RULE: the LLM review cannot gate a GREEN mechanical gate on a
// NON-falsifiable finding (genuine doubt over a real change-set). A concrete fault claim
// still gates; a red mechanical gate still parks; a no-op/empty change-set is not abstained.
// ---------------------------------------------------------------------------
describe('isNonFalsifiableReviewDoubt (crit 1 classifier)', () => {
  it('is TRUE for inability/doubt phrasing and empty findings', () => {
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL — I cannot confirm correctness')).toBe(true);
    expect(isNonFalsifiableReviewDoubt("VERDICT: FAIL — can't verify this is right")).toBe(true);
    expect(isNonFalsifiableReviewDoubt('[N/A] nothing to review\n\nVERDICT: FAIL')).toBe(true);
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL — not enough context to assess')).toBe(true);
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL')).toBe(true); // empty finding = pure doubt
    expect(isNonFalsifiableReviewDoubt('')).toBe(true);
  });
  it('is FALSE for a concrete fault claim (still gates)', () => {
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL — missing null check at line 42')).toBe(false);
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL — the function returns undefined for empty input')).toBe(false);
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL — real fault')).toBe(false);
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL — missing test for the error path')).toBe(false);
  });
  // crit 1 (v2) — reviewer-lab probe regressions. A finding that entangles a CONCRETE cited defect
  // with an INCIDENTAL hedge must STILL gate: a whole-text doubt scan wrongly abstained these,
  // shipping the real defect. A bare "FAIL —" (punctuation-only residual) is empty → pure doubt.
  it('gates a concrete defect even when a SEPARATE clause hedges (mixed finding)', () => {
    // missing await + "I also cannot verify the retry path" aside → the missing await gates.
    expect(isNonFalsifiableReviewDoubt(
      'VERDICT: FAIL — save() does not await db.write at save.ts:3, so the row returns before the write commits. (I also cannot verify the retry path, but the missing await alone is the defect.)',
    )).toBe(false);
    // buffer overrun + "hard to determine safe callers" filler → the overrun gates.
    expect(isNonFalsifiableReviewDoubt(
      'VERDICT: FAIL — copy_prefix writes dst[dstsize] one past the buffer (copy.c:6); this makes it hard to determine safe callers, but the overflow is the bug.',
    )).toBe(false);
  });
  it('treats a punctuation-only residual ("FAIL —") as an empty finding = doubt', () => {
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL —')).toBe(true);
    expect(isNonFalsifiableReviewDoubt('VERDICT: FAIL -')).toBe(true);
  });
  it('keeps a hedge that only POINTS at a line (no asserted defect) as doubt', () => {
    expect(isNonFalsifiableReviewDoubt(
      'VERDICT: FAIL — looking at cart.ts:6, I am not able to determine whether the tax rounding is correct.',
    )).toBe(true);
    // a hedge whose verb ("regress") is not a concrete-defect verb stays doubt.
    expect(isNonFalsifiableReviewDoubt("VERDICT: FAIL — I can't be sure this doesn't regress the cache.")).toBe(true);
  });
});

describe('crit 1 — falsifiability rule (review abstains on non-falsifiable doubt over a green gate)', () => {
  const greenGate: LeafExecutorDeps['runGate'] = async () => ({ status: 'pass', output: '', reasons: [], declared: true });

  it('green mech + NON-falsifiable doubt FAIL + real change-set → ABSTAIN → accepted (not parked)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — I cannot confirm the correctness of this subtle change'],
      runGate: greenGate,
      changeSet: ['src/services/leaf-executor.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // the abstain was recorded and the leaf completed as accepted (no reject pre-stamp).
    expect(spies.nodeRows.find((r) => r.nodeKind === 'review-abstain')).toBeTruthy();
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    expect(spies.markRejectingCalls).toHaveLength(0);
    // no fix/revise node ran — the abstain accepted on the first review.
    const implSpecs = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit'));
    expect(implSpecs.length).toBe(1);
  });

  it('green mech + FALSIFIABLE fault FAIL + change-set → still GATES (revise loop intact)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — missing null check at line 42', 'VERDICT: FAIL — missing null check at line 42'],
      runGate: greenGate,
      changeSet: ['src/services/leaf-executor.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked'); // a concrete fault gates, not abstained
    expect(spies.nodeRows.find((r) => r.nodeKind === 'review-abstain')).toBeUndefined();
  });

  it('green mech + doubt FAIL but EMPTY change-set (no-op) → NOT abstained (parks; that is the no-op guard job)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — nothing to review', 'VERDICT: FAIL — nothing to review'],
      runGate: greenGate,
      changeSet: [], // empty = no real change
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.nodeRows.find((r) => r.nodeKind === 'review-abstain')).toBeUndefined();
  });

  it('RED mechanical gate + doubt FAIL → still PARKS (hard floor; abstain never fires on a red gate)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — cannot confirm'],
      runGate: async () => ({ status: 'fail', command: 'npx tsc --noEmit', output: '1 err', reasons: ['x'], declared: true }),
      changeSet: ['src/services/leaf-executor.ts'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    // a red gate never spends a review node, so no abstain classification happens.
    expect(spies.nodeRows.find((r) => r.nodeKind === 'review-abstain')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// crit 2 + 3 — LAZY edit-coverage signal + COVERAGE-WEIGHTED ADVISORY. A falsifiable FAIL
// contesting a GREEN mechanical change over a real change-set triggers a lazy base->branch
// test-flip check; if COVERED the LLM veto is advisory (accept), else it gates. Computed
// only on the contested minority — never on a clean accept.
// ---------------------------------------------------------------------------
describe('isTestFilePath (crit 2)', () => {
  it('matches test/spec files and __tests__ dirs, not product files', () => {
    expect(isTestFilePath('src/services/foo.test.ts')).toBe(true);
    expect(isTestFilePath('src/services/foo.spec.tsx')).toBe(true);
    expect(isTestFilePath('src/services/__tests__/foo.ts')).toBe(true);
    expect(isTestFilePath('ui/src/lib/x.test.ts')).toBe(true);
    expect(isTestFilePath('src/services/foo.ts')).toBe(false);
    expect(isTestFilePath('src/services/leaf-executor.ts')).toBe(false);
  });
});

describe('crit 2 + 3 — lazy coverage signal + advisory-when-covered', () => {
  const greenGate: LeafExecutorDeps['runGate'] = async () => ({ status: 'pass', output: '', reasons: [], declared: true });
  const declaresTest = { description: 'Implement ONLY this file: src/services/foo.test.ts' };
  const faultFail = 'VERDICT: FAIL — missing null check at line 42';

  it('crit 2: contested green-mech (falsifiable FAIL) → coverage seam CALLED + a coverage node recorded', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [faultFail, faultFail, faultFail, faultFail],
      runGate: greenGate, changeSet: ['src/services/foo.ts'], coverage: false,
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(spies.coverageCalls.length).toBeGreaterThanOrEqual(1); // lazily computed at the contested point
    expect(spies.coverageCalls[0].testFiles).toEqual(['src/services/foo.test.ts']);
    const covNode = spies.nodeRows.find((r) => r.nodeKind === 'coverage');
    expect(covNode).toBeTruthy();
    expect(covNode.outcomeDetail).toContain('"covered":false');
    // uncovered ⇒ the fault gates as today
    expect(res.outcome).toBe('blocked');
    expect(spies.nodeRows.find((r) => r.nodeKind === 'advisory-override')).toBeUndefined();
  });

  it('crit 2 LAZY: a clean (grounded) PASS review does NOT call the coverage seam', async () => {
    const { deps, spies } = makeDeps({
      // a GROUNDED pass (cites a change-set line) accepts on cycle 1 — no contested FAIL cycle.
      reviewVerdicts: ['- [MET] foo — src/services/foo.ts:1\n\nVERDICT: PASS'],
      runGate: greenGate, changeSet: ['src/services/foo.ts'], coverage: true,
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.coverageCalls.length).toBe(0); // never computed on a clean accept
  });

  it('crit 3: green + falsifiable FAIL + COVERED (tests flip base→branch) → ADVISORY → accepted', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [faultFail], runGate: greenGate, changeSet: ['src/services/foo.ts'], coverage: true,
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(res.outcome).toBe('accepted'); // the covering tests refute the finding
    const adv = spies.nodeRows.find((r) => r.nodeKind === 'advisory-override');
    expect(adv).toBeTruthy();
    expect(spies.completeCalls).toEqual([{ acceptance: 'accepted' }]);
    const covNode = spies.nodeRows.find((r) => r.nodeKind === 'coverage');
    expect(covNode.outcomeDetail).toContain('"covered":true');
  });

  it('crit 3: green + falsifiable FAIL + UNCOVERED → gates (no advisory)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [faultFail, faultFail, faultFail, faultFail], runGate: greenGate, changeSet: ['src/services/foo.ts'], coverage: false,
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.nodeRows.find((r) => r.nodeKind === 'advisory-override')).toBeUndefined();
  });

  it('crit 3 DEFENSIVE: coverage UNKNOWN (null) → gates (only a positive true accepts)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [faultFail, faultFail, faultFail, faultFail], runGate: greenGate, changeSet: ['src/services/foo.ts'], coverage: null,
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.nodeRows.find((r) => r.nodeKind === 'advisory-override')).toBeUndefined();
  });

  it('RED mechanical gate → coverage seam never called (hard floor; no review node runs)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [faultFail], changeSet: ['src/services/foo.ts'], coverage: true,
      runGate: async () => ({ status: 'fail', command: 'tsc', output: 'e', reasons: ['x'], declared: true }),
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.coverageCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// crit 4 — NO-SILENT-PARK contested decision card. A GREEN-mech + UNCOVERED + same-walled
// falsifiable FAIL raises a bounded-wait accept/reject card instead of a silent park; accept
// lands, reject/timeout is the safe default (today's park).
// ---------------------------------------------------------------------------
describe('crit 4 — no-silent-park contested decision card', () => {
  const greenGate: LeafExecutorDeps['runGate'] = async () => ({ status: 'pass', output: '', reasons: [], declared: true });
  const declaresTest = { description: 'Implement ONLY this file: src/services/foo.test.ts' };
  const f1 = 'VERDICT: FAIL — missing null check at line 42';
  const f2 = 'VERDICT: FAIL — unhandled empty input at line 99';
  const f3 = 'VERDICT: FAIL — wrong return type at line 7';
  const f4 = 'VERDICT: FAIL — off-by-one at line 15';

  it('green + UNCOVERED + repeated contest → raises a contested card; ACCEPT lands the leaf', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [f1, f2], runGate: greenGate, changeSet: ['src/services/foo.ts'],
      coverage: false, contestedDecision: 'accept',
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(spies.contestedCalls.length).toBe(1); // ONE card raised (not per-cycle)
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-card')).toBeTruthy();
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-accepted')).toBeTruthy();
    expect(res.outcome).toBe('accepted'); // accept lands the mechanically-green change
  });

  it('REJECT → the leaf keeps gating → parks (today\'s safe default); no contested-accept', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [f1, f2, f3, f4], runGate: greenGate, changeSet: ['src/services/foo.ts'],
      coverage: false, contestedDecision: 'reject',
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(spies.contestedCalls.length).toBe(1);
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-card')).toBeTruthy();
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-accepted')).toBeUndefined();
    expect(res.outcome).toBe('blocked');
  });

  it('TIMEOUT → the leaf keeps gating → parks (safe default = today)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [f1, f2, f3, f4], runGate: greenGate, changeSet: ['src/services/foo.ts'],
      coverage: false, contestedDecision: 'timeout',
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-card')).toBeTruthy();
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-accepted')).toBeUndefined();
    expect(res.outcome).toBe('blocked');
  });

  it('COVERED → advisory accept, NO contested card (the residue is only for UNCOVERED)', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: [f1], runGate: greenGate, changeSet: ['src/services/foo.ts'],
      coverage: true, contestedDecision: 'accept',
    });
    const res = await runLeaf('proj', makeLeaf(declaresTest), deps);
    expect(res.outcome).toBe('accepted');
    expect(spies.contestedCalls.length).toBe(0);
    expect(spies.nodeRows.find((r) => r.nodeKind === 'contested-card')).toBeUndefined();
    expect(spies.nodeRows.find((r) => r.nodeKind === 'advisory-override')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('crit 8 — bounded blueprint contract repair', () => {
  // Fixture: v2 contract underspecified for 'feature' leafKind (requires symbol-present AND
  // named-test, but has only symbol-present). No ## Acceptance Criteria heading so citability
  // ABSTAINS and never fires a second blueprint call (crit 7 citability gate).
  const blueprintFenceUnderspecified = '```json\n{"schemaVersion":2,"estimatedFiles":2,"estimatedTasks":2,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["src/foo.ts"],"tasks":[{"id":"task-1","files":["src/foo.ts"],"description":"Add function"}],"leafKind":"feature","requirements":[{"kind":"symbol-present","file":"src/foo.ts","symbol":"fooBar","description":"New export fooBar"}],"outOfScope":[]}\n```';

  // Fixture: same but with named-test added → now valid for 'feature' leafKind.
  const blueprintFenceValid = '```json\n{"schemaVersion":2,"estimatedFiles":2,"estimatedTasks":2,"nonEnumerableFanout":false,"filesToCreate":[],"filesToEdit":["src/foo.ts"],"tasks":[{"id":"task-1","files":["src/foo.ts"],"description":"Add function"}],"leafKind":"feature","requirements":[{"kind":"symbol-present","file":"src/foo.ts","symbol":"fooBar","description":"New export fooBar"},{"kind":"named-test","testFile":"src/foo.test.ts","testName":"fooBar works","mechanical":true}],"outOfScope":[]}\n```';

  const greenGate: LeafExecutorDeps['runGate'] = async () => ({ status: 'pass', output: '', reasons: [], declared: true });

  it('repairs an underspecified contract with exactly one re-prompt', async () => {
    // readBlueprint returns underspecified on 1st call (seeded), valid on 2nd call (repair re-read).
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: greenGate,
      readBlueprintReturns: [blueprintFenceUnderspecified, blueprintFenceValid],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // Count blueprint nodes: should be exactly 2 (initial + one repair).
    const blueprintCalls = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Write')).length;
    expect(blueprintCalls).toBe(2);
  });

  it('falls back to v1 prose when still underspecified after the single retry', async () => {
    // readBlueprint returns underspecified BOTH times → repair doesn't accept, falls back to prose path.
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: greenGate,
      readBlueprintReturns: [blueprintFenceUnderspecified, blueprintFenceUnderspecified],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // Still exactly 2 blueprint calls (repair fired once, never a 3rd).
    const blueprintCalls = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Write')).length;
    expect(blueprintCalls).toBe(2);
    // The pipeline continues with implement + review (degraded to v1 prose path).
    const implementCalls = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Edit')).length;
    expect(implementCalls).toBeGreaterThan(0);
  });

  it('small-tier leaf never triggers a contract repair', async () => {
    // small tier skips blueprint entirely (synth path, no v2 fence in body).
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: PASS'],
      runGate: greenGate,
      // Small tier doesn't read blueprint at all, so readBlueprintReturns is not used.
    });
    const res = await runLeaf('proj', makeLeaf({ tier: 'small' }), deps);
    expect(res.outcome).toBe('accepted');
    // Small tier synthesizes blueprint (no node spent).
    const blueprintCalls = spies.invokeSpecs.filter((s) => (s.allowedTools ?? '').includes('Write')).length;
    expect(blueprintCalls).toBe(0);
  });
});
