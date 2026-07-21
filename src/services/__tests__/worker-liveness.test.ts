import { test, expect, describe } from 'bun:test';
import { reapDeadWorkers, type WorkerLivenessDeps } from '../worker-liveness';
import type { Todo } from '../todo-store';

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    ownerSession: 'session-1',
    assigneeSession: null,
    assigneeKind: 'agent',
    kind: 'leaf',
    title: 'test leaf',
    description: null,
    status: 'in_progress',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: 'epic-1',
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: new Date().toISOString(), // fresh by default — grace rule never fires unasked
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    blueprintId: null,
    acceptanceStatus: null,
    claimedBy: 'coordinator',
    claimToken: 'tok',
    claimedAt: null,
    claimLeaseMs: null,
    retryCount: 0,
    targetProject: null,
    claim: null,
    ...overrides,
  } as unknown as Todo;
}

/** Audit rows recorded by a test run, so assertions can inspect source/detail shape
 *  without a real supervisor-store. */
type AuditRow = { kind: string; project: string; session: string; detail: string };

/** A deps object where every liveness signal defaults to "dead" / "not shielded" /
 *  "no durable pulse", so a candidate falls straight through to whichever rule the
 *  test is targeting. Individual tests override just the knobs they need. */
function makeDeps(overrides: Partial<WorkerLivenessDeps> = {}): WorkerLivenessDeps & { _audits: AuditRow[] } {
  const _audits: AuditRow[] = [];
  const base: WorkerLivenessDeps = {
    listTodos: () => [],
    getTodo: () => null,
    reclaimClaim: async () => 'ready',
    reclaimOrphan: async () => 'ready',
    leafHadProgress: () => () => true,
    isRunLive: () => false,
    isLeafInflightLive: () => false,
    inProcessLaneAlive: async () => false,
    lanePulseAt: () => null,
    markIdle: () => {},
    recordSupervisorAudit: (entry) => { _audits.push(entry); },
    clearLeafInflight: () => {},
    reapStaleInflight: () => 0,
    reapSameEpochOrphanInflight: () => 0,
    listLeafInflight: () => [],
    reconcileInflight: () => ({ corrected: false, before: null, after: null }),
    listTrackedLeaves: () => [],
    killLeafSubtree: () => false,
    leafAbortReason: () => null,
    reapOrphanedLeafWorktrees: () => {},
    tickGcLeafWorktrees: () => {},
    isHeadlessLeaf: (todo, childrenIndex) => {
      // Mirror coordinator-live's isHeadlessLeaf enough for these tests: not human,
      // not epic/mission/land/gate, no open children.
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
    coordinatorEpoch: 'epoch-live',
    pulseStaleMs: 8_000,
    orphanGraceMs: 15 * 60_000,
    ...overrides,
  };
  return { ...base, _audits };
}

describe('reapDeadWorkers — rule ordering / dedup', () => {
  test('a todo eligible for BOTH prior-epoch and pulse rules is reclaimed by prior-epoch only (earlier rule wins, later rule dedups)', async () => {
    const leaf = makeTodo({
      id: 'dual-eligible',
      sessionName: 'lane-a',
      claim: { at: new Date().toISOString(), leaseMs: 1000, epoch: 'epoch-dead' } as any,
    });
    // Both prior-epoch (claim.epoch !== coordinatorEpoch) and pulse (stale pulse +
    // confirmed dead) would independently reclaim this row — assert prior-epoch (the
    // earlier rule) wins and the pulse rule never gets a second shot at it.
    let reclaimCalls = 0;
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      lanePulseAt: () => Date.now() - 60_000, // stale
      reclaimOrphan: async (_project, id) => { reclaimCalls++; return id === 'dual-eligible' ? 'ready' : null; },
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(res.reclaimed).toEqual(['dual-eligible']);
    // Exactly ONE reclaim call total — the pulse rule's dedup Set check must have
    // skipped it outright, not raced a second (would-be-redundant) reclaimOrphan call.
    expect(reclaimCalls).toBe(1);
  });

  test('a todo reclaimed by the dead-claims rule (a) is skipped by prior-epoch/pulse/grace (c/d/e)', async () => {
    const leaf = makeTodo({
      id: 'dead-claim-then-eligible',
      kind: 'land', // non-headless, so rule (a) does not exclude it
      sessionName: 'lane-b',
      claim: { at: new Date().toISOString(), leaseMs: 1000, epoch: 'epoch-dead' } as any, // also prior-epoch eligible
      updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(), // also grace eligible
      claimedAt: null,
    });
    let reclaimClaimCalls = 0;
    let reclaimOrphanCalls = 0;
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      reclaimClaim: async () => { reclaimClaimCalls++; return 'ready'; },
      reclaimOrphan: async () => { reclaimOrphanCalls++; return 'ready'; },
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(res.reclaimed).toEqual(['dead-claim-then-eligible']);
    expect(reclaimClaimCalls).toBe(1); // rule (a) reclaimed it
    expect(reclaimOrphanCalls).toBe(0); // rules (c)/(d)/(e) never touched it (dedup)
  });
});

describe('reapDeadWorkers — shield chain short-circuits each rule', () => {
  test('rule (a) dead-claims: isRunLive shields, never calls reclaimClaim', async () => {
    const leaf = makeTodo({ id: 'shielded-a', kind: 'land', sessionName: 'lane-c' });
    let reclaimClaimCalls = 0;
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      isRunLive: (id) => id === 'shielded-a',
      reclaimClaim: async () => { reclaimClaimCalls++; return 'ready'; },
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(reclaimClaimCalls).toBe(0);
    expect(res.reclaimed).not.toContain('shielded-a');
  });

  test('rule (d) pulse: isLeafInflightLive shields even with a stale confirmed-dead pulse', async () => {
    const leaf = makeTodo({ id: 'shielded-d', kind: 'land', sessionName: 'lane-d' });
    let reclaimOrphanCalls = 0;
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      lanePulseAt: () => Date.now() - 60_000,
      isLeafInflightLive: (id) => id === 'shielded-d',
      reclaimOrphan: async () => { reclaimOrphanCalls++; return 'ready'; },
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(reclaimOrphanCalls).toBe(0);
    expect(res.reclaimed).not.toContain('shielded-d');
  });

  test('rule (e) grace: inProcessLaneAlive shields a Case-A (no-claim) candidate', async () => {
    const leaf = makeTodo({
      id: 'shielded-e',
      kind: 'land',
      sessionName: 'lane-e',
      claimedBy: null,
      claimedAt: null,
      claimLeaseMs: null,
      updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    });
    let reclaimOrphanCalls = 0;
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      inProcessLaneAlive: async (session) => session === 'lane-e',
      reclaimOrphan: async () => { reclaimOrphanCalls++; return 'ready'; },
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(reclaimOrphanCalls).toBe(0);
    expect(res.reclaimed).not.toContain('shielded-e');
  });
});

describe('reapDeadWorkers — headless exclusion is rule (a)-only', () => {
  test('a headless leaf skipped by dead-claims (a) is STILL reclaimed by grace (e) once aged past the orphan grace with no claim', async () => {
    const leaf = makeTodo({
      id: 'headless-grace-eligible',
      kind: 'leaf', // headless
      sessionName: null,
      claimedBy: null,
      claimedAt: null,
      claimLeaseMs: null,
      updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    });
    let reclaimClaimCalls = 0;
    let reclaimOrphanCalls = 0;
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      reclaimClaim: async () => { reclaimClaimCalls++; return 'ready'; },
      reclaimOrphan: async () => { reclaimOrphanCalls++; return 'ready'; },
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(reclaimClaimCalls).toBe(0); // rule (a) excluded it (isHeadlessLeaf)
    expect(reclaimOrphanCalls).toBe(1); // rule (e) has no headless exclusion — reclaims it
    expect(res.reclaimed).toContain('headless-grace-eligible');
  });
});

describe('reapDeadWorkers — audit source strings are unchanged', () => {
  test('each rule stamps its historical source label', async () => {
    // priorEpoch/pulse/grace are HEADLESS (kind:'leaf') so rule (a) excludes them and
    // lets them fall through to the rule under test — otherwise rule (a) (which runs
    // first and does not gate on claimedBy) would reclaim a non-headless in_progress
    // row before the later rules ever saw it (exactly as it does for `deadClaim` below,
    // which is deliberately non-headless to exercise rule (a) itself).
    const priorEpoch = makeTodo({
      id: 'audit-prior-epoch',
      kind: 'leaf',
      sessionName: 'lane-prior',
      claim: { at: new Date().toISOString(), leaseMs: 1000, epoch: 'epoch-dead' } as any,
    });
    const pulse = makeTodo({
      id: 'audit-pulse',
      kind: 'leaf',
      sessionName: 'lane-pulse',
    });
    const grace = makeTodo({
      id: 'audit-grace',
      kind: 'leaf',
      sessionName: 'lane-grace',
      claimedBy: null,
      claimedAt: null,
      claimLeaseMs: null,
      updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    });
    const deadClaim = makeTodo({
      id: 'audit-dead-claims',
      kind: 'land',
      sessionName: 'lane-dead-claims',
    });
    const deps = makeDeps({
      listTodos: (_p, opts) =>
        (opts?.status === 'in_progress' ? [deadClaim, priorEpoch, pulse, grace] : [deadClaim, priorEpoch, pulse, grace]),
      lanePulseAt: (_project, session) => (session === 'lane-pulse' ? Date.now() - 60_000 : null),
    });
    await reapDeadWorkers('proj', deps);
    const sources = deps._audits
      .map((a) => { try { return JSON.parse(a.detail).source ?? JSON.parse(a.detail).reap; } catch { return undefined; } })
      .filter(Boolean);
    expect(sources).toContain('reapDeadClaims');
    expect(sources).toContain('prior-epoch-reap');
    expect(sources).toContain('pulse-reap');
    expect(sources).toContain('orphan-reap');
  });
});

describe('reapDeadWorkers — retry/exhausted bookkeeping', () => {
  test("next==='blocked' from the dead-claims rule is reported as exhausted, not reclaimed", async () => {
    const leaf = makeTodo({ id: 'exhausted-a', kind: 'land', sessionName: 'lane-f' });
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      reclaimClaim: async () => 'blocked',
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(res.exhausted).toContain('exhausted-a');
    expect(res.reclaimed).not.toContain('exhausted-a');
  });

  test('a null (raced-to-terminal) reclaimOrphan result from the grace rule is neither reclaimed nor exhausted', async () => {
    const leaf = makeTodo({
      id: 'raced-e',
      kind: 'leaf', // headless — excluded from rule (a) so this exercises the grace rule's reclaimOrphan path
      sessionName: 'lane-g',
      claimedBy: null,
      claimedAt: null,
      claimLeaseMs: null,
      updatedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    });
    const deps = makeDeps({
      listTodos: (_p, opts) => (opts?.status === 'in_progress' ? [leaf] : [leaf]),
      reclaimOrphan: async () => null,
    });
    const res = await reapDeadWorkers('proj', deps);
    expect(res.reclaimed).not.toContain('raced-e');
    expect(res.exhausted).not.toContain('raced-e');
  });
});
