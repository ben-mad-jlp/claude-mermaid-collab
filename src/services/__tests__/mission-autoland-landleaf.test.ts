import { describe, it, expect } from 'bun:test';
import { missionLandLeafPromotion } from '../coordinator-live';
import type { Todo } from '../todo-store';

describe('missionLandLeafPromotion — land leaf promotion decision', () => {
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

  it('returns promote:true when epic has green build leaves and unapproved land leaf with no blocking deps', () => {
    const buildChild1 = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const buildChild2 = makeTodo({ id: 'build2', status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: ['build1', 'build2'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild1, buildChild2, landLeaf];
    buildChild1.parentId = 'epic1';
    buildChild2.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.landLeafId).toBe('land1');
    expect(result.buildChildIds).toEqual(['build1', 'build2']);
  });

  it('returns promote:false when land leaf is already done', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'done', acceptanceStatus: 'accepted', dependsOn: ['build1'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, landLeaf];
    buildChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('land-leaf-already-done');
    expect(result.landLeafId).toBe('land1');
  });

  it('returns promote:false when a build child is not done', () => {
    const buildChild1 = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const buildChild2 = makeTodo({ id: 'build2', status: 'planned', acceptanceStatus: 'pending' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: ['build1', 'build2'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild1, buildChild2, landLeaf];
    buildChild1.parentId = 'epic1';
    buildChild2.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('build-not-green');
    expect(result.landLeafId).toBe('land1');
  });

  it('returns promote:false when a build child is done but not accepted', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'pending' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: ['build1'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, landLeaf];
    buildChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('build-not-green');
    expect(result.landLeafId).toBe('land1');
  });

  it('returns promote:false when a land-leaf dependency is not done', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const landDep = makeTodo({ id: 'dep1', status: 'planned', acceptanceStatus: 'pending' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: ['build1', 'dep1'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, landDep, landLeaf];
    buildChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('land-deps-unsatisfied');
    expect(result.landLeafId).toBe('land1');
  });

  it('returns promote:false when epic is terminal (done)', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: ['build1'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'done' });

    const allTodos = [epic, buildChild, landLeaf];
    buildChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('epic-terminal-or-held');
  });

  it('returns promote:false when epic has no land leaf', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild];
    buildChild.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('no-land-leaf');
  });

  it('returns promote:false when epic has no build children (only land leaf)', () => {
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: [] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, landLeaf];
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('no-build-children');
  });

  it('filters out dropped children from consideration', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const droppedChild = makeTodo({ id: 'dropped1', status: 'dropped', acceptanceStatus: 'pending' });
    const landLeaf = makeTodo({ id: 'land1', kind: 'land', status: 'planned', dependsOn: ['build1'] });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, droppedChild, landLeaf];
    buildChild.parentId = 'epic1';
    droppedChild.parentId = 'epic1';
    landLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(true);
    expect(result.buildChildIds).toEqual(['build1']);
  });
});
