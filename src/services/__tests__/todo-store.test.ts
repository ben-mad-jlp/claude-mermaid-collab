// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, listTodos, getTodo, updateTodo, assignTodo, removeTodo, clearCompleted, reorder, _closeProject,
  claimTodo, releaseExpiredClaims, reclaimClaim, releaseClaim, listReadyTodos, computeWaves, completeTodo, MAX_CLAIM_RETRIES,
} from '../todo-store';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-store-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('todo-store', () => {
  test('createTodo returns the upgraded shape, completed derived false', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'first' });
    expect(typeof t.id).toBe('string');
    expect(t.ownerSession).toBe('s1');
    expect(t.status).toBe('todo');
    expect(t.completed).toBe(false);
    expect(t.order).toBe(10);
    expect(t.dependsOn).toEqual([]);
  });

  test('listTodos session scope is owner-only; assigneeSession filter is separate; excludes done by default', async () => {
    await createTodo(project, { ownerSession: 's1', title: 'a' });
    await createTodo(project, { ownerSession: 's1', assigneeSession: 's2', title: 'b' });
    await createTodo(project, { ownerSession: 's3', title: 'c' });
    // `session` scopes by OWNER only — 'b' is owned by s1 (assigned to s2), so s2 owns nothing.
    expect(listTodos(project, { session: 's2' }).map((t) => t.title)).toEqual([]);
    expect(listTodos(project, { session: 's1' }).map((t) => t.title).sort()).toEqual(['a', 'b']);
    // assignee filter surfaces work assigned to a session regardless of owner.
    expect(listTodos(project, { assigneeSession: 's2' }).map((t) => t.title)).toEqual(['b']);

    const done = await createTodo(project, { ownerSession: 's1', title: 'd' });
    await updateTodo(project, done.id, { status: 'done' });
    expect(listTodos(project, { session: 's1' }).some((t) => t.title === 'd')).toBe(false);
    expect(listTodos(project, { session: 's1', includeCompleted: true }).some((t) => t.title === 'd')).toBe(true);
  });

  test('createTodo defaults assigneeSession to the owner session (assigned to the session it was added in)', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'a' });
    expect(t.assigneeSession).toBe('s1');
    // explicit assignee still wins
    const u = await createTodo(project, { ownerSession: 's1', assigneeSession: 's2', title: 'b' });
    expect(u.assigneeSession).toBe('s2');
  });

  test('getTodo returns null for a missing id', () => {
    expect(getTodo(project, 'nope')).toBeNull();
  });

  test('updateTodo syncs completed + completedAt when status -> done', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await updateTodo(project, t.id, { status: 'done' });
    expect(u.completed).toBe(true);
    expect(u.completedAt).not.toBeNull();
  });

  test('updateTodo with completed:true forces status done', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await updateTodo(project, t.id, { completed: true });
    expect(u.status).toBe('done');
  });

  test('assignTodo sets assigneeSession', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await assignTodo(project, t.id, 's2');
    expect(u.assigneeSession).toBe('s2');
  });

  test('removeTodo throws for missing id', async () => {
    await expect(removeTodo(project, 'nope')).rejects.toThrow('todo not found');
  });

  test('clearCompleted removes only done todos for the session', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'a' });
    await createTodo(project, { ownerSession: 's1', title: 'b' });
    await updateTodo(project, a.id, { status: 'done' });
    const res = await clearCompleted(project, 's1');
    expect(res.removed).toBe(1);
    expect(listTodos(project, { session: 's1', includeCompleted: true }).map((t) => t.title)).toEqual(['b']);
  });

  test('reorder reassigns ord in x10 increments', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'a' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'b' });
    await reorder(project, [b.id, a.id]);
    const ordered = listTodos(project, { session: 's1' });
    expect(ordered.map((t) => t.title)).toEqual(['b', 'a']);
    expect(ordered.map((t) => t.order)).toEqual([10, 20]);
  });

  test('link round-trips as JSON', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', link: { blueprintId: 'bp', taskId: 'tk' } });
    expect(getTodo(project, t.id)!.link).toEqual({ blueprintId: 'bp', taskId: 'tk' });
  });
});

