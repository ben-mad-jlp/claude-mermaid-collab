// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo, listTodos, getTodo, updateTodo, assignTodo, removeTodo, clearCompleted, reorder, _closeProject,
  claimTodo, releaseExpiredClaims, reclaimClaim, reclaimOrphan, releaseClaim, listReadyTodos, computeWaves, completeTodo, MAX_CLAIM_RETRIES,
  resetTodo, overrideAcceptTodo, createGate, listGatesBlocking, listGatedBy, completeGatesForDecision,
} from '../todo-store';
import { createEscalation, getEscalation, _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { isClaimable, claimReason } from '../claimability';
import type { Todo } from '../todo-store';
import Database from 'bun:sqlite';

let project: string;

/** De-conflate: readiness/hold are DERIVED, not stored. A released todo is stored
 *  'planned' but derives claimable; a parked one carries heldAt. These helpers let
 *  the tests assert the DERIVED state (the real contract) instead of the legacy
 *  stored enum. Single-entry map is fine — these fixtures have no dependsOn deps. */
function derivedClaimable(t: Todo): boolean {
  return isClaimable(t, new Map([[t.id, t]]));
}
function derivedReason(t: Todo): string {
  return claimReason(t, new Map([[t.id, t]]));
}

/**
 * Strand a row in_progress with NO claim, simulating a daemon-restart orphan.
 * updateTodo(status:'in_progress') now throws (ManualInProgressError), so we write
 * the raw row directly, then _closeProject so the next store call re-opens fresh.
 */
function strandOrphan(proj: string, id: string) {
  const db = new Database(join(proj, '.collab', 'todos.db'));
  db.exec(
    `UPDATE todos SET status='in_progress', claim=NULL, claimedBy=NULL, claimToken=NULL, claimedAt=NULL, claimLeaseMs=NULL WHERE id='${id}'`,
  );
  db.close();
  _closeProject(proj);
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'todo-store-'));
  // resetTodo now auto-resolves a todo's open escalations → isolate the supervisor.db
  // to the temp project so tests never touch the real ~/.mermaid-collab one.
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});
afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
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

  test('objectRef defaults null and round-trips through create + update (the durable-link firewall)', async () => {
    // Defaults null (work-todo not linked to any durable system-object).
    const t = await createTodo(project, { ownerSession: 's1', title: 'unlinked' });
    expect(t.objectRef).toBe(null);
    expect(getTodo(project, t.id)!.objectRef).toBe(null);

    // Set at create.
    const linked = await createTodo(project, { ownerSession: 's1', title: 'linked', objectRef: 'obj-123' });
    expect(linked.objectRef).toBe('obj-123');
    expect(getTodo(project, linked.id)!.objectRef).toBe('obj-123');

    // Set via update, then cleared back to null.
    const updated = await updateTodo(project, t.id, { objectRef: 'obj-456' });
    expect(updated.objectRef).toBe('obj-456');
    const cleared = await updateTodo(project, t.id, { objectRef: null });
    expect(cleared.objectRef).toBe(null);

    // An unrelated update leaves objectRef untouched (partial-patch semantics).
    await updateTodo(project, linked.id, { title: 'renamed' });
    expect(getTodo(project, linked.id)!.objectRef).toBe('obj-123');
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
    // De-conflate: stored 'planned', DERIVES claimable (re-runnable).
    expect(after.status).toBe('planned');
    expect(derivedClaimable(after)).toBe(true);
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
    // De-conflate: stored 'planned' + heldAt — DERIVES held (not claimable).
    expect(after.status).toBe('planned');
    expect(derivedReason(after)).toBe('held');
    // S3: exhaustion PARKS via heldAt/heldReason='retry-exhausted' (the honest
    // stored hold), not a bare status='blocked'. ONE write per row.
    expect(after.heldAt).not.toBeNull();
    expect(after.heldReason).toBe('retry-exhausted');
    expect(after.retryCount).toBe(attempts);
  });

  test('reclaimClaim: force-reclaims a live claim to ready regardless of lease; null for non-claims', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'agent-1', 60_000); // long lease, NOT expired
    const next = await reclaimClaim(project, t.id);
    expect(next).toBe('ready'); // back-compat label
    expect(getTodo(project, t.id)!.status).toBe('planned');
    expect(derivedClaimable(getTodo(project, t.id)!)).toBe(true);
    expect(getTodo(project, t.id)!.retryCount).toBe(1);
    // not in_progress anymore → null
    expect(await reclaimClaim(project, t.id)).toBeNull();
  });

  test('reclaimOrphan (now merged with reclaimClaim): reclaims an in_progress todo with NO claimToken', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready', parentId: 'epic-1' });
    // Simulate an orphan: in_progress but claimedBy/claimToken NULL (e.g. wiped by a
    // daemon restart). updateTodo(status:'in_progress') now throws, so strand the row
    // via a raw DB write, then re-open the store so the cached handle re-hydrates.
    strandOrphan(project, t.id);
    expect(getTodo(project, t.id)!.claimToken).toBeNull();
    // reclaimClaim and reclaimOrphan are aliases now — both rescue the orphan.
    const next = await reclaimOrphan(project, t.id);
    expect(next).toBe('ready'); // back-compat label
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('planned');
    expect(derivedClaimable(after)).toBe(true);
    expect(after.retryCount).toBe(1); // retry-budget-aware
    // not in_progress anymore → null
    expect(await reclaimOrphan(project, t.id)).toBeNull();
  });

  test('reclaimOrphan: parks to blocked once the retry cap is exceeded (budget-aware)', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    let status: 'ready' | 'blocked' | null = null;
    for (let i = 0; i <= MAX_CLAIM_RETRIES + 1; i++) {
      strandOrphan(project, t.id);
      status = await reclaimOrphan(project, t.id);
    }
    expect(status).toBe('blocked'); // back-compat label
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('planned');
    expect(derivedReason(after)).toBe('held');
    expect(after.heldAt).not.toBeNull();
    expect(after.heldReason).toBe('retry-exhausted');
    expect(after.retryCount).toBeGreaterThan(MAX_CLAIM_RETRIES);
  });

  test('releaseClaim: returns a live claim to ready with NO retry penalty; false for non-claims (DOGFOOD #3)', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await claimTodo(project, t.id, 'coordinator', 60_000);
    expect(getTodo(project, t.id)!.status).toBe('in_progress');
    const released = await releaseClaim(project, t.id);
    expect(released).toBe(true);
    const after = getTodo(project, t.id)!;
    expect(after.status).toBe('planned'); // stored; DERIVES immediately re-claimable
    expect(derivedClaimable(after)).toBe(true);
    expect(after.claimedBy).toBeNull();
    expect(after.claimToken).toBeNull();
    expect(after.claimedAt).toBeNull();
    expect(after.claimLeaseMs).toBeNull();
    expect(after.retryCount).toBe(0); // deferral is NOT a retry (unlike reclaimClaim)
    // already released → not an in_progress claim → false
    expect(await releaseClaim(project, t.id)).toBe(false);
  });

  test('listReadyTodos: ready w/ no deps included; ready w/ all-done deps included; ready w/ pending dep excluded; unknown dep id excluded', async () => {
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
    expect(ids).not.toContain(e.id); // derived model: an unknown dep is NOT satisfied
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
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    const { completed } = await completeTodo(project, t.id, 'accepted');
    expect(completed.status).toBe('done');
    expect(completed.completed).toBe(true);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.acceptanceStatus).toBe('accepted');
  });

  test('makes a claimable dependent whose only dep is this todo claimable', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'ready' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'ready', dependsOn: [dep.id] });
    const { completed } = await completeTodo(project, dep.id);
    expect(completed.status).toBe('done');
    expect(listReadyTodos(project).map((t) => t.id)).toContain(blocker.id);
  });

  test('a claimable dependent with another still-pending dep stays unclaimable', async () => {
    const dep1 = await createTodo(project, { ownerSession: 's1', title: 'dep1', status: 'ready' });
    const dep2 = await createTodo(project, { ownerSession: 's1', title: 'dep2', status: 'ready' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'ready', dependsOn: [dep1.id, dep2.id] });
    await completeTodo(project, dep1.id);
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(blocker.id);
  });

  test('does NOT make a planned todo claimable even if its deps are done', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'ready' });
    const planned = await createTodo(project, { ownerSession: 's1', title: 'planned', status: 'planned', dependsOn: [dep.id] });
    await completeTodo(project, dep.id);
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(planned.id);
    const after = getTodo(project, planned.id)!;
    expect(after.status).toBe('planned');
  });

  test('throws on missing id', async () => {
    await expect(completeTodo(project, 'no-such-id')).rejects.toThrow('todo not found');
  });

  test('acceptance gate: a REJECTED completion is NOT done and does NOT unblock dependents (SI-3)', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'ready' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'ready', dependsOn: [dep.id] });
    const { completed } = await completeTodo(project, dep.id, 'rejected');
    // SI-3 (de-conflate): rejected → non-terminal, stored 'planned' (not 'done'),
    // completedAt cleared + acceptanceStatus='rejected' the stored fact.
    expect(completed.status).toBe('planned');
    expect(completed.completedAt).toBeNull();
    expect(completed.acceptanceStatus).toBe('rejected');
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(blocker.id);
  });

  test('acceptance gate: a rejected todo is NOT auto-promoted by a later completion (SI-3)', async () => {
    // A rejected todo with no unsatisfied deps must stay parked, not re-promote to ready.
    const rejected = await createTodo(project, { ownerSession: 's1', title: 'rejected', status: 'ready' });
    await completeTodo(project, rejected.id, 'rejected');
    expect(getTodo(project, rejected.id)!.status).toBe('planned');
    expect(getTodo(project, rejected.id)!.acceptanceStatus).toBe('rejected');
    // An unrelated completion triggers the unblock pass — the rejected todo must NOT promote.
    const other = await createTodo(project, { ownerSession: 's1', title: 'other', status: 'ready' });
    const { promoted } = await completeTodo(project, other.id, 'accepted');
    expect(promoted).not.toContain(rejected.id);
    expect(getTodo(project, rejected.id)!.status).toBe('planned');
  });

  test('acceptance gate: an ACCEPTED dep makes dependents claimable', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'ready' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'ready', dependsOn: [dep.id] });
    await completeTodo(project, dep.id, 'accepted');
    expect(listReadyTodos(project).map((t) => t.id)).toContain(blocker.id);
  });

  test('acceptance gate: a null/unspecified-acceptance done dep still makes dependents claimable (backward-compatible)', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'ready' });
    const blocker = await createTodo(project, { ownerSession: 's1', title: 'blocker', status: 'ready', dependsOn: [dep.id] });
    await completeTodo(project, dep.id); // no acceptance arg
    expect(listReadyTodos(project).map((t) => t.id)).toContain(blocker.id);
  });

  test('acceptance gate: listReadyTodos excludes a ready todo whose dep was rejected', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'dep', status: 'ready' });
    // dependent left in 'ready' to isolate the listReadyTodos dep-check from the unblock pass
    const dependent = await createTodo(project, { ownerSession: 's1', title: 'dependent', status: 'ready', dependsOn: [dep.id] });
    await completeTodo(project, dep.id, 'rejected');
    expect(listReadyTodos(project).some((t) => t.id === dependent.id)).toBe(false);
  });
});

