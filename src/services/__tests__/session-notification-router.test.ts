import { describe, it, expect } from 'bun:test';
import type { Todo } from '../todo-store.ts';
import type { Subscription } from '../session-subscriptions.ts';
import { snapshotTodos, diffTodos, planNotifications } from '../session-notification-router.ts';

const P = '/proj/a';
const todo = (id: string, over: Partial<Todo> = {}): Todo =>
  ({ id, title: `Todo ${id}`, status: 'planned', acceptanceStatus: null, parentId: null, dependsOn: [], kind: 'leaf', ...over } as unknown as Todo);
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
    const epic = todo('E', { kind: 'epic', title: '[EPIC] thing' });
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

  it('mission subscriber receives updates for NEW epic+leaf in iteration 2 (match-time resolution)', () => {
    const mission = todo('M', { kind: 'mission', title: 'Converge' } as Partial<Todo>);
    const epic1 = todo('E1', { kind: 'epic', parentId: 'M', title: '[EPIC] Iteration 1' } as Partial<Todo>);
    const leaf1 = todo('L1', { kind: 'leaf', parentId: 'E1', status: 'planned', title: 'Leaf 1' } as Partial<Todo>);
    const prev = snapshotTodos([mission, epic1, leaf1]);

    // Iteration 2: add a NEW epic and leaf under the mission.
    const epic2 = todo('E2', { kind: 'epic', parentId: 'M', title: '[EPIC] Iteration 2' } as Partial<Todo>);
    const leaf2 = todo('L2', { kind: 'leaf', parentId: 'E2', status: 'planned', title: 'Leaf 2' } as Partial<Todo>);
    const changes = diffTodos(prev, [mission, epic1, leaf1, epic2, leaf2], P);
    expect(changes).toHaveLength(2); // E2:new, L2:new
    expect(changes[0].todoId).toBe('E2');
    expect(changes[0].missionId).toBe('M');
    expect(changes[1].todoId).toBe('L2');
    expect(changes[1].missionId).toBe('M');

    // Mission subscriber gets both notifications.
    const got = planNotifications(changes, [sub({ scope: 'mission', targetId: 'M' })]);
    expect(got).toHaveLength(2);
  });

  it('leaf status change under mission notifies the mission subscriber', () => {
    const mission = todo('M', { kind: 'mission', title: 'Converge' } as Partial<Todo>);
    const epic = todo('E', { kind: 'epic', parentId: 'M', title: '[EPIC] Do it' } as Partial<Todo>);
    const leafBefore = todo('L', { kind: 'leaf', parentId: 'E', status: 'planned', title: 'Do leaf' } as Partial<Todo>);
    const prev = snapshotTodos([mission, epic, leafBefore]);
    const leafAfter = todo('L', { kind: 'leaf', parentId: 'E', status: 'done', title: 'Do leaf' } as Partial<Todo>);
    const changes = diffTodos(prev, [mission, epic, leafAfter], P);
    expect(changes).toHaveLength(1);
    expect(changes[0].missionId).toBe('M');

    const got = planNotifications(changes, [sub({ scope: 'mission', targetId: 'M' })]);
    expect(got).toHaveLength(1);
  });

  it('leaf outside a mission does not match a mission subscription', () => {
    const mission = todo('M', { kind: 'mission', title: 'Converge' } as Partial<Todo>);
    const topLevelEpic = todo('E', { kind: 'epic', title: '[EPIC] Top-level' } as Partial<Todo>);
    const leaf = todo('L', { kind: 'leaf', parentId: 'E', status: 'planned', title: 'Leaf' } as Partial<Todo>);
    const prev = snapshotTodos([mission, topLevelEpic, leaf]);
    const leafDone = todo('L', { kind: 'leaf', parentId: 'E', status: 'done', title: 'Leaf' } as Partial<Todo>);
    const changes = diffTodos(prev, [mission, topLevelEpic, leafDone], P);
    expect(changes[0].missionId).toBe(null);

    const got = planNotifications(changes, [sub({ scope: 'mission', targetId: 'M' })]);
    expect(got).toHaveLength(0);
  });

  it('mission node change notifies its subscriber', () => {
    const missionBefore = todo('M', { kind: 'mission', title: 'Converge', status: 'planned' } as Partial<Todo>);
    const prev = snapshotTodos([missionBefore]);
    const missionAfter = todo('M', { kind: 'mission', title: 'Converge', status: 'in_progress' } as Partial<Todo>);
    const changes = diffTodos(prev, [missionAfter], P);
    expect(changes).toHaveLength(1);
    expect(changes[0].missionId).toBe('M');

    const got = planNotifications(changes, [sub({ scope: 'mission', targetId: 'M' })]);
    expect(got).toHaveLength(1);
  });

  it('resolveEpicId passes through a mission ancestor without stopping', () => {
    const mission = todo('M', { kind: 'mission', title: 'Converge' } as Partial<Todo>);
    const epic = todo('E', { kind: 'epic', parentId: 'M', title: '[EPIC] Do it' } as Partial<Todo>);
    const leaf = todo('L', { kind: 'leaf', parentId: 'E', status: 'planned', title: 'Leaf' } as Partial<Todo>);
    const prev = snapshotTodos([mission, epic, leaf]);
    const leafDone = todo('L', { kind: 'leaf', parentId: 'E', status: 'done', title: 'Leaf' } as Partial<Todo>);
    const changes = diffTodos(prev, [mission, epic, leafDone], P);
    expect(changes[0].epicId).toBe('E');
  });

  it('cycle guard: a→b, b→a terminates and returns null', () => {
    const todoA = todo('A', { kind: 'leaf', parentId: 'B', status: 'planned' } as Partial<Todo>);
    const todoB = todo('B', { kind: 'leaf', parentId: 'A', status: 'planned' } as Partial<Todo>);
    const prev = snapshotTodos([todoA, todoB]);
    const todoADone = todo('A', { kind: 'leaf', parentId: 'B', status: 'done' } as Partial<Todo>);
    const changes = diffTodos(prev, [todoADone, todoB], P);
    expect(changes).toHaveLength(1);
    expect(changes[0].epicId).toBe(null);
    expect(changes[0].missionId).toBe(null);
  });
});

describe('planNotifications', () => {
  const change = { project: P, todoId: 'L', epicId: 'E', missionId: null, event: 'todo_done' as const, summary: 'L done' };

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

  it('mission subscription matches the resolved mission id', () => {
    const missionChange = { ...change, missionId: 'M' };
    const subs = [
      sub({ session: 'a', scope: 'mission', targetId: 'M' }),
      sub({ session: 'b', scope: 'mission', targetId: 'OTHER' }),
    ];
    const got = planNotifications([missionChange], subs).map((n) => n.session);
    expect(got).toEqual(['a']);
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
