import { describe, it, expect, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Todo } from '../todo-store.ts';
import { addSubscription, pendingCount, drainInbox, __resetForTest } from '../session-subscriptions.ts';
import { runNotificationTick, __resetTickState, MIN_NUDGE_INTERVAL_MS, REANNOUNCE_BASE_MS } from '../session-notification-tick.ts';
import { mkTodo } from './fixtures/mk-todo';
import type { TodoKind } from '../todo-kind';

const P = '/proj/a';
const todo = (id: string, over: Partial<Todo> & { kind: TodoKind }): Todo =>
  mkTodo({ id, title: `Todo ${id}`, ...over });

let nudges: Array<{ session: string; text: string }>;
let nudgeResult: 'sent' | 'busy' | 'no-tmux';

beforeEach(() => {
  process.env.MERMAID_DATA_DIR = mkdtempSync(join(tmpdir(), 'mc-backoff-'));
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

describe('nudge backoff', () => {
  it('unchanged unseen set → NO re-nudge', async () => {
    addSubscription(P, 's1', 'project');
    const todos = [todo('a', { status: 'ready', kind: 'leaf' })];
    await runNotificationTick(P, deps(todos, 1000)); // seed
    const after = [todo('a', { status: 'done', kind: 'leaf' })];
    await runNotificationTick(P, deps(after, 2000)); // nudge @2000
    expect(nudges.length).toBe(1);
    // Same unseen set, past MIN_NUDGE_INTERVAL_MS but within backoff → no re-nudge
    await runNotificationTick(P, deps(after, 2000 + MIN_NUDGE_INTERVAL_MS + 1));
    expect(nudges.length).toBe(1);
  });

  it('increased count → nudge', async () => {
    addSubscription(P, 's1', 'project');
    const todos = [todo('a', { status: 'ready', kind: 'leaf' })];
    await runNotificationTick(P, deps(todos, 1000)); // seed
    const after1 = [todo('a', { status: 'done', kind: 'leaf' })];
    await runNotificationTick(P, deps(after1, 2000)); // nudge @2000
    expect(nudges.length).toBe(1);
    // Add a new todo (count grows) past the floor → nudge
    const after2 = [todo('a', { status: 'done', kind: 'leaf' }), todo('b', { status: 'blocked', kind: 'leaf' })];
    await runNotificationTick(P, deps(after2, 2000 + MIN_NUDGE_INTERVAL_MS + 1));
    expect(nudges.length).toBe(2);
  });

  it('drain-to-zero then a new event nudges again', async () => {
    addSubscription(P, 's1', 'project');
    const todos = [todo('a', { status: 'ready', kind: 'leaf' })];
    await runNotificationTick(P, deps(todos, 1000)); // seed
    const after = [todo('a', { status: 'done', kind: 'leaf' })];
    await runNotificationTick(P, deps(after, 2000)); // nudge @2000
    expect(nudges.length).toBe(1);
    // Drain the inbox (count→0)
    drainInbox(P, 's1');
    expect(pendingCount(P, 's1')).toBe(0);
    // Run a tick (count 0 → state reset, no nudge)
    await runNotificationTick(P, deps(after, 2000 + MIN_NUDGE_INTERVAL_MS + 1));
    expect(nudges.length).toBe(1);
    // New todo past the floor → fresh nudge fires
    const after2 = [todo('a', { status: 'done', kind: 'leaf' }), todo('b', { status: 'blocked', kind: 'leaf' })];
    await runNotificationTick(P, deps(after2, 2000 + MIN_NUDGE_INTERVAL_MS * 2 + 1));
    expect(nudges.length).toBe(2);
  });

  it('summaries carried in nudge text', async () => {
    addSubscription(P, 's1', 'project');
    const todos = [todo('a', { status: 'ready', kind: 'leaf' })];
    await runNotificationTick(P, deps(todos, 1000)); // seed
    const after = [todo('a', { status: 'done', kind: 'leaf' })];
    await runNotificationTick(P, deps(after, 2000)); // nudge @2000
    expect(nudges.length).toBe(1);
    expect(nudges[0].text).toMatch(/• .*done/);
  });
});
