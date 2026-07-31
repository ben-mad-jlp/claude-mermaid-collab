/**
 * Composed sibling-consistency proof over one injected base failure.
 *
 * Two sibling leaves (alpha, beta) attribute the SAME base-gate tsc failure via the real
 * `classifyGateFailure` and terminate `blocked` with a matching `gateFailureSignature` —
 * the file-level proof that the signature is order/leaf-independent for the same
 * command+failing-file set. A third sibling (gamma) whose own change-set covers the
 * failing file is the negative control: the same injected failure still rejects it
 * `gate-rejected`, proving the classifier isn't a degenerate "always park".
 *
 * Composed in the style of `gate-baseline-differential.test.ts` (`stubSpawn` keyed by exact
 * command string) and `leaf-executor-base-red-fi.test.ts` (minimal `LeafExecutorDeps`
 * stand-in for the `skip-to-gate` resume branch).
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBaseGate, type GateSpawn, type LeafGateConfig } from '../leaf-gate';
import { classifyGateFailure, type GateFailureClassification } from '../gate-base-attribution';
import { createTodo, getTodo, _closeProject } from '../todo-store';
import { runLeaf, type LeafExecutorDeps } from '../leaf-executor';
import type { Todo } from '../todo-store';
import { getLeafBlueprint, recordLeafBlueprint } from '../worker-ledger';

// Set ONCE at module load (not per-test): orchestrator-config.ts caches its Database
// handle in a module singleton, so re-pointing/removing MERMAID_SUPERVISOR_DIR between
// tests (as the per-project todo-store dir does) would leave that singleton pointing at
// a deleted file (disk I/O error) on the second test. Matches
// leaf-executor-base-red-fi.test.ts's top-of-file pattern.
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'gate-base-red-sibling-config-'));

/** Builds a scripted GateSpawn: keyed by exact command string, records every call. */
function stubSpawn(script: Record<string, { ran: boolean; code?: number; output?: string }>) {
  const calls: Array<{ cwd: string; command: string }> = [];
  const spawn: GateSpawn = async (cwd, command) => {
    calls.push({ cwd, command });
    const s = script[command];
    if (!s) throw new Error(`unscripted command: ${command}`);
    return { ran: s.ran, code: s.code ?? 0, output: s.output ?? '' };
  };
  return { spawn, calls };
}

const TSC_CMD = 'npx tsc --noEmit';
const BASE_CFG: LeafGateConfig = { typecheck: TSC_CMD };
const BASE_FAIL_OUTPUT = 'src/untouched.ts(3,1): error TS2304: x';

function makeLeaf(over: Partial<Todo> & { id: string; title: string }): Todo {
  return {
    ownerSession: 's1',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: '',
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
    sessionName: `leaf-exec-${over.id.slice(0, 8)}`,
    executedBySession: `leaf-exec-${over.id.slice(0, 8)}`,
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
    ...over,
  };
}

function okResult() {
  return {
    ok: true,
    exitCode: 0,
    stdout: 'done',
    durationMs: 1,
    rateLimited: false,
    authMode: 'subscription' as const,
    text: 'done',
  };
}

/** A minimal LeafExecutorDeps whose `complete` runs the REAL `classifyGateFailure` against
 *  the injected base failure and `ownChangeSet`, capturing every classification produced. */
function makeSkipToGateDeps(
  ownChangeSet: string[],
  baseCommand: string,
  baseOutput: string,
): { deps: LeafExecutorDeps; captured: GateFailureClassification[]; completions: Array<{ effective?: string }> } {
  const captured: GateFailureClassification[] = [];
  const completions: Array<{ effective?: string }> = [];
  const deps: LeafExecutorDeps = {
    invoker: { async invoke() { return okResult(); } },
    wm: {
      async ensure() { return { isGit: true, path: '/tmp/wt', branch: 'b', baseBranch: 'master' } as never; },
      async remove() {},
    } as never,
    epicId: 'epic-1',
    epicBranch: 'collab/epic/1',
    assertAuth: () => 'subscription',
    async complete() {
      const cls = classifyGateFailure({ command: baseCommand, output: baseOutput, ownChangeSet });
      captured.push(cls);
      if (cls.kind === 'epic-base-red') {
        completions.push({ effective: undefined });
        return { baseRed: { command: baseCommand, failingFiles: cls.failingFiles, signature: cls.signature } };
      }
      completions.push({ effective: 'rejected' });
      return { effective: 'rejected' as const, gateReasons: [`own defect: ${cls.failingFiles.join(', ')}`] };
    },
    async mergeToEpic() { return {}; },
    escalate() {},
    recordNode: (async () => {}) as unknown as LeafExecutorDeps['recordNode'],
    resumePlan: { mode: 'skip-to-gate', reason: 'work-merged' },
    nodeProfileOverrides: {},
    ensureBaseGreen: async () => ({
      status: 'pass', command: TSC_CMD, output: '', reasons: [], declared: true, fresh: true,
    }),
  };
  return { deps, captured, completions };
}

