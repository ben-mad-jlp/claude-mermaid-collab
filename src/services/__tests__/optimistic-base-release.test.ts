/**
 * ADVISORY BASE GATE (fix4, 2026-08-14): leaf dispatch consults the STORED base-gate
 * verdict only — it never awaits a live 10–20min run. A stored pass or NO verdict releases
 * the leaf immediately (and a miss kicks ONE background measurement through the coalescer);
 * only a recent real red — 'fail', within the FAIL freshness cap, naming failing tests —
 * holds. The verdict-store path can no longer persist a vague red (zero named failing
 * tests, or a hard-timeout kill): it stores 'error', which is never served as a hold.
 *
 * Hermetic: no live nodes, no real git; the worker ledger is pointed at a temp dir.
 * Runs via `bun test` (bun:sqlite).
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'optimistic-base-release-'));

import { runLeaf, type LeafExecutorDeps } from '../leaf-executor';
import {
  consultStoredBaseGreen, resolveBaseGreen, demoteVagueBaseRed, GATE_HARD_TIMEOUT_MARKER,
  type LeafGateConfig, type LeafGateResult,
} from '../leaf-gate';
import {
  recordEpicBaseGate, getEpicBaseGate, recordBaseGateVerdict, getBaseGateVerdict,
} from '../worker-ledger';
import { baseGateKey, sharedVerdictKey, quarantineSetHash, resetBaseGateCoalescer, BASE_GATE_FAIL_VERDICT_TTL_MS } from '../base-gate-coalescer';
import type { Todo } from '../todo-store';
import type { NodeResult, NodeSpec } from '../../agent/node-invoker';

const EPIC_BRANCH = 'collab/epic/abcd1234';
const EPIC_ID = 'epic-abcd1234';
const CFG: LeafGateConfig = { baseTest: 'bun test' };

function makeLeaf(over: Partial<Todo> = {}): Todo {
  return {
    id: '5c58cf82-87bf-49c4-b01a-bee5fc66502d',
    ownerSession: 'sess',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: 'optimistic release leaf',
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
    ok: true, exitCode: 0, stdout: text, durationMs: 1, rateLimited: false,
    authMode: 'subscription', text,
  };
}

function isBlueprintSpec(spec: NodeSpec): boolean {
  return (spec.allowedTools ?? '').includes('Write') && !(spec.allowedTools ?? '').includes('Edit');
}

function makeDeps(opts: {
  consultBaseVerdict?: LeafExecutorDeps['consultBaseVerdict'];
  ensureBaseGreen?: LeafExecutorDeps['ensureBaseGreen'];
}): { deps: LeafExecutorDeps } {
  const deps: LeafExecutorDeps = {
    invoker: {
      async invoke(spec: NodeSpec): Promise<NodeResult> {
        const isReview = (spec.allowedTools ?? '').startsWith('Read Grep Glob Bash');
        if (isBlueprintSpec(spec)) return okResult('done');
        if (isReview) return okResult('VERDICT: PASS');
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
    async complete(_p, _t, acceptance) { return { effective: acceptance }; },
    async markRejecting() { return true; },
    async bumpRetry() { return true; },
    async refundRetry() { return true; },
    async releaseClaim() { return true; },
    async holdLeaf() { return true; },
    async mergeToEpic() { return {}; },
    escalate() {},
    recordNode: () => null as never,
    setInflight: () => {},
    clearInflight: () => {},
    runGate: async () => ({ status: 'pass', output: '', reasons: [], declared: true }),
    consultBaseVerdict: opts.consultBaseVerdict,
    ensureBaseGreen: opts.ensureBaseGreen,
    worktreeDirty: () => [],
  } as LeafExecutorDeps;
  return { deps };
}

describe('advisory base gate: optimistic dispatch release', () => {
  it('no stored verdict → the leaf proceeds past the base block immediately AND exactly one background measurement is enqueued', async () => {
    let measureCalls = 0;
    const { deps } = makeDeps({
      consultBaseVerdict: () => null,
      // Simulates a live 20-minute run: NEVER resolves. Pre-fix, dispatch awaited this and
      // the leaf starved (this test then times out red). Post-fix it must only be kicked
      // off fire-and-forget.
      ensureBaseGreen: () => { measureCalls += 1; return new Promise(() => {}); },
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    expect(res.reason ?? '').not.toMatch(/^epic-base-red/);
    expect(res.outcome).toBe('accepted');
    expect(measureCalls).toBe(1);
  });

  it("stored fresh 'fail' with named failing files → parks with today's reason shape, no live run", async () => {
    let measureCalls = 0;
    const { deps } = makeDeps({
      consultBaseVerdict: () => ({
        status: 'fail', command: 'bun test', output: 'FAIL src/x.test.ts',
        reasons: [], declared: true, fresh: false,
      }),
      ensureBaseGreen: () => { measureCalls += 1; return new Promise(() => {}); },
    });
    const res = await runLeaf('proj', makeLeaf(), deps);
    // Same reason shape as today: "epic-base-red: <command>" + output tail. (Asserted via
    // string literal, not a regex — the nested-runner lane classifier strips literals but
    // not regex bodies, and this file must stay in the fast lane.)
    expect((res.reason ?? '').startsWith('epic-base-red: bun test')).toBe(true);
    expect(res.nodesSpent).toBe(0);
    expect(measureCalls).toBe(0); // a hold consults the store only — never spawns the run
  });
});

describe('consultStoredBaseGreen: only a recent real red holds', () => {
  const T = 1_700_000_000_000;

  it('epic-cache fail with named failing files, within the freshness cap → holds', () => {
    const epicId = 'epic-hold-named';
    // Two fail writes at the same sha: shouldHonourCachedBaseGate believes a red only
    // after BASE_GATE_FAIL_REVERIFY_ATTEMPTS — a first red never holds (unchanged).
    for (let i = 0; i < 2; i++) {
      recordEpicBaseGate({ epicId, project: 'proj', baseSha: 'sha-a', status: 'fail', command: 'bun test', output: 'FAIL src/x.test.ts' }, T);
    }
    const r = consultStoredBaseGreen({ epicId, targetProject: '/proj', epicBaseSha: 'sha-a', gateCfg: CFG, now: () => T + 60_000 });
    expect(r?.status).toBe('fail');
    expect(r?.fresh).toBe(false);
  });

  it('epic-cache fail naming ZERO failing tests → releases (miss)', () => {
    const epicId = 'epic-vague';
    for (let i = 0; i < 2; i++) {
      recordEpicBaseGate({ epicId, project: 'proj', baseSha: 'sha-b', status: 'fail', command: 'bun test', output: 'exit code 1' }, T);
    }
    const r = consultStoredBaseGreen({ epicId, targetProject: '/proj', epicBaseSha: 'sha-b', gateCfg: CFG, now: () => T + 60_000 });
    expect(r).toBeNull();
  });

  it('epic-cache fail older than the FAIL freshness cap → releases (miss)', () => {
    const epicId = 'epic-stale';
    for (let i = 0; i < 2; i++) {
      recordEpicBaseGate({ epicId, project: 'proj', baseSha: 'sha-c', status: 'fail', command: 'bun test', output: 'FAIL src/x.test.ts' }, T);
    }
    const r = consultStoredBaseGreen({ epicId, targetProject: '/proj', epicBaseSha: 'sha-c', gateCfg: CFG, now: () => T + BASE_GATE_FAIL_VERDICT_TTL_MS + 1 });
    expect(r).toBeNull();
  });

  it('epic-cache pass → released as pass', () => {
    const epicId = 'epic-pass';
    recordEpicBaseGate({ epicId, project: 'proj', baseSha: 'sha-d', status: 'pass', command: 'bun test', output: '' }, T);
    const r = consultStoredBaseGreen({ epicId, targetProject: '/proj', epicBaseSha: 'sha-d', gateCfg: CFG, now: () => T + 60_000 });
    expect(r?.status).toBe('pass');
  });

  it('shared-verdict layer: fresh named fail holds; stale fail and no row release', () => {
    const sha = 'sha-shared-1';
    const key = sharedVerdictKey(baseGateKey('/proj', sha, CFG), quarantineSetHash([]));
    const failResult: LeafGateResult = { status: 'fail', command: 'bun test', output: 'FAIL src/y.test.ts', reasons: [], declared: true };
    recordBaseGateVerdict({ key, project: '/proj', baseSha: sha, status: 'fail', resultJson: JSON.stringify(failResult), quarantineHash: quarantineSetHash([]) }, T);

    const held = consultStoredBaseGreen({ epicId: 'epic-none-1', targetProject: '/proj', epicBaseSha: sha, gateCfg: CFG, now: () => T + 60_000 });
    expect(held?.status).toBe('fail');
    expect(held?.fresh).toBe(false);

    const stale = consultStoredBaseGreen({ epicId: 'epic-none-1', targetProject: '/proj', epicBaseSha: sha, gateCfg: CFG, now: () => T + BASE_GATE_FAIL_VERDICT_TTL_MS + 1 });
    expect(stale).toBeNull();

    const noRow = consultStoredBaseGreen({ epicId: 'epic-none-2', targetProject: '/proj', epicBaseSha: 'sha-unmeasured', gateCfg: CFG, now: () => T });
    expect(noRow).toBeNull();
  });
});

describe('verdict-store path: a vague red is stored as error, never fail', () => {
  it('demoteVagueBaseRed: hard-timeout kill and zero-name reds become error; a named red passes through', () => {
    const named: LeafGateResult = { status: 'fail', command: 'bun test', output: 'FAIL src/x.test.ts', reasons: [], declared: true };
    expect(demoteVagueBaseRed(named)).toBe(named);
    const vague = demoteVagueBaseRed({ status: 'fail', command: 'bun test', output: 'exit code 1', reasons: [], declared: true });
    expect(vague.status).toBe('error');
    const killed = demoteVagueBaseRed({ status: 'fail', command: 'bun test', output: `FAIL src/x.test.ts\n${GATE_HARD_TIMEOUT_MARKER}`, reasons: [], declared: true });
    expect(killed.status).toBe('error');
    expect(demoteVagueBaseRed({ status: 'pass', output: '', reasons: [], declared: true }).status).toBe('pass');
  });

  it('a run that hit the hard timeout resolves to error and persists NOTHING (holds nobody)', async () => {
    resetBaseGateCoalescer();
    const epicId = 'epic-timeout';
    const sha = 'sha-timeout';
    const r = await resolveBaseGreen({
      epicId,
      project: 'proj',
      targetProject: '/proj-timeout',
      epicBaseSha: sha,
      gateCfg: CFG,
      ensureEpicWorktree: async () => ({ path: '/tmp/never-touched' }),
      runGate: async () => ({ status: 'fail', command: 'bun test', output: `some noise\n${GATE_HARD_TIMEOUT_MARKER}`, reasons: [], declared: true }),
      now: () => Date.now(),
    });
    expect(r?.status).toBe('error');
    // Neither store kept it: the epic row is absent and the shared verdict is absent.
    expect(getEpicBaseGate(epicId, sha)).toBeNull();
    expect(getBaseGateVerdict(sharedVerdictKey(baseGateKey('/proj-timeout', sha, CFG), quarantineSetHash([])))).toBeNull();
    // And the advisory consult holds nobody on it.
    expect(consultStoredBaseGreen({ epicId, targetProject: '/proj-timeout', epicBaseSha: sha, gateCfg: CFG })).toBeNull();
  });

  it('a red naming zero failing tests resolves to error and persists NOTHING', async () => {
    resetBaseGateCoalescer();
    const epicId = 'epic-nameless';
    const sha = 'sha-nameless';
    const r = await resolveBaseGreen({
      epicId,
      project: 'proj',
      targetProject: '/proj-nameless',
      epicBaseSha: sha,
      gateCfg: CFG,
      ensureEpicWorktree: async () => ({ path: '/tmp/never-touched' }),
      runGate: async () => ({ status: 'fail', command: 'bun test', output: 'exit code 1 with nothing parseable', reasons: [], declared: true }),
      now: () => Date.now(),
    });
    expect(r?.status).toBe('error');
    expect(getEpicBaseGate(epicId, sha)).toBeNull();
    expect(getBaseGateVerdict(sharedVerdictKey(baseGateKey('/proj-nameless', sha, CFG), quarantineSetHash([])))).toBeNull();
  });
});
