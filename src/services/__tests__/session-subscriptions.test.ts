import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  subscriptionMatches,
  addSubscription,
  removeSubscription,
  listSubscriptionsForSession,
  listAllSubscriptions,
  dropSubscriptionsForSession,
  expireSubscriptionsForTarget,
  enqueueNotification,
  pendingCount,
  drainInbox,
  sweepStaleSubscriptions,
  SUBSCRIPTION_TTL_MS,
  __resetForTest,
  type Subscription,
} from '../session-subscriptions.ts';

const P = '/proj/a';
const sub = (over: Partial<Subscription> = {}): Subscription =>
  ({ project: P, session: 's1', scope: 'project', targetId: '', mode: 'nudge', createdAt: 0, ...over });

beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-subs-'));
  __resetForTest();
});

describe('subscriptionMatches (pure)', () => {
  it('project scope matches any event in the same project', () => {
    expect(subscriptionMatches(sub({ scope: 'project' }), { project: P, todoId: 't1', epicId: 'e1' })).toBe(true);
    expect(subscriptionMatches(sub({ scope: 'project' }), { project: P })).toBe(true); // daemon event, no ids
  });
  it('project scope does NOT match another project', () => {
    expect(subscriptionMatches(sub({ scope: 'project' }), { project: '/proj/b', todoId: 't1' })).toBe(false);
  });
  it('todo scope matches only its target id', () => {
    expect(subscriptionMatches(sub({ scope: 'todo', targetId: 't1' }), { project: P, todoId: 't1' })).toBe(true);
    expect(subscriptionMatches(sub({ scope: 'todo', targetId: 't1' }), { project: P, todoId: 't2' })).toBe(false);
    expect(subscriptionMatches(sub({ scope: 'todo', targetId: 't1' }), { project: P })).toBe(false);
  });
  it('epic scope matches only its target epic id', () => {
    expect(subscriptionMatches(sub({ scope: 'epic', targetId: 'e1' }), { project: P, epicId: 'e1' })).toBe(true);
    expect(subscriptionMatches(sub({ scope: 'epic', targetId: 'e1' }), { project: P, epicId: 'e2' })).toBe(false);
  });
  it('mission scope matches only its target mission id', () => {
    expect(subscriptionMatches(sub({ scope: 'mission', targetId: 'm1' }), { project: P, missionId: 'm1' })).toBe(true);
    expect(subscriptionMatches(sub({ scope: 'mission', targetId: 'm1' }), { project: P, missionId: 'm2' })).toBe(false);
    expect(subscriptionMatches(sub({ scope: 'mission', targetId: 'm1' }), { project: P, todoId: 't1' })).toBe(false);
  });
});

describe('subscription store CRUD', () => {
  it('adds + lists; project scope stores targetId=""', () => {
    addSubscription(P, 's1', 'project', undefined, 'nudge', 100);
    addSubscription(P, 's1', 'epic', 'e1', 'nudge', 200);
    const rows = listSubscriptionsForSession(P, 's1');
    expect(rows.map((r) => r.scope).sort()).toEqual(['epic', 'project']);
    expect(rows.find((r) => r.scope === 'project')!.targetId).toBe('');
    expect(rows.find((r) => r.scope === 'epic')!.targetId).toBe('e1');
  });

  it('add is idempotent (upsert on the PK)', () => {
    addSubscription(P, 's1', 'epic', 'e1');
    addSubscription(P, 's1', 'epic', 'e1');
    expect(listSubscriptionsForSession(P, 's1').length).toBe(1);
  });

  it('requires a targetId for todo/epic scope', () => {
    expect(() => addSubscription(P, 's1', 'todo')).toThrow(/targetId/);
  });

  it('removeSubscription deletes the row', () => {
    addSubscription(P, 's1', 'todo', 't1');
    expect(removeSubscription(P, 's1', 'todo', 't1')).toBe(true);
    expect(removeSubscription(P, 's1', 'todo', 't1')).toBe(false);
    expect(listSubscriptionsForSession(P, 's1').length).toBe(0);
  });

  it('dropSubscriptionsForSession clears subs + queued notifications', () => {
    addSubscription(P, 's1', 'project');
    enqueueNotification({ project: P, session: 's1', scope: 'project', targetId: '', event: 'todo_updated', summary: 'x' });
    const removed = dropSubscriptionsForSession(P, 's1');
    expect(removed).toBe(1);
    expect(listSubscriptionsForSession(P, 's1').length).toBe(0);
    expect(pendingCount(P, 's1')).toBe(0);
  });

  it('expireSubscriptionsForTarget removes todo/epic subs for a now-terminal target', () => {
    addSubscription(P, 's1', 'epic', 'e1');
    addSubscription(P, 's2', 'epic', 'e1');
    addSubscription(P, 's1', 'project'); // untouched
    const removed = expireSubscriptionsForTarget(P, 'e1');
    expect(removed).toBe(2);
    expect(listAllSubscriptions().map((r) => r.scope)).toEqual(['project']);
  });

  it('mission subscription is idempotent (second add = same row)', () => {
    addSubscription(P, 's1', 'mission', 'm1');
    addSubscription(P, 's1', 'mission', 'm1');
    expect(listSubscriptionsForSession(P, 's1')).toHaveLength(1);
  });

  it('mission subscription requires a targetId', () => {
    expect(() => addSubscription(P, 's1', 'mission')).toThrow(/targetId/);
  });

  it('expireSubscriptionsForTarget leaves mission subs intact', () => {
    addSubscription(P, 's1', 'mission', 'm1');
    addSubscription(P, 's1', 'epic', 'e1');
    const removed = expireSubscriptionsForTarget(P, 'e1');
    expect(removed).toBe(1);
    expect(listAllSubscriptions()).toHaveLength(1);
    expect(listAllSubscriptions()[0].scope).toBe('mission');
  });
});

