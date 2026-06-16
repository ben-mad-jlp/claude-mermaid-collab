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
  parseSizeManifest,
  shouldUseFloor,
  FILE_THRESHOLD,
  TASK_THRESHOLD,
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

  it('coerces a missing/garbled tasks array to []', () => {
    const { tasks, ...noTasks } = good;
    const m = parseSizeManifest(block(noTasks));
    expect(m).not.toBeNull();
    expect(m!.tasks).toEqual([]);
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
  nodeBudget?: number;
  /** verify text per call, in order; defaults to 'TSC: CLEAN'. */
  verifyTexts?: string[];
}

function makeWaveDeps(opts: WaveOpts): { deps: LeafExecutorDeps; calls: string[] } {
  const calls: string[] = [];
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
        if (kind === 'review') return okResult(opts.reviewVerdict ?? 'VERDICT: PASS');
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
});