describe('composed sibling-consistency proof over one injected base failure', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'gate-base-red-sibling-'));
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  test('two siblings attributed the same injected base failure terminate blocked with a matching gateFailureSignature', async () => {
    const { spawn: baseSpawn } = stubSpawn({
      [TSC_CMD]: { ran: true, code: 1, output: BASE_FAIL_OUTPUT },
    });
    const baseResult = await runBaseGate('/wt', BASE_CFG, baseSpawn);
    expect(baseResult.status).toBe('fail');

    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'epic' });
    const alpha = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'alpha', parentId: epic.id,
    });
    const beta = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'beta', parentId: epic.id,
    });

    const { deps: alphaDeps, captured: capturedAlpha, completions: completionsAlpha } =
      makeSkipToGateDeps(['src/alpha.ts'], baseResult.command!, baseResult.output!);
    const { deps: betaDeps, captured: capturedBeta, completions: completionsBeta } =
      makeSkipToGateDeps(['src/beta.ts'], baseResult.command!, baseResult.output!);

    recordLeafBlueprint({ leafId: alpha.id, project, specJson: JSON.stringify({ leaf: 'alpha', task: 'do-alpha-thing' }), specRev: 1 });
    recordLeafBlueprint({ leafId: beta.id, project, specJson: JSON.stringify({ leaf: 'beta', task: 'do-beta-thing' }), specRev: 1 });

    const alphaBefore = getLeafBlueprint(alpha.id);
    const betaBefore = getLeafBlueprint(beta.id);
    expect(alphaBefore).not.toBeNull();
    expect(betaBefore).not.toBeNull();
    const alphaBeforeJson = JSON.stringify(alphaBefore);
    const betaBeforeJson = JSON.stringify(betaBefore);

    const alphaLeaf = makeLeaf({ id: alpha.id, title: 'alpha', parentId: epic.id, status: 'in_progress' });
    const betaLeaf = makeLeaf({ id: beta.id, title: 'beta', parentId: epic.id, status: 'in_progress' });

    const resAlpha = await runLeaf(project, alphaLeaf, alphaDeps);
    const resBeta = await runLeaf(project, betaLeaf, betaDeps);

    expect(resAlpha.outcome).toBe('blocked');
    expect(resBeta.outcome).toBe('blocked');
    expect(resAlpha.outcome).not.toBe('rejected');
    expect(resBeta.outcome).not.toBe('rejected');
    expect(resAlpha.reason).toMatch(/^epic-base-red/);
    expect(resBeta.reason).toMatch(/^epic-base-red/);

    expect(capturedAlpha[0].signature).toBe(capturedBeta[0].signature);

    expect(resAlpha.baseRed).toBeDefined();
    expect(resBeta.baseRed).toBeDefined();
    expect(resAlpha.baseRed!.signature).toBe(resBeta.baseRed!.signature);
    expect(resAlpha.baseRed!.signature.length).toBeGreaterThan(0);

    const alphaAfter = getLeafBlueprint(alpha.id);
    const betaAfter = getLeafBlueprint(beta.id);
    expect(alphaAfter).not.toBeNull();
    expect(betaAfter).not.toBeNull();
    expect(JSON.stringify(alphaAfter)).toBe(alphaBeforeJson);
    expect(JSON.stringify(betaAfter)).toBe(betaBeforeJson);

    expect(completionsAlpha.some(c => c.effective === 'rejected')).toBe(false);
    expect(completionsBeta.some(c => c.effective === 'rejected')).toBe(false);
  });

  test('a leaf whose own diff includes the failing file terminates gate-rejected, not epic-base-red', async () => {
    const { spawn: baseSpawn } = stubSpawn({
      [TSC_CMD]: { ran: true, code: 1, output: BASE_FAIL_OUTPUT },
    });
    const baseResult = await runBaseGate('/wt', BASE_CFG, baseSpawn);
    expect(baseResult.status).toBe('fail');

    const epic = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'epic' });
    const gamma = await createTodo(project, {
      allowOrphan: true, ownerSession: 's1', title: 'gamma', parentId: epic.id,
    });

    const { deps: gammaDeps, captured: capturedGamma } =
      makeSkipToGateDeps(['src/untouched.ts', 'src/gamma.ts'], baseResult.command!, baseResult.output!);

    const gammaLeaf = makeLeaf({ id: gamma.id, title: 'gamma', parentId: epic.id, status: 'in_progress' });
    const res = await runLeaf(project, gammaLeaf, gammaDeps);

    expect(res.outcome).toBe('rejected');
    expect(res.reason).toBe('gate-rejected');
    expect(capturedGamma[0].kind).toBe('own');
  });
});
