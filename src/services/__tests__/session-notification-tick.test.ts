import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Todo } from '../todo-store.ts';
import { addSubscription, pendingCount, drainInbox, listSubscriptionsForSession, __resetForTest } from '../session-subscriptions.ts';
import { runNotificationTick, __resetTickState, MIN_NUDGE_INTERVAL_MS } from '../session-notification-tick.ts';

const P = '/proj/a';
const todo = (id: string, over: Partial<Todo> = {}): Todo =>
  ({ id, title: `Todo ${id}`, status: 'planned', acceptanceStatus: null, parentId: null, dependsOn: [], ...over } as unknown as Todo);

let nudges: Array<{ session: string; text: string }>;
let nudgeResult: 'sent' | 'busy' | 'no-tmux';

beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-tick-'));
  __resetForTest();
  __resetTickState();
  nudges = [];
  nudgeResult = 'sent';
});

function deps(todos: Todo[], now: number) {
  return {
    loadTodos: () => todos,
    now: () => now,
    nudge: async (_p: string, session: string, text: string) => { nudges.push({ session, text }); return nudgeResult; },
  };
}

describe('runNotificationTick', () => {
  it('seeds on the first pass (no enqueue, no nudge), then notifies + nudges on a real change', async () => {
    addSubscription(P, 's1', 'project');
    const before = [todo('a', { status: 'ready' })];
    const r1 = await runNotificationTick(P, deps(before, 1000));
    expect(r1.enqueued).toBe(0);
    expect(nudges).toEqual([]);

    const after = [todo('a', { status: 'done' })];
    const r2 = await runNotificationTick(P, deps(after, 2000));
    expect(r2.enqueued).toBe(1);
    expect(r2.nudged).toEqual(['s1']);
    expect(nudges[0].text).toMatch(/1 update on a — call inbox\(\)/);
    expect(pendingCount(P, 's1')).toBe(1); // still pending until the agent drains via inbox()
    expect(drainInbox(P, 's1')[0].summary).toMatch(/done/);
  });

  it('no subscriptions → no-op', async () => {
    const r = await runNotificationTick(P, deps([todo('a', { status: 'done' })], 1000));
    expect(r).toEqual({ enqueued: 0, nudged: [] });
  });

  it('throttles re-nudges within MIN_NUDGE_INTERVAL_MS', async () => {
    addSubscription(P, 's1', 'project');
    await runNotificationTick(P, deps([todo('a', { status: 'ready' })], 1000)); // seed
    await runNotificationTick(P, deps([todo('a', { status: 'done' })], 2000));  // nudge @2000
    expect(nudges.length).toBe(1);
    // Another change shortly after — within the interval → enqueued but NOT re-nudged.
    await runNotificationTick(P, deps([todo('a', { status: 'done' }), todo('b', { status: 'blocked' })], 2000 + MIN_NUDGE_INTERVAL_MS - 1));
    expect(nudges.length).toBe(1);
    // Past the interval → nudges again.
    await runNotificationTick(P, deps([todo('a', { status: 'done' }), todo('b', { status: 'blocked' }), todo('c', { status: 'blocked' })], 2000 + MIN_NUDGE_INTERVAL_MS + 1));
    expect(nudges.length).toBe(2);
  });

  it("a 'busy' session is not marked nudged and stays pending for the next tick", async () => {
    addSubscription(P, 's1', 'project');
    nudgeResult = 'busy';
    await runNotificationTick(P, deps([todo('a', { status: 'ready' })], 1000)); // seed
    const r = await runNotificationTick(P, deps([todo('a', { status: 'done' })], 2000));
    expect(r.nudged).toEqual([]);      // busy → not counted as nudged
    expect(nudges.length).toBe(1);     // we DID attempt
    expect(pendingCount(P, 's1')).toBe(1); // still queued
    // Next tick, now idle + past interval → delivers.
    nudgeResult = 'sent';
    const r2 = await runNotificationTick(P, deps([todo('a', { status: 'done' })], 2000 + MIN_NUDGE_INTERVAL_MS + 1));
    expect(r2.nudged).toEqual(['s1']);
  });

  it('expires an epic subscription when the epic itself goes terminal', async () => {
    addSubscription(P, 's1', 'epic', 'E');
    const epic = todo('E', { title: '[EPIC] x', status: 'in_progress' });
    await runNotificationTick(P, deps([epic], 1000)); // seed
    await runNotificationTick(P, deps([todo('E', { title: '[EPIC] x', status: 'done', acceptanceStatus: 'accepted' })], 2000));
    expect(listSubscriptionsForSession(P, 's1')).toEqual([]); // epic terminal → sub expired
  });
});