describe('completeTodo epic roll-up', () => {
  test('auto-completes a parent when its last child completes', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'ready', parentId: epic.id });
    const c2 = await createTodo(project, { ownerSession: 's1', title: 'c2', status: 'ready', parentId: epic.id });

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
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'ready', parentId: epic.id });
    await createTodo(project, { ownerSession: 's1', title: 'c2', status: 'ready', parentId: epic.id });
    const { rolledUp } = await completeTodo(project, c1.id, 'accepted');
    expect(rolledUp).toEqual([]);
    expect(getTodo(project, epic.id)!.status).toBe('planned');
  });

  test('a REJECTED child blocks roll-up', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'ready', parentId: epic.id });
    const c2 = await createTodo(project, { ownerSession: 's1', title: 'c2', status: 'ready', parentId: epic.id });
    await completeTodo(project, c1.id, 'rejected');
    const { rolledUp } = await completeTodo(project, c2.id, 'accepted');
    expect(rolledUp).toEqual([]);
    expect(getTodo(project, epic.id)!.status).toBe('planned');
  });

  test('a DROPPED child is ignored — roll-up fires when all non-dropped children are done', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    const c1 = await createTodo(project, { ownerSession: 's1', title: 'c1', status: 'ready', parentId: epic.id });
    await createTodo(project, { ownerSession: 's1', title: 'c2-dropped', status: 'dropped', parentId: epic.id });
    const { rolledUp } = await completeTodo(project, c1.id, 'accepted');
    expect(rolledUp).toContain(epic.id);
    expect(getTodo(project, epic.id)!.status).toBe('done');
  });

  test('recurses upward: completing the last leaf closes the whole chain', async () => {
    const grand = await createTodo(project, { ownerSession: 's1', title: 'grand', status: 'planned' });
    const mid = await createTodo(project, { ownerSession: 's1', title: 'mid', status: 'planned', parentId: grand.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'leaf', status: 'ready', parentId: mid.id });
    const { rolledUp } = await completeTodo(project, leaf.id, 'accepted');
    expect(rolledUp).toEqual([mid.id, grand.id]); // deepest-first
    expect(getTodo(project, mid.id)!.status).toBe('done');
    expect(getTodo(project, grand.id)!.status).toBe('done');
  });

  test('does not roll up an epic with zero (non-dropped) children', async () => {
    const epic = await createTodo(project, { ownerSession: 's1', title: 'epic', status: 'planned' });
    // a standalone child of NO epic — completing it must not touch the empty epic
    const solo = await createTodo(project, { ownerSession: 's1', title: 'solo', status: 'ready' });
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
  test('defaults to the tracking project (total field) and round-trips through create + update', async () => {
    // targetProject is now TOTAL: an omitted target defaults to this todo's own
    // tracking project, never NULL — so the Bridge can partition by it cleanly.
    const def = await createTodo(project, { ownerSession: 's1', title: 'same-project' });
    expect(def.targetProject).toBe(project);

    const t = await createTodo(project, { ownerSession: 's1', title: 'cross', targetProject: '/repos/build123d' });
    expect(t.targetProject).toBe('/repos/build123d');
    // survives reload (hydration from disk)
    expect(getTodo(project, t.id)!.targetProject).toBe('/repos/build123d');

    const updated = await updateTodo(project, t.id, { targetProject: '/repos/other' });
    expect(updated.targetProject).toBe('/repos/other');
    // an unrelated update leaves targetProject untouched
    await updateTodo(project, t.id, { targetProject: '/repos/keep' });
    expect((await updateTodo(project, t.id, { title: 'renamed' })).targetProject).toBe('/repos/keep');
  });
});

