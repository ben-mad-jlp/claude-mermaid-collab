import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Isolate the global leaf_claim_index + ledger before any worker-ledger/leaf-claim-store imports
process.env.MERMAID_SUPERVISOR_DIR = mkdtempSync(join(tmpdir(), 'claim-gen-restart-ledger-'));

import {
  claimTodo,
  createTodo,
  getTodo,
  listTodos,
  listReadyTodos,
  reclaimNow,
  PROCESS_CLAIM_EPOCH,
  _closeProject,
  type Todo,
} from '../todo-store.js';
import {
  reapDeadWorkers,
  type WorkerLivenessDeps,
} from '../worker-liveness.js';
import {
  clearLeafInflight,
  reapStaleInflight,
  isLeafInflightLive,
  listLeafInflight,
} from '../worker-ledger.js';
import {
  acquireClaim,
} from '../leaf-claim-store.js';
import {
  leafAbortReason,
} from '../leaf-abort.js';
import {
  isClaimable,
} from '../claimability.js';
import {
  runLeaf,
  type LeafExecutorDeps,
} from '../leaf-executor.js';
import type { NodeSpec, NodeResult } from '../../agent/node-invoker.js';

describe('claim generation and restart', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'claim-gen-restart-'));
  });

  afterEach(() => {
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  });

  // Build the fake WorkerLivenessDeps wired to the real todo-store
  function makeReapDeps(overrides: Partial<WorkerLivenessDeps> = {}): WorkerLivenessDeps {
    return {
      listTodos: (p, opts) => listTodos(p, opts),
      getTodo: (p, id) => getTodo(p, id),
      reclaimClaim: (p, id, hadProgress, expectToken) =>
        reclaimNow(p, id, hadProgress, expectToken !== undefined ? { expectToken } : undefined),
      reclaimOrphan: (p, id, hadProgress, expectToken) =>
        reclaimNow(p, id, hadProgress, expectToken !== undefined ? { expectToken } : undefined),
      leafHadProgress: () => () => true,
      isRunLive: () => false,
      isLeafInflightLive: () => false,
      inProcessLaneAlive: async () => false,
      lanePulseAt: () => null,
      markIdle: () => {},
      recordSupervisorAudit: () => {},
      clearLeafInflight,
      reapStaleInflight,
      reapSameEpochOrphanInflight: () => 0,
      listLeafInflight,
      reconcileInflight: () => ({ corrected: false, before: null, after: null }),
      listTrackedLeaves: () => [],
      killLeafSubtree: () => false,
      leafAbortReason: () => null,
      reapOrphanedLeafWorktrees: () => {},
      tickGcLeafWorktrees: () => {},
      isHeadlessLeaf: (todo, childrenIndex) => {
        if (todo.assigneeKind === 'human') return false;
        if ((todo as any).kind === 'epic' || (todo as any).kind === 'mission' || (todo as any).kind === 'land' || (todo as any).kind === 'gate') return false;
        return !(childrenIndex.get(todo.id)?.some((c) => c.status !== 'done' && c.status !== 'dropped'));
      },
      buildChildrenIndex: (todos) => {
        const idx = new Map<string, Todo[]>();
        for (const t of todos) {
          if (!t.parentId) continue;
          const arr = idx.get(t.parentId);
          if (arr) arr.push(t); else idx.set(t.parentId, [t]);
        }
        return idx;
      },
      coordinatorEpoch: 'epoch-live-generation',
      pulseStaleMs: 8_000,
      orphanGraceMs: 15 * 60_000,
      ...overrides,
    };
  }

  // Build compact LeafExecutorDeps with shouldAbort threaded from fresh claim token
  function makeExecDeps(freshClaimToken: string | null): LeafExecutorDeps {
    return {
      invoker: {
        async invoke(spec: NodeSpec): Promise<NodeResult> {
          // If it's a review spec, return PASS
          if (spec.prompt.includes('REVIEW node')) {
            return { ok: true, exitCode: 0, stdout: 'VERDICT: PASS', durationMs: 1, rateLimited: false, authMode: 'subscription', text: 'VERDICT: PASS' };
          }
          // Default to done for other nodes
          return { ok: true, exitCode: 0, stdout: 'done', durationMs: 1, rateLimited: false, authMode: 'subscription', text: 'done' };
        },
      },
      wm: {
        async ensure() { return { isGit: true, path: '/tmp/wt/1', branch: 'b', baseBranch: 'm' } as never; },
      } as never,
      epicId: 'epic-test',
      epicBranch: 'collab/epic/test',
      assertAuth: () => 'subscription',
      async complete(_p: string, _t: string, a: string) { return { effective: a }; },
      async mergeToEpic() { return {}; },
      escalate() {},
      recordNode: () => null,
      shouldAbort: (_p: string, id: string) => leafAbortReason(_p, id, freshClaimToken),
      worktreeDirty: () => [],
    } as unknown as LeafExecutorDeps;
  }

  test('foreign-epoch claim is cleared by ONE reapDeadWorkers pass and the leaf re-derives claimable', async () => {
    // Create epic and child leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      kind: 'epic',
      title: 'epic',
      status: 'ready',
    });

    const leaf = await createTodo(project, {
      ownerSession: 's1',
      parentId: epic.id,
      kind: 'leaf',
      title: 'leaf',
      status: 'ready',
    });

    // Stamp a foreign-epoch leaf_claim row via acquireClaim
    await acquireClaim({
      project,
      leafId: leaf.id,
      holder: 'epoch-dead',
      epoch: 'epoch-dead',
      leaseMs: 60_000,
    });

    // Claim with the same foreign epoch
    const claimed = await claimTodo(project, leaf.id, 'coordinator', 60_000, 'epoch-dead');
    expect(claimed).not.toBeNull();
    expect(claimed!.claimedBy).toBe('coordinator');

    // Run reapDeadWorkers once
    const deps = makeReapDeps();
    const res = await reapDeadWorkers(project, deps);

    // Assert leaf is in reclaimed
    expect(res.reclaimed).toContain(leaf.id);

    // Re-read row and check claim is cleared
    const reread = await getTodo(project, leaf.id);
    expect(reread).not.toBeNull();
    expect(reread!.claim).toBeNull();
    expect(reread!.claimedBy).toBeNull();

    // Check isClaimable returns true
    const byId = new Map();
    const all = listReadyTodos(project);
    all.forEach((t) => byId.set(t.id, t));
    expect(isClaimable(reread!, byId)).toBe(true);

    // Check listReadyTodos contains the leaf
    expect(listReadyTodos(project).map((t) => t.id)).toContain(leaf.id);
  });

  test('a default-epoch claim from a dead generation is reaped in the same single pass', async () => {
    // Create epic and child leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      kind: 'epic',
      title: 'epic',
      status: 'ready',
    });

    const leaf = await createTodo(project, {
      ownerSession: 's1',
      parentId: epic.id,
      kind: 'leaf',
      title: 'leaf',
      status: 'ready',
    });

    // Claim WITHOUT epoch argument — defaults to PROCESS_CLAIM_EPOCH
    const claimed = await claimTodo(project, leaf.id, 'coordinator', 60_000);
    expect(claimed).not.toBeNull();
    expect(claimed!.claim).not.toBeNull();
    expect(claimed!.claim!.epoch).toBe(PROCESS_CLAIM_EPOCH);

    // The coordinatorEpoch in deps is 'epoch-live-generation', different from PROCESS_CLAIM_EPOCH
    // so the claim is marked as prior-epoch and should be reaped
    const deps = makeReapDeps();
    const res = await reapDeadWorkers(project, deps);

    // Assert leaf is in reclaimed
    expect(res.reclaimed).toContain(leaf.id);

    // Re-read row and check claim is cleared
    const reread = await getTodo(project, leaf.id);
    expect(reread).not.toBeNull();
    expect(reread!.claim).toBeNull();
    expect(reread!.claimedBy).toBeNull();

    // Check isClaimable returns true
    const byId = new Map();
    const all = listReadyTodos(project);
    all.forEach((t) => byId.set(t.id, t));
    expect(isClaimable(reread!, byId)).toBe(true);

    // Check listReadyTodos contains the leaf
    expect(listReadyTodos(project).map((t) => t.id)).toContain(leaf.id);
  });

  test('the next dispatch after the reap spends nodes instead of aborting claim-lost', async () => {
    // Create epic and child leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      kind: 'epic',
      title: 'epic',
      status: 'ready',
    });

    const leaf = await createTodo(project, {
      ownerSession: 's1',
      parentId: epic.id,
      kind: 'leaf',
      title: 'leaf',
      status: 'ready',
    });

    // First reap pass: claim with foreign epoch
    await acquireClaim({
      project,
      leafId: leaf.id,
      holder: 'epoch-dead',
      epoch: 'epoch-dead',
      leaseMs: 60_000,
    });

    const claimed = await claimTodo(project, leaf.id, 'coordinator', 60_000, 'epoch-dead');
    expect(claimed).not.toBeNull();

    const deps = makeReapDeps();
    const reapRes = await reapDeadWorkers(project, deps);
    expect(reapRes.reclaimed).toContain(leaf.id);

    // Second claim with live epoch
    const fresh = await claimTodo(project, leaf.id, 'coordinator', 60_000, 'epoch-live-generation');
    expect(fresh).not.toBeNull();
    expect(fresh!.claimToken).not.toBeNull();

    // Run the leaf with executor
    const freshToken = fresh!.claimToken!;
    const execDeps = makeExecDeps(freshToken);
    const leafToRun = await getTodo(project, leaf.id);
    expect(leafToRun).not.toBeNull();

    const res = await runLeaf(project, leafToRun!, execDeps);

    // Assert outcome is not aborted and reason doesn't match claim-lost
    expect(res.outcome).not.toBe('aborted');
    expect(res.reason || '').not.toMatch(/claim-lost/);
    expect(res.nodesSpent).toBeGreaterThan(0);
  });

  test('a stale pre-restart token cannot clear the fresh claim mid-run', async () => {
    // Create epic and child leaf
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      kind: 'epic',
      title: 'epic',
      status: 'ready',
    });

    const leaf = await createTodo(project, {
      ownerSession: 's1',
      parentId: epic.id,
      kind: 'leaf',
      title: 'leaf',
      status: 'ready',
    });

    // Capture pre-restart token
    const oldClaim = await claimTodo(project, leaf.id, 'coordinator', 60_000, 'epoch-dead');
    expect(oldClaim).not.toBeNull();
    const staleToken = oldClaim!.claimToken!;

    // Reap the old claim
    const deps = makeReapDeps();
    await reapDeadWorkers(project, deps);

    // New claim with fresh epoch
    const fresh = await claimTodo(project, leaf.id, 'coordinator', 60_000, 'epoch-live-generation');
    expect(fresh).not.toBeNull();
    const freshToken = fresh!.claimToken!;

    // Create executor deps that will attempt the stale reclaim
    let reclaimAttempted = false;
    const execDeps = makeExecDeps(freshToken);
    const originalInvoker = execDeps.invoker.invoke.bind(execDeps.invoker);
    execDeps.invoker.invoke = async (spec: NodeSpec): Promise<NodeResult> => {
      // On the implement node, try to reclaim with the stale token
      if (spec.prompt.includes('IMPLEMENT node')) {
        reclaimAttempted = true;
        const reclaimRes = await reclaimNow(project, leaf.id, undefined, { expectToken: staleToken });
        // CAS should fail and return null
        expect(reclaimRes).toBeNull();
      }
      return originalInvoker(spec);
    };

    // Run the leaf
    const leafToRun = await getTodo(project, leaf.id);
    expect(leafToRun).not.toBeNull();
    const res = await runLeaf(project, leafToRun!, execDeps);

    // Assert the stale reclaim was attempted
    expect(reclaimAttempted).toBe(true);

    // Check the fresh token is still intact
    const reread = await getTodo(project, leaf.id);
    expect(reread!.claimToken).toBe(freshToken);

    // Assert the run still spent nodes and didn't abort
    expect(res.nodesSpent).toBeGreaterThan(0);
    expect(res.outcome).not.toBe('aborted');
  });
});