describe('notification inbox', () => {
  it('enqueue → pendingCount → drain marks seen (self-healing full drain)', () => {
    enqueueNotification({ project: P, session: 's1', scope: 'epic', targetId: 'e1', event: 'todo_done', summary: 'leaf A done', payload: { todoId: 'a' } });
    enqueueNotification({ project: P, session: 's1', scope: 'epic', targetId: 'e1', event: 'todo_blocked', summary: 'leaf B blocked' });
    expect(pendingCount(P, 's1')).toBe(2);

    const first = drainInbox(P, 's1');
    expect(first.length).toBe(2);
    expect(first[0].summary).toBe('leaf A done');
    expect(JSON.parse(first[0].payload!)).toEqual({ todoId: 'a' });

    // Drained → second drain is empty (idempotent), and a new event shows up alone.
    expect(drainInbox(P, 's1').length).toBe(0);
    enqueueNotification({ project: P, session: 's1', scope: 'epic', targetId: 'e1', event: 'todo_done', summary: 'leaf C done' });
    const second = drainInbox(P, 's1');
    expect(second.map((n) => n.summary)).toEqual(['leaf C done']);
  });

  it('inbox is scoped per session', () => {
    enqueueNotification({ project: P, session: 's1', scope: 'project', targetId: '', event: 'x', summary: 'for s1' });
    enqueueNotification({ project: P, session: 's2', scope: 'project', targetId: '', event: 'x', summary: 'for s2' });
    expect(drainInbox(P, 's1').map((n) => n.summary)).toEqual(['for s1']);
    expect(pendingCount(P, 's2')).toBe(1);
  });
});

describe('enqueue dedupe-while-pending', () => {
  it('same (target,event) re-emitted before drain refreshes in place; after drain it enqueues fresh', () => {
    addSubscription(P, 's9', 'project');
    const a = enqueueNotification({ project: P, session: 's9', scope: 'todo', targetId: 'T1', event: 'todo_claimed', summary: 'first', ts: 1 });
    const b = enqueueNotification({ project: P, session: 's9', scope: 'todo', targetId: 'T1', event: 'todo_claimed', summary: 'again', ts: 2 });
    expect(b.id).toBe(a.id); // refreshed, not duplicated
    expect(pendingCount(P, 's9')).toBe(1);
    const drained = drainInbox(P, 's9');
    expect(drained).toHaveLength(1);
    expect(drained[0].summary).toBe('again'); // latest summary won
    // a NEW event after the drain is a fresh row
    const c = enqueueNotification({ project: P, session: 's9', scope: 'todo', targetId: 'T1', event: 'todo_claimed', summary: 'later', ts: 3 });
    expect(c.id).not.toBe(a.id);
    expect(pendingCount(P, 's9')).toBe(1);
  });
});

describe('sweepStaleSubscriptions (dead-session reap)', () => {
  const NOW = 10 * SUBSCRIPTION_TTL_MS;

  it('reaps a session with no liveness signal past the TTL, notifications included', () => {
    addSubscription(P, 'ghost', 'project', undefined, 'nudge', NOW - SUBSCRIPTION_TTL_MS - 1);
    enqueueNotification({ project: P, session: 'ghost', scope: 'project', targetId: '', event: 'x', summary: 'y', ts: 1 });
    expect(sweepStaleSubscriptions(SUBSCRIPTION_TTL_MS, NOW)).toBe(1);
    expect(listSubscriptionsForSession(P, 'ghost')).toEqual([]);
    expect(pendingCount(P, 'ghost')).toBe(0);
  });

  it('spares a session inside the TTL', () => {
    addSubscription(P, 'fresh', 'project', undefined, 'nudge', NOW - SUBSCRIPTION_TTL_MS + 1000);
    expect(sweepStaleSubscriptions(SUBSCRIPTION_TTL_MS, NOW)).toBe(0);
    expect(listSubscriptionsForSession(P, 'fresh').length).toBe(1);
  });

  it("one fresh subscription shields the session's older rows (session-granular)", () => {
    addSubscription(P, 's1', 'project', undefined, 'nudge', NOW - SUBSCRIPTION_TTL_MS * 3);
    addSubscription(P, 's1', 'epic', 'e1', 'nudge', NOW - 1000);
    expect(sweepStaleSubscriptions(SUBSCRIPTION_TTL_MS, NOW)).toBe(0);
    expect(listSubscriptionsForSession(P, 's1').length).toBe(2);
  });

  it('drainInbox refreshes liveness — a pulling session is never reaped', () => {
    addSubscription(P, 'puller', 'project', undefined, 'nudge', 0); // ancient createdAt
    drainInbox(P, 'puller'); // stamps lastSeenAt = real now
    expect(sweepStaleSubscriptions(SUBSCRIPTION_TTL_MS, Date.now())).toBe(0);
    expect(listSubscriptionsForSession(P, 'puller').length).toBe(1);
  });

  it('re-subscribe after a reap restores the row (upsert refreshes lastSeenAt)', () => {
    addSubscription(P, 'back', 'project', undefined, 'nudge', 0);
    expect(sweepStaleSubscriptions(SUBSCRIPTION_TTL_MS, NOW)).toBe(1);
    addSubscription(P, 'back', 'project', undefined, 'nudge', NOW);
    expect(sweepStaleSubscriptions(SUBSCRIPTION_TTL_MS, NOW)).toBe(0);
    expect(listSubscriptionsForSession(P, 'back').length).toBe(1);
  });
});
