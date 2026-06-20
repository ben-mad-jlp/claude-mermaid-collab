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
  isTscClean,
  buildNodePrompt,
  parseSizeManifest,
  shouldUseFloor,
  leafExecutionMode,
  parseVerifyGate,
  buildVerifyPrompt,
  resolveVerifyGate,
  verbMcpTool,
  VERIFY_GATE_VERB,
  VERIFY_EXEC_TIMEOUT_MS,
  FILE_THRESHOLD,
  TASK_THRESHOLD,
  NODE_BUDGET,
  deprecatePriorAttempts,
  blueprintAttemptName,
  planResume,
  type LeafExecutorDeps,
  type LeafSizeManifest,
} from '../leaf-executor';
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
}

/** Build a deps object whose invoker returns the supplied scripted REVIEW verdicts
 *  (one per attempt). blueprint+implement always return ok. */
function makeDeps(opts: {
  reviewVerdicts?: string[]; // 'VERDICT: PASS' | 'VERDICT: FAIL — x' | '' per review call
  gateEffective?: 'accepted' | 'rejected' | 'pending';
  authThrows?: boolean;
  mergeThrows?: boolean;
  blueprintFails?: number; // first N blueprint-node invocations return ok:false (non-rate-limited)
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = {
    ensureCalls: [],
    invokeSpecs: [],
    completeCalls: [],
    mergeCalls: 0,
    escalations: [],
  };
  let reviewIdx = 0;
  let bpFailsLeft = opts.blueprintFails ?? 0;
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
      // Only the two methods the executor touches are needed.
      async ensure(sessionKey: string, o: { baseBranch?: string; fresh?: boolean }) {
        spies.ensureCalls.push({ sessionKey, opts: o ?? {} });
        return { isGit: true, path: `/tmp/wt/${spies.ensureCalls.length}`, branch: 'b', baseBranch: o?.baseBranch ?? 'm' } as never;
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
      return { effective: opts.gateEffective ?? acceptance };
    },
    async mergeToEpic() {
      spies.mergeCalls += 1;
      if (opts.mergeThrows) throw new Error('conflict');
      return {};
    },
    escalate(input) {
      spies.escalations.push({ kind: input.kind, questionText: input.questionText });
    },
    recordNode: () => null,
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
});

describe('parseVerdict (fail-closed)', () => {
  it('PASS only on an explicit VERDICT: PASS line', () => {
    expect(parseVerdict('blah\nVERDICT: PASS')).toBe('pass');
    expect(parseVerdict('VERDICT: PASS — looks good')).toBe('pass');
    expect(parseVerdict('VERDICT: FAIL — nope')).toBe('fail');
    expect(parseVerdict('no verdict line at all')).toBe('fail');
    expect(parseVerdict(undefined)).toBe('fail');
    expect(parseVerdict('')).toBe('fail');
  });
  it('tolerates markdown wrapping the model echoes from the prompt (backticks/bold)', () => {
    // The L4 false-stuck class: the prompt SHOWS `VERDICT: PASS` in backticks, so the
    // model echoes them — a line-anchored regex must not be defeated by the wrapper.
    expect(parseVerdict('`VERDICT: PASS`')).toBe('pass');
    expect(parseVerdict('**VERDICT: PASS**')).toBe('pass');
  });
});