describe('todo-store new fields and functions', () => {
  test('createTodo threads sessionName + blueprintId; claim fields default null; retryCount 0; acceptanceStatus null', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', sessionName: 'my-session', blueprintId: 'bp1' });
    expect(t.sessionName).toBe('my-session');
    expect(t.blueprintId).toBe('bp1');
    expect(t.claimedBy).toBeNull();
    expect(t.claimToken).toBeNull();
    expect(t.claimedAt).toBeNull();
    expect(t.claimLeaseMs).toBeNull();
    expect(t.retryCount).toBe(0);
    expect(t.acceptanceStatus).toBeNull();
  });

  test('updateTodo patches sessionName, blueprintId, acceptanceStatus', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    const u = await updateTodo(project, t.id, { sessionName: 'new-session', blueprintId: 'bp2', acceptanceStatus: 'accepted' });
    expect(u.sessionName).toBe('new-session');
    expect(u.blueprintId).toBe('bp2');
    expect(u.acceptanceStatus).toBe('accepted');
  });

  test('claimTodo: claim a ready todo → not null, status in_progress, claimedBy set, claimToken is string, claimLeaseMs set', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    const claimed = await claimTodo(project, t.id, 'agent-1', 60000);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('in_progress');
    expect(claimed!.claimedBy).toBe('agent-1');
    expect(typeof claimed!.claimToken).toBe('string');
    expect(claimed!.claimLeaseMs).toBe(60000);
  });

  test('claimTodo: re-claim already-claimed → null', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'agent-1', 60000);
    const second = await claimTodo(project, t.id, 'agent-2', 60000);
    expect(second).toBeNull();
  });

  test('claimTodo: claiming status planned → null', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'planned' });
    const claimed = await claimTodo(project, t.id, 'agent-1', 60000);
    expect(claimed).toBeNull();
  });

  test('claimTodo: claiming status blocked → null', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'blocked' });
    const claimed = await claimTodo(project, t.id, 'agent-1', 60000);
    expect(claimed).toBeNull();
  });

  test('claimTodo: claiming a non-ready (todo) status returns null', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' });
    expect(t.status).toBe('todo');
    expect(await claimTodo(project, t.id, 'agent-1', 30000)).toBeNull();
  });

  test('releaseExpiredClaims: claim with 1000ms lease, release with now+2000ms → released, back to ready, retryCount 1', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'agent-1', 1000);
    const future = new Date(Date.now() + 2000).toISOString();
    const { released } = await releaseExpiredClaims(project, future);
    expect(released).toContain(t.id);
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('ready');
    expect(after.claimedBy).toBeNull();
    expect(after.claimToken).toBeNull();
    expect(after.retryCount).toBe(1);
  });

  test('releaseExpiredClaims: claim with 60000ms lease, release with now+100ms → not released, still in_progress', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'agent-1', 60000);
    const nearFuture = new Date(Date.now() + 100).toISOString();
    const { released } = await releaseExpiredClaims(project, nearFuture);
    expect(released).not.toContain(t.id);
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('in_progress');
  });

  test('releaseExpiredClaims: retry cap exceeded → parked blocked + surfaced as exhausted', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    // Re-claim + expire repeatedly. The (MAX_CLAIM_RETRIES+1)-th expiry parks it blocked.
    const attempts = MAX_CLAIM_RETRIES + 1;
    let lastExhausted: string[] = [];
    for (let i = 0; i < attempts; i++) {
      await claimTodo(project, t.id, 'agent-1', 1000);
      const future = new Date(Date.now() + (i + 1) * 10000).toISOString();
      const res = await releaseExpiredClaims(project, future);
      lastExhausted = res.exhausted;
    }
    expect(lastExhausted).toContain(t.id);
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('blocked');
    expect(after.retryCount).toBe(attempts);
  });

  test('reclaimClaim: force-reclaims a live claim to ready regardless of lease; null for non-claims', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'agent-1', 60_000); // long lease, NOT expired
    const next = await reclaimClaim(project, t.id);
    expect(next).toBe('ready');
    expect(getTodo(project, t.id)!.status).toBe('ready');
    expect(getTodo(project, t.id)!.retryCount).toBe(1);
    // not in_progress anymore → null
    expect(await reclaimClaim(project, t.id)).toBeNull();
  });

  test('releaseClaim: returns a live claim to ready with NO retry penalty; false for non-claims (DOGFOOD #3)', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'coordinator', 60_000);
    expect(getTodo(project, t.id)!.status).toBe('in_progress');
    const released = await releaseClaim(project, t.id);
    expect(released).toBe(true);
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('ready'); // immediately re-claimable
    expect(after.claimedBy).toBeNull();
    expect(after.claimToken).toBeNull();
    expect(after.claimedAt).toBeNull();
    expect(after.claimLeaseMs).toBeNull();
    expect(after.retryCount).toBe(0); // deferral is NOT a retry (unlike reclaimClaim)
    // already released → not an in_progress claim → false
    expect(await releaseClaim(project, t.id)).toBe(false);
  });

  test('listReadyTodos: ready w/ no deps included; ready w/ all-done deps included; ready w/ pending dep excluded; unknown dep id included', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'a', status: 'ready' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'b', status: 'done' });
    const c = await createTodo(project, { ownerSession: 's1', title: 'c', status: 'ready', dependsOn: [b.id] });
    const d = await createTodo(project, { ownerSession: 's1', title: 'd', status: 'ready', dependsOn: [a.id] });
    const e = await createTodo(project, { ownerSession: 's1', title: 'e', status: 'ready', dependsOn: ['unknown-id-xyz'] });
    const ready = listReadyTodos(project);
    const ids = ready.map((t) => t.id);
    expect(ids).toContain(a.id); // ready, no deps
    expect(ids).toContain(c.id); // ready, dep is done
    expect(ids).not.toContain(d.id); // dep a is ready (not done)
    expect(ids).toContain(e.id); // unknown dep treated as satisfied
  });

  test('computeWaves: [] → []', () => {
    expect(computeWaves([])).toEqual([]);
  });

  test('computeWaves: linear A→B→C → [[A],[B],[C]]', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'A' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'B', dependsOn: [a.id] });
    const c = await createTodo(project, { ownerSession: 's1', title: 'C', dependsOn: [b.id] });
    const waves = computeWaves([a, b, c]);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((t) => t.id)).toEqual([a.id]);
    expect(waves[1].map((t) => t.id)).toEqual([b.id]);
    expect(waves[2].map((t) => t.id)).toEqual([c.id]);
  });

  test('computeWaves: diamond A; B,C→A; D→B,C → wave0=[A], wave1={B,C}, wave2=[D]', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'A' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'B', dependsOn: [a.id] });
    const c = await createTodo(project, { ownerSession: 's1', title: 'C', dependsOn: [a.id] });
    const d = await createTodo(project, { ownerSession: 's1', title: 'D', dependsOn: [b.id, c.id] });
    const waves = computeWaves([a, b, c, d]);
    expect(waves).toHaveLength(3);
    expect(waves[0].map((t) => t.id)).toEqual([a.id]);
    expect(waves[1].map((t) => t.id).sort()).toEqual([b.id, c.id].sort());
    expect(waves[2].map((t) => t.id)).toEqual([d.id]);
  });

  test('computeWaves: two orphans → single wave of both', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'A' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'B' });
    const waves = computeWaves([a, b]);
    expect(waves).toHaveLength(1);
    expect(waves[0].map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });

  test('computeWaves: unknown dep → single wave', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'A', dependsOn: ['unknown-xyz'] });
    const waves = computeWaves([a]);
    expect(waves).toHaveLength(1);
    expect(waves[0][0].id).toBe(a.id);
  });

  test('computeWaves: cycle A↔B → terminates, both ids appear once across flattened waves', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'A' });
    const b = await createTodo(project, { ownerSession: 's1', title: 'B', dependsOn: [a.id] });
    await updateTodo(project, a.id, { dependsOn: [b.id] });
    const aFresh = getTodo(project, a.id)!;
    const bFresh = getTodo(project, b.id)!;
    const waves = computeWaves([aFresh, bFresh]);
    const flat = waves.flat().map((t) => t.id);
    expect(flat.sort()).toEqual([a.id, b.id].sort());
    // Each id appears exactly once
    expect(flat.filter((id) => id === a.id)).toHaveLength(1);
    expect(flat.filter((id) => id === b.id)).toHaveLength(1);
  });

  test('computeWaves: self-dep → terminates, one item', async () => {
    const a = await createTodo(project, { ownerSession: 's1', title: 'A' });
    await updateTodo(project, a.id, { dependsOn: [a.id] });
    const aFresh = getTodo(project, a.id)!;
    const waves = computeWaves([aFresh]);
    const flat = waves.flat();
    expect(flat).toHaveLength(1);
    expect(flat[0].id).toBe(a.id);
  });
});

