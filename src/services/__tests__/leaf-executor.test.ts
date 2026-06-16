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
  buildNodePrompt,
  NODE_BUDGET,
  type LeafExecutorDeps,
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
}): { deps: LeafExecutorDeps; spies: Spies } {
  const spies: Spies = {
    ensureCalls: [],
    invokeSpecs: [],
    completeCalls: [],
    mergeCalls: 0,
    escalations: [],
  };
  let reviewIdx = 0;
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        spies.invokeSpecs.push(spec);
        // The review node is the opus read-only one (no Write/Edit in allowedTools).
        const isReview = spec.allowedTools === 'Read Grep Glob Bash';
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

describe('parseVerdict (fail-closed)', () => {
  it('PASS only on an explicit VERDICT: PASS line', () => {
    expect(parseVerdict('blah\nVERDICT: PASS')).toBe('pass');
    expect(parseVerdict('VERDICT: PASS — looks good')).toBe('pass');
    expect(parseVerdict('VERDICT: FAIL — nope')).toBe('fail');
    expect(parseVerdict('no verdict line at all')).toBe('fail');
    expect(parseVerdict(undefined)).toBe('fail');
    expect(parseVerdict('')).toBe('fail');
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
    expect(res.nodesSpent).toBe(6);
    // 2 fresh worktrees, one per attempt
    expect(spies.ensureCalls.length).toBe(2);
    // no 'accepted' completion ever; only the final blocked-path reject
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]);
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(true);
  });

  it('retry then pass → 2 attempts, 6 nodes, accepted, two fresh worktrees', async () => {
    const { deps, spies } = makeDeps({
      reviewVerdicts: ['VERDICT: FAIL — first', 'VERDICT: PASS'],
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('accepted');
    expect(res.attempts).toBe(2);
    expect(res.nodesSpent).toBe(6);
    expect(spies.ensureCalls.length).toBe(2);
    expect(spies.mergeCalls).toBe(1);
  });

  it('(iii) node budget: BLOCKED once nodesSpent exceeds the budget, regardless of verdict', async () => {
    // Default backstop is 20; the floor structurally spends ≤6 nodes (3/attempt × cap
    // 2). To exercise the budget CEILING deterministically (a runaway node), inject a
    // budget of 2: even a PASS-able run trips the budget mid-attempt (after the 3rd
    // node, nodesSpent=3 > 2) and parks BLOCKED 'node-budget-exhausted' — proving the
    // budget check fires before acceptance, independent of the attempt cap.
    expect(NODE_BUDGET).toBe(20);
    const { deps, spies } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'] });
    deps.nodeBudget = 2;
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('blocked');
    expect(res.reason).toBe('node-budget-exhausted');
    expect(res.nodesSpent).toBe(3); // tripped right after the budget was exceeded
    expect(res.attempts).toBe(1); // mid first attempt — never reached a 2nd
    expect(spies.completeCalls).toEqual([{ acceptance: 'rejected' }]); // blocked-path reject only
    expect(spies.escalations.some((e) => e.kind === 'blocker')).toBe(true);
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

  it('gate downgrade: PASS but gate returns pending ⇒ outcome rejected (not accepted)', async () => {
    const { deps } = makeDeps({ reviewVerdicts: ['VERDICT: PASS'], gateEffective: 'pending' });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.outcome).toBe('rejected');
    expect(res.reason).toBe('gate-pending');
  });
});
