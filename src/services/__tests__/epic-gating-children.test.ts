import { describe, it, expect } from 'bun:test';
import { epicGatingChildren } from '../coordinator-live';
import type { Todo } from '../todo-store';

describe('epicGatingChildren — single source of epic gating children', () => {
  const makeTodo = (overrides: Partial<Todo>): Todo => ({
    id: 'todo-' + Math.random().toString(36).slice(2),
    type: 'feature',
    kind: 'leaf',
    title: 'Test todo',
    description: '',
    assigneeKind: 'agent',
    status: 'planned',
    acceptanceStatus: 'pending',
    approvedAt: null,
    claimedAt: null,
    claimedBy: null,
    claimReason: null,
    completedAt: null,
    parentId: null,
    targetProject: null,
    dependsOn: [],
    labels: [],
    heldAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as unknown as Todo);

  it('includes [LAND]-kind children in buildChildren; landLeaves is always empty', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, landLeaf];
    buildChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = epicGatingChildren(allTodos, 'epic1', '/tracking/project');

    expect(result.buildChildren).toEqual([buildChild, landLeaf]);
    expect(result.landLeaves).toEqual([]);
  });

  it('excludes dropped children (including dropped [LAND]-kind rows) from buildChildren', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const droppedBuild = makeTodo({ id: 'dropped1', status: 'dropped' });
    const droppedLand = makeTodo({ id: 'dropped-land1', kind: 'land', status: 'dropped' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, droppedBuild, droppedLand];
    buildChild.parentId = 'epic1';
    droppedBuild.parentId = 'epic1';
    droppedLand.parentId = 'epic1';

    const result = epicGatingChildren(allTodos, 'epic1', '/tracking/project');

    expect(result.buildChildren).toEqual([buildChild]);
    expect(result.landLeaves).toEqual([]);
  });

  it('includes multiple [LAND]-kind children in buildChildren; landLeaves stays empty', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf1 = makeTodo({ id: 'land1', kind: 'land', status: 'planned' });
    const landLeaf2 = makeTodo({ id: 'land2', kind: 'land', status: 'planned' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, landLeaf1, landLeaf2];
    buildChild.parentId = 'epic1';
    landLeaf1.parentId = 'epic1';
    landLeaf2.parentId = 'epic1';

    const result = epicGatingChildren(allTodos, 'epic1', '/tracking/project');

    expect(result.buildChildren).toHaveLength(3);
    expect(result.buildChildren).toContainEqual(buildChild);
    expect(result.buildChildren).toContainEqual(landLeaf1);
    expect(result.buildChildren).toContainEqual(landLeaf2);
    expect(result.landLeaves).toEqual([]);
  });

  it('partitions buildChildren by targetProject into byRepo', () => {
    const buildChild1 = makeTodo({ id: 'build1', targetProject: '/repo/a', status: 'done', acceptanceStatus: 'accepted' });
    const buildChild2 = makeTodo({ id: 'build2', targetProject: '/repo/b', status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild1, buildChild2, landLeaf];
    buildChild1.parentId = 'epic1';
    buildChild2.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = epicGatingChildren(allTodos, 'epic1', '/tracking/project');

    expect(result.byRepo.get('/repo/a')).toEqual(['build1']);
    expect(result.byRepo.get('/repo/b')).toEqual(['build2']);
    // landLeaf has no targetProject; the epic is genuinely cross-repo (two explicit,
    // non-tracking repos), so it can't be confidently placed.
    expect(result.ambiguous).toEqual(['land1']);
  });

  it('assigns repo-less buildChildren (including [LAND]-kind rows) to trackingProject in single-repo epic', () => {
    const buildChild = makeTodo({ id: 'build1', targetProject: null, status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, landLeaf];
    buildChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = epicGatingChildren(allTodos, 'epic1', '/tracking/project');

    expect(result.byRepo.get('/tracking/project')).toEqual(['build1', 'land1']);
    expect(result.ambiguous).toEqual([]);
  });

  it('marks repo-less buildChildren (including [LAND]-kind rows) as ambiguous in cross-repo epic', () => {
    const buildChildExplicitRepo = makeTodo({ id: 'build1', targetProject: '/repo/a', status: 'done', acceptanceStatus: 'accepted' });
    const buildChildRepoLess = makeTodo({ id: 'build2', targetProject: null, status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChildExplicitRepo, buildChildRepoLess, landLeaf];
    buildChildExplicitRepo.parentId = 'epic1';
    buildChildRepoLess.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = epicGatingChildren(allTodos, 'epic1', '/tracking/project');

    expect(result.byRepo.get('/repo/a')).toEqual(['build1']);
    expect(result.ambiguous).toEqual(['build2', 'land1']);
  });
});