describe('completeTodo', () => {
  test('sets status done + completedAt + acceptanceStatus when given', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'in_progress' });
    const { completed } = await completeTodo(project, t.id, 'accepted');
    expect(completed.status).toBe('done');
    expect(completed.completed).toBe(true);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.acceptanceStatus).toBe('accepted');
  });

  test('promotes a blocked dependent whose only dep is this todo to ready', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'in_progress' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'blocked', dependsOn: [dep.id] });
    const { completed, promoted } = await completeTodo(project, dep.id);
    expect(completed.status).toBe('done');
    expect(promoted).toContain(blocker.id);
    const after = getTodo(project, blocker.id)!;
    expect(after.status).toBe('ready');
  });

  test('does NOT promote a blocked dependent that has another still-pending dep', async () => {
    const dep1 = await createTodo(project, { ownerSession: 's1', title: 'dep1', status: 'in_progress' });
    const dep2 = await createTodo(project, { ownerSession: 's1', title: 'dep2', status: 'in_progress' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'blocked', dependsOn: [dep1.id, dep2.id] });
    const { promoted } = await completeTodo(project, dep1.id);
    expect(promoted).not.toContain(blocker.id);
    const after = getTodo(project, blocker.id)!;
    expect(after.status).toBe('blocked');
  });

  test('does NOT promote a planned todo even if its deps are done', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'in_progress' });
    const planned = await createTodo(project, { ownerSession: 's1', title: 'planned', status: 'planned', dependsOn: [dep.id] });
    const { promoted } = await completeTodo(project, dep.id);
    expect(promoted).not.toContain(planned.id);
    const after = getTodo(project, planned.id)!;
    expect(after.status).toBe('planned');
  });

  test('throws on missing id', async () => {
    await expect(completeTodo(project, 'no-such-id')).rejects.toThrow('todo not found');
  });

  test('acceptance gate: a REJECTED completion is NOT done and does NOT unblock dependents (SI-3)', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'in_progress' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'blocked', dependsOn: [dep.id] });
    const { completed, promoted } = await completeTodo(project, dep.id, 'rejected');
    // SI-3: rejected → non-terminal 'blocked' (not 'done'), completedAt cleared,
    // so it surfaces as actionable instead of sinking silently into Done.
    expect(completed.status).toBe('blocked');
    expect(completed.completedAt).toBeNull();
    expect(completed.acceptanceStatus).toBe('rejected');
    expect(promoted).not.toContain(blocker.id);
    expect(getTodo(project, blocker.id)!.status).toBe('blocked');
  });

  test('acceptance gate: a rejected todo is NOT auto-promoted by a later completion (SI-3)', async () => {
    // A rejected todo with no unsatisfied deps must stay parked, not re-promote to ready.
    const rejected = await createTodo(project, { ownerSession: 's1', title: 'rejected', status: 'in_progress' });
    await completeTodo(project, rejected.id, 'rejected');
    expect(getTodo(project, rejected.id)!.status).toBe('blocked');
    // An unrelated completion triggers the unblock pass — the rejected todo must NOT promote.
    const other = await createTodo(project, { ownerSession: 's1', title: 'other', status: 'in_progress' });
    const { promoted } = await completeTodo(project, other.id, 'accepted');
    expect(promoted).not.toContain(rejected.id);
    expect(getTodo(project, rejected.id)!.status).toBe('blocked');
  });

  test('acceptance gate: an ACCEPTED dep unblocks dependents', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'in_progress' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'blocked', dependsOn: [dep.id] });
    const { promoted } = await completeTodo(project, dep.id, 'accepted');
    expect(promoted).toContain(blocker.id);
    expect(getTodo(project, blocker.id)!.status).toBe('ready');
  });

  test('acceptance gate: a null/unspecified-acceptance done dep still unblocks (backward-compatible)', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'in_progress' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'blocked', dependsOn: [dep.id] });
    const { promoted } = await completeTodo(project, dep.id); // no acceptance arg
    expect(promoted).toContain(blocker.id);
  });

  test('acceptance gate: listReadyTodos excludes a ready todo whose dep was rejected', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'in_progress' });
    // dependent left in 'ready' to isolate the listReadyTodos dep-check from the unblock pass
    const dependent = await createTodo(project, { ownerSession: 's1', title: 'dependent', status: 'ready', dependsOn: [dep.id] });
    await completeTodo(project, dep.id, 'rejected');
    expect(listReadyTodos(project).some((t) => t.id === dependent.id)).toBe(false);
  });
});