describe('todo-store assigneeKind + completedBy (B1 attribution)', () => {
  test('assigneeKind defaults to agent and round-trips; completedBy null for agent completion', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'agent task' });
    expect(t.assigneeKind).toBe('agent');
    expect(t.completedBy).toBeNull();
    const done = await completeTodo(project, t.id);
    expect(done.completed.status).toBe('done');
    expect(done.completed.completedBy).toBeNull(); // agent → no actor stamped
  });

  test('explicit human assigneeKind persists through create + reload', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'review', assigneeKind: 'human' });
    expect(t.assigneeKind).toBe('human');
    expect(getTodo(project, t.id)!.assigneeKind).toBe('human');
  });

  test('completing a HUMAN todo auto-stamps a default actor handle as completedBy', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'human review', assigneeKind: 'human' });
    const done = await completeTodo(project, t.id);
    expect(done.completed.completedBy).toMatch(/^local:/);
  });

  test('completeTodo honours an explicit completedBy actor', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'attributed', assigneeKind: 'human' });
    const done = await completeTodo(project, t.id, 'accepted', 'local:alice');
    expect(done.completed.completedBy).toBe('local:alice');
  });

  test('updateTodo completing a human todo stamps completedBy; un-completing clears it', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'via update', assigneeKind: 'human' });
    const done = await updateTodo(project, t.id, { completed: true });
    expect(done.completedBy).toMatch(/^local:/);
    const reopened = await updateTodo(project, t.id, { completed: false });
    expect(reopened.completedBy).toBeNull(); // not done → cleared
  });

  test('a rejected completion is not done and carries no completedBy', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'rej', assigneeKind: 'human' });
    const res = await completeTodo(project, t.id, 'rejected');
    expect(res.completed.status).toBe('planned');
    expect(res.completed.completedBy).toBeNull();
  });

  test('B2: listReadyTodos excludes ready human todos (not coordinator-claimable)', async () => {
    const agentT = await createTodo(project, { ownerSession: 's1', title: 'agent work', status: 'ready', assigneeKind: 'agent' });
    const humanT = await createTodo(project, { ownerSession: 's1', title: 'human review', status: 'ready', assigneeKind: 'human' });
    const ids = listReadyTodos(project).map((t) => t.id);
    expect(ids).toContain(agentT.id);
    expect(ids).not.toContain(humanT.id); // human todo sits outside the claim path
  });

  test('B2: an agent todo depending on a human todo becomes claimable once the human marks it done (both-way flow)', async () => {
    const humanDep = await createTodo(project, { ownerSession: 's1', title: 'human approves', status: 'ready', assigneeKind: 'human' });
    const agentDependent = await createTodo(project, { ownerSession: 's1', title: 'agent follows', status: 'ready', assigneeKind: 'agent', dependsOn: [humanDep.id] });
    // human dep not done yet → agent dependent blocked from claim
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(agentDependent.id);
    // human marks their todo done → dep satisfied → agent todo now claimable
    await completeTodo(project, humanDep.id, 'accepted');
    expect(listReadyTodos(project).map((t) => t.id)).toContain(agentDependent.id);
  });
});

