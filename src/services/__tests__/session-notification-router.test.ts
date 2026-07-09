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

  it('no change → nothing for the unchanged todo; a brand-new todo emits todo_new', () => {
    const prev = snapshotTodos([todo('a', { status: 'ready' })]);
    const changes = diffTodos(prev, [todo('a', { status: 'ready' }), todo('NEW', { status: 'blocked' })], P);
    expect(changes.map((c) => `${c.todoId}:${c.event}`)).toEqual(['NEW:todo_new']);
  });

  it('emits on ANY status transition (started / ready / generic), not just terminal ones', () => {
    const prev = snapshotTodos([
      todo('a', { status: 'ready' }),
      todo('b', { status: 'planned' }),
      todo('c', { status: 'in_progress' }),
    ]);
    const changes = diffTodos(prev, [
      todo('a', { status: 'in_progress' }), // claimed/started
      todo('b', { status: 'ready' }),       // promoted to ready
      todo('c', { status: 'planned' }),     // reset → generic 'todo_updated'
    ], P);
    expect(changes.map((c) => `${c.todoId}:${c.event}`).sort()).toEqual(['a:todo_started', 'b:todo_ready', 'c:todo_updated']);
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

  it('resolves a grandchild leaf under a mission-parented epic to the EPIC', () => {
    const mission = todo('M', { kind: 'mission', title: 'Converge' } as Partial<Todo>);
    const epic = todo('E', { kind: 'epic', parentId: 'M', title: 'Do the thing' } as Partial<Todo>);
    const prev = snapshotTodos([mission, epic]);
    const leaf = todo('L', { kind: 'leaf', parentId: 'E', status: 'planned', title: 'Do the leaf' } as Partial<Todo>);
    const changes = diffTodos(prev, [mission, epic, leaf], P);
    expect(changes).toHaveLength(1);
    expect(changes[0].todoId).toBe('L');
    expect(changes[0].epicId).toBe('E');
  });

  it('an epic-scoped subscription fires for a grandchild leaf status change', () => {
    const mission = todo('M', { kind: 'mission', title: 'Converge' } as Partial<Todo>);
    const epic = todo('E', { kind: 'epic', parentId: 'M', title: 'Do the thing' } as Partial<Todo>);
    const leafBefore = todo('L', { kind: 'leaf', parentId: 'E', status: 'planned', title: 'Do the leaf' } as Partial<Todo>);
    const prev = snapshotTodos([mission, epic, leafBefore]);
    const leafAfter = todo('L', { kind: 'leaf', parentId: 'E', status: 'done', title: 'Do the leaf' } as Partial<Todo>);
    const changes = diffTodos(prev, [mission, epic, leafAfter], P);
    const got = planNotifications(changes, [sub({ scope: 'epic', targetId: 'E' })]);
    expect(got).toHaveLength(1);
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