describe('isTscClean (tolerant of markdown wrapping — L4 waves-file-stuck root cause)', () => {
  it('treats backtick/bold-wrapped + empty as clean, real errors as not-clean', () => {
    expect(isTscClean('`TSC: CLEAN`')).toBe(true);   // the exact L4 case
    expect(isTscClean('TSC: CLEAN')).toBe(true);
    expect(isTscClean('**TSC: CLEAN**')).toBe(true);
    expect(isTscClean('')).toBe(true);               // nothing to report = clean
    expect(isTscClean(undefined)).toBe(true);
    expect(isTscClean('error TS2339: Property x does not exist')).toBe(false);
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
    // review prompt asks for the VERDICT contract
    expect(buildNodePrompt('review', makeLeaf())).toContain('VERDICT: PASS');
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

  it('merge-and-merge order: commitAndMergeToEpic happens BEFORE complete(accepted)', async () => {
    // mergeThrows → executor must NOT have called complete('accepted'); it parks blocked.
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], mergeThrows: true });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]); // only the blocked-path reject
    expect(spies.escalations[0].kind).toBe('blocker');
  });

  it('(ii) fail→fail across 2 attempts → escalation + no accepted completion', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — a', 'VERDICT: FAIL — b'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('attempt-cap-exhausted');
    expect(res.attempts).toBe(2);
    // P6: each attempt spends 5 nodes (blueprint + implement + review + reuse-implement
    // + reuse-review) before the in-place reuse is exhausted and a fresh attempt starts.
    expect(res.nodesSpent).toBe(10);
    // 2 fresh worktrees, one per attempt (the in-place reuse stays in the same worktree)
    expect(spies.ensureCalls.length).toBe(2);
    // no 'accepted' completion ever; only the final blocked-path reject
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(true);
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
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — a', 'VERDICT: FAIL — b'],
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

  it('unparseable verdict ⇒ treated as FAIL (fail-closed) → blocked after cap', async () => {
    const { deps } = makeDeps({ reviewVerdicts: ['(no verdict)', '(still none)'] });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('attempt-cap-exhausted');
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

describe('shouldUseFloor (size gate, each boundary)', () => {
  const mk = (over: object) => ({
    schemaVersion: 1, estimatedFiles: 1, estimatedTasks: 1, nonEnumerableFanout: false,
    filesToCreate: [], filesToEdit: [], tasks: [], ...over,
  });
  it('null ⇒ FLOOR (fail-safe)', () => expect(shouldUseFloor(null)).toBe(true));
  it('at thresholds ⇒ FLOOR', () => {
    expect(shouldUseFloor(mk({ estimatedFiles: FILE_THRESHOLD, estimatedTasks: TASK_THRESHOLD }))).toBe(true);
  });
  it('files over threshold ⇒ WAVES', () => {
    expect(shouldUseFloor(mk({ estimatedFiles: FILE_THRESHOLD + 1 }))).toBe(false);
  });
  it('tasks over threshold ⇒ WAVES', () => {
    expect(shouldUseFloor(mk({ estimatedTasks: TASK_THRESHOLD + 1 }))).toBe(false);
  });
  it('non-enumerable fan-out at small size ⇒ WAVES', () => {
    expect(shouldUseFloor(mk({ estimatedFiles: 2, nonEnumerableFanout: true }))).toBe(false);
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
  splitCalls?: Array<{ leafId: string; files: string[] }>;
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
      ? async (lf, files) => { opts.splitCalls!.push({ leafId: lf.id, files }); }
      : undefined,
    persistBlueprint: opts.persistCalls
      ? async ({ project, attempt, manifest, blueprintMd }) => {
          opts.persistCalls!.push({ project, attempt, manifest, blueprintMd });
          return `doc-${attempt}`;
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

  it('(b) big estimate ⇒ WAVES (research/wimplement/verify per task/file, then review)', async () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, files: [`f${i}.ts`], description: `d${i}` }));
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 8, estimatedTasks: 8, nonEnumerableFanout: false, filesToCreate: tasks.map((t) => t.files[0]), filesToEdit: [], tasks },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 100, // a full 8-task wave run spends ~27 nodes; raise the backstop so it completes
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // No floor 'implement' node ran.
    expect(calls).not.toContain('implement');
    expect(calls.filter((c) => c === 'research').length).toBe(8); // one per task
    expect(calls.filter((c) => c === 'wimplement').length).toBe(8); // one per file
    // 8 per-file verifies + 1 wave-level gate verify.
    expect(calls.filter((c) => c === 'verify').length).toBe(9);
    expect(calls[calls.length - 1]).toBe('review');
  });

  it('(c) waves hit NODE_BUDGET ⇒ BLOCKED mid-wave', async () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, files: [`f${i}.ts`], description: `d${i}` }));
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 8, estimatedTasks: 8, nonEnumerableFanout: false, filesToCreate: tasks.map((t) => t.files[0]), filesToEdit: [], tasks },
      nodeBudget: 3, // blueprint(1) + a couple research nodes then over budget
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('node-budget-exhausted');
  });

  it('(d) unparseable size block ⇒ FLOOR (fail-safe)', async () => {
    const { deps, calls } = makeWaveDeps({ manifest: 'no json fence at all', reviewVerdict: 'VERDICT: PASS' });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(calls).toEqual(['blueprint', 'implement', 'review']);
  });

  it('(e) nonEnumerableFanout=true at files=2 ⇒ WAVES (gate overridden by flag)', async () => {
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 2, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: ['a.ts'], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(calls).toContain('research');
    expect(calls).not.toContain('implement');
  });

  it('(f) per-file fix stuck (same error twice) ⇒ BLOCKED waves-file-stuck', async () => {
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 5, estimatedTasks: 1, nonEnumerableFanout: false, filesToCreate: [], filesToEdit: ['a.ts'], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] },
      // verify for a.ts: error, then (after fix) the SAME error again ⇒ stuck.
      verifyTexts: ['error TS1: boom', 'error TS1: boom'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('waves-file-stuck');
  });

  it('(i) WAVES gate: a FOREIGN-only tsc error (file the leaf never touched) PASSES when scoped', async () => {
    // The build123d ec4c082d failure: every own-file verify clean, but the project-wide
    // gate tripped on a pre-existing error in an untouched file. With the change-set wired,
    // the foreign-only failure must be scoped away and the leaf accepted.
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 2, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: ['a.ts'], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
      changeSet: ['a.ts'],
      // per-file a.ts verify clean; the GATE verify reports an error in an untouched file.
      verifyTexts: ['TSC: CLEAN', 'foreign/other.ts(12,3): error TS2307: Cannot find module'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.reason).not.toBe('waves-tsc-gate-failed');
  });

  it('(j) WAVES gate: an IN-SCOPE tsc error (in a file the leaf changed) still BLOCKS', async () => {
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 2, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: ['a.ts'], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] },
      changeSet: ['a.ts'],
      verifyTexts: ['TSC: CLEAN', 'a.ts(5,2): error TS2322: type mismatch'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('waves-tsc-gate-failed');
  });

  it('(k) WAVES gate: with the change-set UNWIRED, any gate error BLOCKS (fail-closed, unchanged)', async () => {
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 2, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: ['a.ts'], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] },
      // NO changeSet → seam unwired → null → fail closed even on a foreign error.
      verifyTexts: ['TSC: CLEAN', 'foreign/other.ts(1,1): error TS2307: x'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('waves-tsc-gate-failed');
  });

  it('(l) WAVES no-op skip: a wimplement that changes nothing skips its per-file verify', async () => {
    // Budget-burn regression: an already-satisfied file (not in the change-set after its
    // wimplement) must NOT spend a verify node. a.ts is touched, b.ts is already done.
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 2, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: ['a.ts', 'b.ts'], tasks: [{ id: 't', files: ['a.ts', 'b.ts'], description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
      changeSet: ['a.ts'], // only a.ts was actually changed; b.ts is a no-op
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(calls.filter((c) => c === 'wimplement').length).toBe(2); // both files implemented
    // Only a.ts gets a per-file verify; b.ts is skipped. Plus the 1 wave-level gate verify.
    expect(calls.filter((c) => c === 'verify').length).toBe(2);
  });

  it('(m) over-ceiling enumerable manifest ⇒ SPLIT pre-flight (no floor/waves nodes run)', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; files: string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 14, estimatedTasks: 3, nonEnumerableFanout: false, filesToCreate: files, filesToEdit: [], tasks: [] },
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('split');
    expect(splitCalls.length).toBe(1);
    expect([...splitCalls[0].files].sort()).toEqual([...files].sort());
    // Split happens AFTER blueprint but BEFORE any implement/research/verify work.
    expect(calls).toEqual(['blueprint']);
  });

  it('(n) over-ceiling but NON-ENUMERABLE fanout ⇒ no split, falls through to WAVES', async () => {
    const files = Array.from({ length: 14 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; files: string[] }> = [];
    const { deps, calls } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 14, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: [], filesToEdit: files, tasks: [{ id: 't', files, description: 'x' }] },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 200,
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // non-enumerable can't be partitioned → no split
    expect(calls).toContain('wimplement'); // ran the WAVES path instead
    expect(res.outcome).toBe('accepted');
  });

  it('(o) enumerable but at/below the ceiling ⇒ no split (runs normally)', async () => {
    const files = Array.from({ length: 8 }, (_, i) => `f${i}.ts`);
    const splitCalls: Array<{ leafId: string; files: string[] }> = [];
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 8, estimatedTasks: 8, nonEnumerableFanout: false, filesToCreate: files, filesToEdit: [], tasks: files.map((f, i) => ({ id: `t${i}`, files: [f], description: 'd' })) },
      reviewVerdict: 'VERDICT: PASS',
      nodeBudget: 200,
      splitCalls,
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(splitCalls.length).toBe(0); // 8 ≤ SPLIT_CEILING (12)
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

  it('(h) large multi-file waves leaf does NOT budget-exhaust on the DEFAULT budget (L4 regression)', async () => {
    // L4: a 6-file leaf spent ~21 nodes (blueprint+6 research+6 wimplement+7 verify+review),
    // exceeding the floor-sized NODE_BUDGET=20 → false node-budget-exhausted. The waves path
    // must size its budget to the manifest. No explicit nodeBudget here → size-aware applies.
    const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, files: [`f${i}.ts`], description: `d${i}` }));
    const { deps } = makeWaveDeps({
      manifest: { schemaVersion: 1, estimatedFiles: 6, estimatedTasks: 6, nonEnumerableFanout: false, filesToCreate: tasks.map((t) => t.files[0]), filesToEdit: [], tasks },
      reviewVerdict: 'VERDICT: PASS',
      // NO nodeBudget — exercise the default (size-aware) ceiling.
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.reason).not.toBe('node-budget-exhausted');
  });

  it('(g) wave wimplement/fix INLINE the blueprint + research (waves-file-stuck regression)', async () => {
    // The live L3 run got `waves-file-stuck` because wimplement was told to READ the
    // blueprint/research off disk, but they were not present in the fresh worktree → the
    // node implemented blind. The wave prompts must INLINE that context (mirrors the P2
    // b77dd104 fix). Capture the wimplement + fix prompts and assert the text is inlined.
    const BP_MARKER = 'BLUEPRINT-BODY-MARKER-7f3a';
    const RESEARCH_MARKER = 'RESEARCH-FINDING-MARKER-9b2c';
    const prompts: Record<string, string> = {};
    let verifyIdx = 0;
    const deps: LeafExecutorDeps = {
      invoker: {
        async invoke(spec: NodeSpec): Promise<NodeResult> {
          const kind = waveKindOf(spec);
          if (kind === 'wimplement' && !prompts.wimplement) prompts.wimplement = spec.prompt;
          if (kind === 'fix' && !prompts.fix) prompts.fix = spec.prompt;
          if (kind === 'research') return okResult(RESEARCH_MARKER);
          if (kind === 'review') return okResult('VERDICT: PASS');
          if (kind === 'verify') { const t = verifyIdx === 0 ? 'error TS1: boom' : 'TSC: CLEAN'; verifyIdx += 1; return okResult(t); }
          return okResult('done');
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
      nodeBudget: 100,
      // The blueprint artifact text the readBlueprint seam returns — carries the marker
      // AND the size manifest that routes to waves.
      readBlueprint: async () => `# bp ${BP_MARKER}\n\n\`\`\`json\n${JSON.stringify({ schemaVersion: 1, estimatedFiles: 8, estimatedTasks: 1, nonEnumerableFanout: true, filesToCreate: ['a.ts'], filesToEdit: [], tasks: [{ id: 't', files: ['a.ts'], description: 'x' }] })}\n\`\`\`\n`,
    };
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    // wimplement inlines BOTH the blueprint body and the research findings, and does NOT
    // fall back to the disk-read instruction.
    expect(prompts.wimplement).toContain(BP_MARKER);
    expect(prompts.wimplement).toContain(RESEARCH_MARKER);
    expect(prompts.wimplement).not.toContain('Read the blueprint at');
    // the fix node (it ran — verify errored once) inlines the blueprint too.
    expect(prompts.fix).toContain(BP_MARKER);
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
    // Two DISTINCT fails exhaust the in-place reuse on attempt 1 → a fresh attempt 2
    // (each fresh attempt re-blueprints → one persist per attempt).
    const { deps } = makeWaveDeps({
      manifest: smallManifest,
      reviewVerdicts: ['VERDICT: FAIL — a', 'VERDICT: FAIL — b', 'VERDICT: PASS'],
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
        const isReport = tools.includes('add_session_todo');
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
    expect(kinds.filter((t) => t.includes('Write') && !t.includes('build_assembly_plan') && !t.includes('add_session_todo')).length).toBe(1); // plan
    expect(kinds.some((t) => t.includes('build_assembly_plan'))).toBe(true); // exec
    expect(kinds.some((t) => t.includes('add_session_todo'))).toBe(true); // report
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
      if (tools.includes('add_session_todo')) return okResult('   '); // blank report
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
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('add_session_todo'))).toBe(false);
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
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('add_session_todo'))).toBe(false);
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
    expect(spies.invokeSpecs.some((s) => (s.allowedTools ?? '').includes('add_session_todo'))).toBe(false);
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
});