describe('completeTodo epic roll-up', () => {
  test('auto-completes a parent when its last child completes', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'in_progress', parentId: epic.id });
    const c2 = await createTodo(project, { ownerSession: 's1', title: 'c2', status: 'in_progress', parentId: epic.id });

    const r1 = await completeTodo(project, c1.id, 'accepted');
    expect(r1.rolledUp).toEqual([]);
    expect(getTodo(project, epic.id)!.status).toBe('planned'); // one child still open

    const r2 = await completeTodo(project, c2.id, 'accepted');
    expect(r2.rolledUp).toContain(epic.id);
    const parent = getTodo(project, epic.id)!;
    expect(parent.status).toBe('done');
    expect(parent.acceptanceStatus).toBe('accepted');
    expect(parent.completedAt).not.toBeNull();
  });

  test('partial completion leaves the parent open', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'in_progress', parentId: epic.id });
    await createTodo(project, { ownerSession: 's1', title: 'c2', status: 'in_progress', parentId: epic.id });
    const { rolledUp } = await completeTodo(project, c1.id, 'accepted');
    expect(rolledUp).toEqual([]);
    expect(getTodo(project, epic.id)!.status).toBe('planned');
  });

  test('a REJECTED child blocks roll-up', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'in_progress', parentId: epic.id });
    const c2 = await createTodo(project, { ownerSession: 's1', title: 'c2', status: 'in_progress', parentId: epic.id });
    await completeTodo(project, c1.id, 'rejected');
    const { rolledUp } = await completeTodo(project, c2.id, 'accepted');
    expect(rolledUp).toEqual([]);
    expect(getTodo(project, epic.id)!.status).toBe('planned');
  });

  test('a DROPPED child is ignored — roll-up fires when all non-dropped children are done', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'in_progress', parentId: epic.id });
    await createTodo(project, { ownerSession: 's1', title: 'c2-dropped', status: 'dropped', parentId: epic.id });
    const { rolledUp } = await completeTodo(project, c1.id, 'accepted');
    expect(rolledUp).toContain(epic.id);
    expect(getTodo(project, epic.id)!.status).toBe('done');
  });

  test('recurses upward: completing the last leaf closes the whole chain', async () => {
    const grand = await createTodo(project, { ownerSession: 's1', title: 'grand', status: 'planned' });
    const mid = await createTodo(project, { ownerSession: 's1', title: 'mid', status: 'planned', parentId: grand.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'leaf', status: 'in_progress', parentId: mid.id });
    const { rolledUp } = await completeTodo(project, leaf.id, 'accepted');
    expect(rolledUp).toEqual([mid.id, grand.id]); // deepest-first
    expect(getTodo(project, mid.id)!.status).toBe('done');
    expect(getTodo(project, grand.id)!.status).toBe('done');
  });

  test('does not roll up an epic with zero (non-dropped) children', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    // a standalone child of NO epic — completing it must not touch the empty epic
    const solo = await createTodo(project, { ownerSession: 's1', title: 'solo', status: 'in_progress' });
    const { rolledUp } = await completeTodo(project, solo.id, 'accepted');
    expect(rolledUp).toEqual([]);
    expect(getTodo(project, epic.id)!.status).toBe('planned');
  });
});