describe('readiness gates (createGate — design-readiness-gates P1)', () => {
  test('a gate-dep holds the work-todo blocked; completing the gate auto-promotes it to ready on the SAME tick (no reset_todo)', async () => {
    const work = await createTodo(project, { ownerSession: 's1', title: 'build the thing', status: 'ready', assigneeKind: 'agent' });
    const { gate, workTodo } = await createGate(project, { workTodoId: work.id, title: 'review the spec', gateKind: 'spec-review' });
    // S3: the work-todo is parked behind the gate by the OPEN gate DEP (deps-pending,
    // derived) — NOT a manual hold. It stays approved + un-held so it re-derives
    // claimable the moment the gate completes.
    expect(workTodo.heldAt).toBeNull();
    expect(workTodo.approvedAt).not.toBeNull();
    expect(workTodo.dependsOn).toContain(gate.id);
    expect(gate.assigneeKind).toBe('human');
    expect(gate.title).toBe('[GATE:spec-review] review the spec');
    // Coordinator can't claim it while the gate is open.
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(work.id);
    // Human clears the gate → the SAME completeTodo tick makes the work-todo claimable.
    await completeTodo(project, gate.id, 'accepted');
    expect(listReadyTodos(project).map((t) => t.id)).toContain(work.id);
  });

  test('the [GATE] human todo is never coordinator-claimable (excluded from listReadyTodos)', async () => {
    const work = await createTodo(project, { ownerSession: 's1', title: 'w', status: 'ready', assigneeKind: 'agent' });
    const { gate } = await createGate(project, { workTodoId: work.id, title: 'sign off' });
    expect(gate.approvedAt).not.toBeNull(); // approved → a human CAN act on it immediately
    expect(gate.heldAt).toBeNull();
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(gate.id); // but the coordinator never claims it (human)
  });

  test('reverse-edge views: listGatesBlocking + listGatedBy', async () => {
    const work = await createTodo(project, { ownerSession: 's1', title: 'w', status: 'ready', assigneeKind: 'agent' });
    const { gate } = await createGate(project, { workTodoId: work.id, title: 'g' });
    expect(listGatesBlocking(project, work.id).map((t) => t.id)).toEqual([gate.id]);
    expect(listGatedBy(project, gate.id).map((t) => t.id)).toEqual([work.id]);
    // Once cleared, it no longer shows as blocking.
    await completeTodo(project, gate.id, 'accepted');
    expect(listGatesBlocking(project, work.id)).toEqual([]);
  });

  test('P2: a gate carries its decisionRef; completeGatesForDecision auto-completes it + promotes the dependent (same tick)', async () => {
    const work = await createTodo(project, { ownerSession: 's1', title: 'build on the design', status: 'ready', assigneeKind: 'agent' });
    const { gate, workTodo } = await createGate(project, { workTodoId: work.id, title: 'land the design', gateKind: 'design', decisionRef: 'dr-123' });
    expect(gate.decisionRef).toBe('dr-123');
    // S3: gated by the open gate DEP (deps-pending), not a manual hold.
    expect(workTodo.heldAt).toBeNull();
    expect(workTodo.approvedAt).not.toBeNull();
    // approveDecisionRecord('dr-123') fires → this is the auto-complete it triggers.
    const results = await completeGatesForDecision(project, 'dr-123');
    expect(results.length).toBe(1);
    expect(getTodo(project, gate.id)!.status).toBe('done');
    expect(getTodo(project, gate.id)!.completedBy).toBe('decision:dr-123');
    expect(listReadyTodos(project).map((t) => t.id)).toContain(work.id);
  });

  test('P2: completeGatesForDecision is a no-op when no gate references the decision', async () => {
    await createGate(project, { workTodoId: (await createTodo(project, { ownerSession: 's1', title: 'w', status: 'ready' })).id, title: 'g', decisionRef: 'dr-A' });
    expect(await completeGatesForDecision(project, 'dr-OTHER')).toEqual([]);
  });

  test('regression: a plain agent-dep still gates + makes the dependent claimable once the dep completes', async () => {
    const depA = await createTodo(project, { ownerSession: 's1', title: 'depA', status: 'ready', assigneeKind: 'agent' });
    const dependent = await createTodo(project, { ownerSession: 's1', title: 'dependent', status: 'ready', assigneeKind: 'agent', dependsOn: [depA.id] });
    expect(listReadyTodos(project).map((t) => t.id)).not.toContain(dependent.id);
    await completeTodo(project, depA.id, 'accepted');
    expect(listReadyTodos(project).map((t) => t.id)).toContain(dependent.id);
  });
});

