import { describe, it, expect } from 'bun:test';
import type { Todo } from '../todo-store.ts';
import type { Subscription } from '../session-subscriptions.ts';
import { snapshotTodos, diffTodos, planNotifications } from '../session-notification-router.ts';

const P = '/proj/a';
const todo = (id: string, over: Partial<Todo> = {}): Todo =>
  ({ id, title: `Todo ${id}`, status: 'planned', acceptanceStatus: null, parentId: null, dependsOn: [], ...over } as unknown as Todo);
const sub = (over: Partial<Subscription>): Subscription =>
  ({ project: P, session: 's1', scope: 'project', targetId: '', mode: 'nudge', createdAt: 0, ...over });

describe('diffTodos', () => {
  it('seed pass (empty prev) emits nothing', () => {
    expect(diffTodos(new Map(), [todo('a')], P)).toEqual([]);
  });

  it('status → done / blocked / dropped each emit a notable change', () => {
    const prev = snapshotTodos([todo('a'), todo('b'), todo('c')]);
    const changes = diffTodos(prev, [
      todo('a', { status: 'done' }),
      todo('b', { status: 'blocked' }),
      todo('c', { status: 'dropped' }),
    ], P);
    expect(changes.map((c) => c.event).sort()).toEqual(['todo_blocked', 'todo_done', 'todo_dropped']);
  });

  it('acceptance change takes priority over status', () => {
    const prev = snapshotTodos([todo('a', { status: 'planned', acceptanceStatus: null })]);
    const changes = diffTodos(prev, [todo('a', { status: 'done', acceptanceStatus: 'accepted' })], P);
    expect(changes).toHaveLength(1);
    expect(changes[0].event).toBe('todo_accepted');
  });

  it('no change → nothing; a brand-new todo (no prev) is skipped', () => {
    const prev = snapshotTodos([todo('a', { status: 'ready' })]);
    const changes = diffTodos(prev, [todo('a', { status: 'ready' }), todo('NEW', { status: 'blocked' })], P);
    expect(changes).toEqual([]);
  });

  it('resolves the epic ancestor id by walking parentId', () => {
    const epic = todo('E', { title: '[EPIC] thing' });
    const leaf = todo('L', { parentId: 'E', status: 'planned' });
    const prev = snapshotTodos([epic, leaf]);
    const changes = diffTodos(prev, [epic, todo('L', { parentId: 'E', status: 'done' })], P);
    expect(changes).toHaveLength(1);
    expect(changes[0].epicId).toBe('E');
    expect(changes[0].todoId).toBe('L');
  });
});

describe('planNotifications', () => {
  const change = { project: P, todoId: 'L', epicId: 'E', event: 'todo_done' as const, summary: 'L done' };

  it('project subscription matches any change in the project', () => {
    const got = planNotifications([change], [sub({ scope: 'project' })]);
    expect(got).toHaveLength(1);
    expect(got[0].session).toBe('s1');
  });

  it('todo subscription matches only its id; epic subscription matches the resolved epic', () => {
    const subs = [
      sub({ session: 'a', scope: 'todo', targetId: 'L' }),
      sub({ session: 'b', scope: 'todo', targetId: 'OTHER' }),
      sub({ session: 'c', scope: 'epic', targetId: 'E' }),
      sub({ session: 'd', scope: 'epic', targetId: 'OTHER' }),
    ];
    const got = planNotifications([change], subs).map((n) => n.session).sort();
    expect(got).toEqual(['a', 'c']);
  });

  it('self-suppression: a session is not notified about a change it caused', () => {
    const subs = [sub({ session: 's1', scope: 'project' }), sub({ session: 's2', scope: 'project' })];
    const actor = new Map([['L', 's1']]);
    const got = planNotifications([change], subs, actor).map((n) => n.session);
    expect(got).toEqual(['s2']);
  });

  it('different project is never matched', () => {
    const got = planNotifications([{ ...change, project: '/proj/b' }], [sub({ scope: 'project' })]);
    expect(got).toEqual([]);
  });
});
