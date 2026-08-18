import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Todo } from '../todo-store.ts';
import { addSubscription, pendingCount, drainInbox, __resetForTest } from '../session-subscriptions.ts';
import { runNotificationTick, __resetTickState } from '../session-notification-tick.ts';
import { createRecordingChannelTransport } from '../channel-nudge-transport.js';
import { mkTodo } from './fixtures/mk-todo';
import type { TodoKind } from '../todo-kind';

const P = '/proj/a';
const todo = (id: string, over: Partial<Todo> & { kind: TodoKind }): Todo =>
  mkTodo({ id, title: `Todo ${id}`, ...over });

beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-chan-'));
  __resetForTest();
  __resetTickState();
});

describe('channel nudge delivery', () => {
  it('an enqueued notification for an idle subscribed session emits one channel nudge', async () => {
    addSubscription(P, 's1', 'project');
    const rec = createRecordingChannelTransport();
    const deps = {
      loadTodos: (project: string) => [],
      now: () => 1000,
      channelTransport: rec,
      isIdle: () => true,
    };

    // Seed pass
    const before = [todo('a', { status: 'ready', kind: 'leaf' })];
    const seed = await runNotificationTick(P, { ...deps, loadTodos: () => before, now: () => 1000 });
    expect(seed.enqueued).toBe(0);
    expect(rec.deliveries.length).toBe(0);

    // Change pass
    const after = [todo('a', { status: 'done', kind: 'leaf' })];
    const change = await runNotificationTick(P, { ...deps, loadTodos: () => after, now: () => 2000 });
    expect(change.enqueued).toBe(1);
    expect(change.nudged).toEqual(['s1']);
    expect(rec.deliveries.length).toBe(1);
    expect(rec.deliveries[0].session).toBe('s1');
  });

  it('a nudge for a busy session stays queued for the next drain', async () => {
    addSubscription(P, 's1', 'project');
    const rec = createRecordingChannelTransport();
    const deps = {
      loadTodos: (project: string) => [],
      now: () => 1000,
      channelTransport: rec,
      isIdle: () => false,
    };

    // Seed pass
    const before = [todo('a', { status: 'ready', kind: 'leaf' })];
    const seed = await runNotificationTick(P, { ...deps, loadTodos: () => before, now: () => 1000 });
    expect(seed.enqueued).toBe(0);
    expect(rec.deliveries.length).toBe(0);

    // Change pass with busy session
    const after = [todo('a', { status: 'done', kind: 'leaf' })];
    const change = await runNotificationTick(P, { ...deps, loadTodos: () => after, now: () => 2000 });
    expect(change.enqueued).toBe(1);
    expect(change.nudged).toEqual([]);
    expect(rec.deliveries.length).toBe(0);
    expect(pendingCount(P, 's1')).toBe(1);

    // Verify drainInbox returns the still-queued notification
    const drained = drainInbox(P, 's1');
    expect(drained.length).toBe(1);
  });
});
