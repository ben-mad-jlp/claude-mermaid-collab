import { test, expect, describe } from 'bun:test';
import { planCoordinatorTick, planOrphanReap, shouldPulseReap } from '../coordinator-core';
import type { Todo } from '../todo-store';

function makeTodo(overrides: Partial<Todo> & { id: string; status: Todo['status'] }): Todo {
  return {
    ownerSession: 'session-1',
    assigneeSession: null,
    title: 'test todo',
    description: null,
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    blueprintId: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    retryCount: 0,
    ...overrides,
  } as Todo;
}

const NOW = '2024-06-01T12:00:00.000Z';

describe('planCoordinatorTick', () => {
  test('empty array returns empty plan', () => {
    expect(planCoordinatorTick([], NOW)).toEqual({ toClaim: [], toRelease: [] });
  });

  test('ready todo with no deps → in toClaim', () => {
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: [] });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toClaim).toContain('a');
    expect(plan.toRelease).toHaveLength(0);
  });

  test('ready todo with all deps done → in toClaim', () => {
    const dep = makeTodo({ id: 'dep1', status: 'done' });
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: ['dep1'] });
    const plan = planCoordinatorTick([dep, todo], NOW);
    expect(plan.toClaim).toContain('a');
  });

  test('container guard: a ready PARENT with a non-terminal child is NOT claimed', () => {
    const epic = makeTodo({ id: 'epic', status: 'ready', dependsOn: [] });
    const child = makeTodo({ id: 'c1', status: 'in_progress', parentId: 'epic' });
    const plan = planCoordinatorTick([epic, child], NOW);
    expect(plan.toClaim).not.toContain('epic'); // container, never claimed
    expect(plan.toClaim).not.toContain('c1');    // child is in_progress, not ready
  });

  test('container guard: a ready parent whose children are ALL terminal IS claimable', () => {
    // (All children done/dropped → not a container this tick; the cascade would
    // normally have closed it, but until then it must not be wrongly blocked.)
    const epic = makeTodo({ id: 'epic', status: 'ready', dependsOn: [] });
    const child = makeTodo({ id: 'c1', status: 'done', parentId: 'epic' });
    const plan = planCoordinatorTick([epic, child], NOW);
    expect(plan.toClaim).toContain('epic');
  });

  test('container guard: a normal leaf (no children) is still claimed', () => {
    const leaf = makeTodo({ id: 'leaf', status: 'ready', dependsOn: [] });
    const plan = planCoordinatorTick([leaf], NOW);
    expect(plan.toClaim).toContain('leaf');
  });

  test('human-assigned todo is NEVER claimed (park-from-daemon)', () => {
    const note = makeTodo({ id: 'note', status: 'ready', dependsOn: [], assigneeKind: 'human' } as any);
    const plan = planCoordinatorTick([note], NOW);
    expect(plan.toClaim).not.toContain('note');
  });

  test('ready todo with a pending (non-done) dep → NOT in toClaim', () => {
    const dep = makeTodo({ id: 'dep1', status: 'in_progress' });
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: ['dep1'] });
    const plan = planCoordinatorTick([dep, todo], NOW);
    expect(plan.toClaim).not.toContain('a');
  });

  test('ready todo with an unknown dep id → in toClaim (unknown ignored)', () => {
    const todo = makeTodo({ id: 'a', status: 'ready', dependsOn: ['nonexistent'] });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toClaim).toContain('a');
  });

  test('in_progress with expired lease → in toRelease', () => {
    const claimedAt = '2024-06-01T11:00:00.000Z'; // 1 hour ago
    const claimLeaseMs = 30 * 60 * 1000; // 30 min lease
    const todo = makeTodo({ id: 'b', status: 'in_progress', claimedAt, claimLeaseMs });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toRelease).toContain('b');
    expect(plan.toClaim).not.toContain('b');
  });

  test('in_progress with unexpired lease → NOT in toRelease', () => {
    const claimedAt = '2024-06-01T11:45:00.000Z'; // 15 min ago
    const claimLeaseMs = 30 * 60 * 1000; // 30 min lease
    const todo = makeTodo({ id: 'b', status: 'in_progress', claimedAt, claimLeaseMs });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toRelease).not.toContain('b');
  });

  test('in_progress with null claimLeaseMs → NOT in toRelease', () => {
    const todo = makeTodo({ id: 'b', status: 'in_progress', claimedAt: '2024-01-01T00:00:00.000Z', claimLeaseMs: null });
    const plan = planCoordinatorTick([todo], NOW);
    expect(plan.toRelease).not.toContain('b');
  });
});