describe('single-writer invariant (project-is-local)', () => {
  test('claimTodo throws for a non-local project path', async () => {
    await expect(claimTodo('/no/such/project/xyz', 'id', 'coordinator', 1000)).rejects.toThrow('project not local');
  });

  test('completeTodo throws for a non-local project path', async () => {
    await expect(completeTodo('/no/such/project/xyz', 'id', 'accepted')).rejects.toThrow('project not local');
  });

  test('claim/complete work normally for a local (existing) project', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    const claimed = await claimTodo(project, t.id, 'coordinator', 60_000);
    expect(claimed?.status).toBe('in_progress');
    const { completed } = await completeTodo(project, t.id, 'accepted');
    expect(completed.status).toBe('done');
  });
});

describe('todo-store targetProject (cross-project todos)', () => {
  test('defaults to null and round-trips through create + update', async () => {
    const def = await createTodo(project, { ownerSession: 's1', title: 'same-project' });
    expect(def.targetProject).toBeNull();

    const t = await createTodo(project, { ownerSession: 's1', title: 'cross', targetProject: '/repos/build123d' });
    expect(t.targetProject).toBe('/repos/build123d');
    // survives reload (hydration from disk)
    expect(getTodo(project, t.id)!.targetProject).toBe('/repos/build123d');

    const updated = await updateTodo(project, t.id, { targetProject: '/repos/other' });
    expect(updated.targetProject).toBe('/repos/other');
    // clearing back to null
    expect((await updateTodo(project, t.id, { targetProject: null })).targetProject).toBeNull();
    // an unrelated update leaves targetProject untouched
    await updateTodo(project, t.id, { targetProject: '/repos/keep' });
    expect((await updateTodo(project, t.id, { title: 'renamed' })).targetProject).toBe('/repos/keep');
  });
});