describe('steward verbs', () => {
  test('resetTodo clears retryCount/acceptance/claim and re-promotes a parked over-retried todo', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'stuck' });
    await updateTodo(project, t.id, { status: 'ready' }); // claimable
    // Drive it over the retry budget via repeated claim→reclaim until it parks 'blocked'.
    let status: 'ready' | 'blocked' | null = null;
    for (let i = 0; i < MAX_CLAIM_RETRIES + 2 && status !== 'blocked'; i++) {
      const claimed = await claimTodo(project, t.id, 'coordinator', 1000);
      if (!claimed) break;
      status = await reclaimClaim(project, t.id);
    }
    expect(status).toBe('blocked');
    const parked = getTodo(project, t.id)!;
    expect(parked.retryCount).toBeGreaterThan(MAX_CLAIM_RETRIES);

    const reset = await resetTodo(project, t.id);
    // resetTodo defaults to status 'ready' = approve + clear-hold (derived claimable),
    // so the stored status is no longer 'ready' but the todo is approved + unheld.
    expect(reset.approvedAt).not.toBeNull();
    expect(reset.heldAt).toBeNull();
    expect(reset.retryCount).toBe(0);
    expect(reset.acceptanceStatus).toBeNull();
    expect(reset.claimedBy).toBeNull();
    // Now claimable again — a fresh claim won't immediately re-park.
    expect(listReadyTodos(project).map((x) => x.id)).toContain(t.id);
  });

  test('resetTodo honors an explicit target status', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'park-me' });
    const r = await resetTodo(project, t.id, 'planned');
    expect(r.status).toBe('planned');
    expect(r.retryCount).toBe(0);
  });

  test('resetTodo auto-resolves the todo\'s open escalations (re-promote supersedes stale red)', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'rejected-leaf', status: 'blocked' });
    // A blocker raised against this todo (the 'paused on a human' red signal).
    const { escalation: e } = createEscalation({ project, session: 'leaf-exec-x', kind: 'blocker', todoId: t.id, questionText: 'rejected — gate failed' });
    // An UNRELATED open escalation (different todo) must NOT be touched.
    const { escalation: other } = createEscalation({ project, session: 's2', kind: 'blocker', todoId: 'someone-else', questionText: 'unrelated' });
    expect(getEscalation(e.id)?.status).toBe('open');

    await resetTodo(project, t.id, 'ready');

    expect(getEscalation(e.id)?.status).toBe('resolved'); // the todo's escalation cleared
    expect(getEscalation(other.id)?.status).toBe('open');  // the unrelated one untouched
  });

  test('resetTodo reroutes targetProject when provided, leaves it untouched when omitted', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'misrouted', targetProject: '/old/repo' });
    // omitted → unchanged
    const a = await resetTodo(project, t.id, 'ready');
    expect(a.targetProject).toBe('/old/repo');
    // explicit → rerouted
    const b = await resetTodo(project, t.id, 'ready', '/new/repo');
    expect(b.targetProject).toBe('/new/repo');
    // null → cleared
    const c = await resetTodo(project, t.id, 'ready', null);
    expect(c.targetProject).toBeNull();
  });

  test('overrideAcceptTodo force-accepts a gate-rejected todo and unblocks its dependents', async () => {
    const dep = await createTodo(project, { ownerSession: 's1', title: 'verified-but-rejected', status: 'ready' });
    // Approved dependent gated only by its pending dep (derived model: deps-pending,
    // not a stored 'blocked'). It must not be claimable while the dep is unsatisfied.
    const child = await createTodo(project, { ownerSession: 's1', title: 'waiting', status: 'ready', dependsOn: [dep.id] });
    // Simulate the false-rejection: gate said no, dep parked 'blocked'/rejected.
    await completeTodo(project, dep.id, 'rejected');
    expect(getTodo(project, dep.id)!.status).toBe('planned');
    expect(getTodo(project, dep.id)!.acceptanceStatus).toBe('rejected');
    expect(listReadyTodos(project).map((x) => x.id)).not.toContain(child.id);

    const res = await overrideAcceptTodo(project, dep.id);
    expect(res.completed.status).toBe('done');
    expect(res.completed.acceptanceStatus).toBe('accepted');
    expect(res.completed.completedBy).toBe('steward');
    // Dependent unblocks exactly as a normal acceptance — now CLAIMABLE (derived),
    // even though the stored-blocked fan-out (`promoted`) no longer carries it.
    expect(listReadyTodos(project).map((x) => x.id)).toContain(child.id);
  });

  test('openDb maps a worker-worktree path → the tracking repo db (same rows)', async () => {
    // Regression for the recurring isolation-worker 'todo not found' / 'disk I/O error'
    // phantom-claim escalations (decision 20106f26): a worker whose project is its
    // worktree (<repo>/.collab/agent-sessions/worktrees/<lane>) must resolve to the
    // SAME todos.db as the repo root — never a worktree-local empty/absent db.
    const created = await createTodo(project, { ownerSession: 's1', title: 'owned-by-repo' });
    const worktreePath = join(project, '.collab', 'agent-sessions', 'worktrees', 'backend-2');

    // Read through the worktree path: must see the repo's row, not an empty db.
    const viaWorktree = getTodo(worktreePath, created.id);
    expect(viaWorktree).not.toBeNull();
    expect(viaWorktree!.title).toBe('owned-by-repo');
    expect(listTodos(worktreePath).map((t) => t.id)).toContain(created.id);

    // Write through the worktree path: must land in the repo's db.
    const fromWorktree = await createTodo(worktreePath, { ownerSession: 's2', title: 'created-in-worktree' });
    expect(getTodo(project, fromWorktree.id)!.title).toBe('created-in-worktree');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S3 — write-side translation seam (updateTodo/createTodo) + derived readiness.
// A status-write of a now-DERIVED value (ready/blocked/in_progress) must translate
// to a decision-write and NEVER persist the raw derived enum.
// ───────────────────────────────────────────────────────────────────────────
describe('S3 write-side translation seam', () => {
  test("updateTodo status:'ready' → sets approvedAt, clears heldAt, never stores 'ready'", async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x' }); // 'todo', unapproved
    expect(t.approvedAt).toBeNull();
    const u = await updateTodo(project, t.id, { status: 'ready' });
    expect(u.approvedAt).not.toBeNull();
    expect(u.heldAt).toBeNull();
    expect(u.status).not.toBe('ready'); // derived value never persisted
    // ...and it is now CLAIMABLE (approved, no deps, agent, un-held).
    expect(listReadyTodos(project).map((x) => x.id)).toContain(t.id);
  });

  test("updateTodo status:'blocked' → sets heldAt + heldReason='manual', never stores 'blocked'", async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    expect(listReadyTodos(project).map((x) => x.id)).toContain(t.id); // claimable first
    const u = await updateTodo(project, t.id, { status: 'blocked' });
    expect(u.heldAt).not.toBeNull();
    expect(u.heldReason).toBe('manual');
    expect(u.status).not.toBe('blocked'); // derived value never persisted
    // A held todo is NOT claimable.
    expect(listReadyTodos(project).map((x) => x.id)).not.toContain(t.id);
  });

  test("updateTodo status:'in_progress' → REJECTED (a manual claim is nonsensical)", async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    await expect(updateTodo(project, t.id, { status: 'in_progress' })).rejects.toThrow(/in_progress/);
    // Unchanged: still claimable, no fabricated claim.
    expect(getTodo(project, t.id)!.claim).toBeNull();
  });

  test("createTodo status:'ready' → translates to approvedAt at create (not stored 'ready')", async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'born-approved', status: 'ready' });
    expect(t.approvedAt).not.toBeNull();
    expect(t.heldAt).toBeNull();
    expect(t.status).not.toBe('ready');
    expect(listReadyTodos(project).map((x) => x.id)).toContain(t.id);
  });

  test("createTodo status:'blocked' → translates to a manual hold at create", async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'born-held', status: 'blocked' });
    expect(t.heldAt).not.toBeNull();
    expect(t.heldReason).toBe('manual');
    expect(t.status).not.toBe('blocked');
  });

  test("createTodo status:'in_progress' → REJECTED", async () => {
    await expect(createTodo(project, { ownerSession: 's1', title: 'x', status: 'in_progress' }))
      .rejects.toThrow(/in_progress/);
  });

  test("status:'planned' un-approves (clears approvedAt) and stores 'planned'", async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    expect(t.approvedAt).not.toBeNull();
    const u = await updateTodo(project, t.id, { status: 'planned' });
    expect(u.status).toBe('planned');
    expect(u.approvedAt).toBeNull();
    expect(listReadyTodos(project).map((x) => x.id)).not.toContain(t.id);
  });

  test('a non-status patch does NOT mint a spurious decision', async () => {
    const t = await createTodo(project, { ownerSession: 's1', title: 'x', status: 'ready' });
    const before = getTodo(project, t.id)!;
    const u = await updateTodo(project, t.id, { title: 'renamed' });
    expect(u.title).toBe('renamed');
    expect(u.approvedAt).toBe(before.approvedAt); // unchanged
    expect(u.heldAt).toBeNull();
  });

  test('listReadyTodos uses isClaimable, not the stored status enum', async () => {
    // Approved + no deps + agent → claimable, even though stored status is NOT 'ready'.
    const claimable = await createTodo(project, { ownerSession: 's1', title: 'a', status: 'ready' });
    expect(getTodo(project, claimable.id)!.status).not.toBe('ready');
    // Unapproved → not claimable.
    const unapproved = await createTodo(project, { ownerSession: 's1', title: 'b' });
    // Approved human → not daemon-claimable (human-assignee).
    const human = await createTodo(project, { ownerSession: 's1', title: 'c', status: 'ready', assigneeKind: 'human' });
    const ids = listReadyTodos(project).map((x) => x.id);
    expect(ids).toContain(claimable.id);
    expect(ids).not.toContain(unapproved.id);
    expect(ids).not.toContain(human.id);
  });
});