describe('planOrphanReap', () => {
  const GRACE = 15 * 60 * 1000; // 15 min
  const STALE = '2024-06-01T11:00:00.000Z';   // 1h before NOW → past grace
  const RECENT = '2024-06-01T11:55:00.000Z';  // 5 min before NOW → within grace
  const leaf = (o: Partial<Todo> & { id: string }) =>
    makeTodo({ status: 'in_progress', parentId: 'epic-1', updatedAt: STALE, claimedBy: null, ...o });

  test('ACCEPTANCE: in_progress leaf, claimedBy NULL, older than grace → reaped outright', () => {
    const out = planOrphanReap([leaf({ id: 'a' })], NOW, GRACE);
    expect(out.map((c) => c.id)).toEqual(['a']);
    expect(out[0].needsTmuxProbe).toBe(false); // case A: no claim → no probe needed
  });

  test('ACCEPTANCE: epic (parentId NULL) is never reaped', () => {
    const epic = makeTodo({ id: 'e', status: 'in_progress', parentId: null, updatedAt: STALE, claimedBy: null });
    expect(planOrphanReap([epic], NOW, GRACE)).toHaveLength(0);
  });

  test('human-assigned in_progress leaf is NEVER reaped (a [SESSION] note authored in_progress)', () => {
    // The exact regression: a hand-authored in_progress note with claimedBy NULL looked
    // identical to an orphaned worker claim and got reclaimed → claimed → worked.
    const note = leaf({ id: 'note', assigneeKind: 'human' } as any);
    expect(planOrphanReap([note], NOW, GRACE)).toHaveLength(0);
  });

  test('ACCEPTANCE: a leaf with a LIVE claim (lease not expired) is untouched', () => {
    const live = leaf({
      id: 'a', claimedBy: 'coordinator',
      claimedAt: RECENT, claimLeaseMs: 40 * 60 * 1000, sessionName: 'backend-1',
    });
    expect(planOrphanReap([live], NOW, GRACE)).toHaveLength(0);
  });

  test('leaf within grace → not yet reaped', () => {
    expect(planOrphanReap([leaf({ id: 'a', updatedAt: RECENT })], NOW, GRACE)).toHaveLength(0);
  });

  test('case B: claim PAST lease → candidate flagged needsTmuxProbe (caller confirms dead)', () => {
    const expired = leaf({
      id: 'a', claimedBy: 'coordinator',
      claimedAt: '2024-06-01T11:00:00.000Z', claimLeaseMs: 30 * 60 * 1000, // expired 30 min ago
      sessionName: 'backend-1',
    });
    const out = planOrphanReap([expired], NOW, GRACE);
    expect(out.map((c) => c.id)).toEqual(['a']);
    expect(out[0].needsTmuxProbe).toBe(true);
    expect(out[0].sessionName).toBe('backend-1');
  });

  test('claimed, lease unexpired but updatedAt stale → NOT reaped (live claim wins)', () => {
    const heldLongTask = leaf({
      id: 'a', updatedAt: STALE, claimedBy: 'coordinator',
      claimedAt: RECENT, claimLeaseMs: 40 * 60 * 1000,
    });
    expect(planOrphanReap([heldLongTask], NOW, GRACE)).toHaveLength(0);
  });

  test('non-in_progress leaves are ignored', () => {
    const ready = leaf({ id: 'a', status: 'ready' });
    const done = leaf({ id: 'b', status: 'done' });
    expect(planOrphanReap([ready, done], NOW, GRACE)).toHaveLength(0);
  });

  test('clock injection: same todo crosses grace as `now` advances', () => {
    const t = leaf({ id: 'a', updatedAt: '2024-06-01T11:50:00.000Z' }); // claimed 10 min before NOW
    expect(planOrphanReap([t], '2024-06-01T12:00:00.000Z', GRACE)).toHaveLength(0); // 10 min < 15
    expect(planOrphanReap([t], '2024-06-01T12:10:00.000Z', GRACE)).toHaveLength(1); // 20 min > 15
  });
});

describe('shouldPulseReap (Phase 1 two-fact reclaim, decision 9cd01858)', () => {
  const NOW = 1_000_000;
  const STALE = 8_000; // 8s staleness window

  test('two-fact: stale durable pulse AND confirmed-dead → reclaim (seconds, not ~9h)', () => {
    // A hard-killed / orphaned worker: last pulse 30s ago AND its process is gone.
    expect(shouldPulseReap(NOW - 30_000, NOW, STALE, true)).toBe(true);
  });

  test('stale pulse but worker still ALIVE → never reclaim (no false-reap on a live process)', () => {
    // The pulse gap is real, but the two-fact rule blocks reaping a live worker.
    expect(shouldPulseReap(NOW - 30_000, NOW, STALE, false)).toBe(false);
  });

  test('fresh pulse (within window) + dead → no reclaim yet (within the staleness window)', () => {
    expect(shouldPulseReap(NOW - 2_000, NOW, STALE, true)).toBe(false);
  });

  test('boundary: pulse exactly at the staleness window is NOT yet stale', () => {
    expect(shouldPulseReap(NOW - STALE, NOW, STALE, true)).toBe(false);
    expect(shouldPulseReap(NOW - STALE - 1, NOW, STALE, true)).toBe(true);
  });

  test('NULL durable pulse → false regardless of liveness (falls back to grace; never-worse)', () => {
    // No session_status row for the lane: the fast path declines so the existing
    // planOrphanReap age/lease grace governs it — strictly additive.
    expect(shouldPulseReap(null, NOW, STALE, true)).toBe(false);
    expect(shouldPulseReap(null, NOW, STALE, false)).toBe(false);
  });
});
