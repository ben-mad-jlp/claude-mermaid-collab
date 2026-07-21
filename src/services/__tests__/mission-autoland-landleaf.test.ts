import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
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

  // Leafless model: land leaves are never minted (epicGatingChildren always returns
  // landLeaves: []), so landLeafId is always undefined and landedAt is the source of truth.
  // No test case constructs a kind:'land' child that gates promotion — such a child is just
  // an ordinary buildChildren entry now (see case 8, which documents the legacy-leaf case).

  it('returns promote:true for a build-green mission epic with no land-leaf child and no dependency blockers', () => {
    const buildChild1 = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const buildChild2 = makeTodo({ id: 'build2', status: 'done', acceptanceStatus: 'accepted' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild1, buildChild2];
    buildChild1.parentId = 'epic1';
    buildChild2.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.landLeafId).toBe(undefined);
    expect(result.buildChildIds).toEqual(['build1', 'build2']);
  });

  it('returns promote:false when a build child is open (planned)', () => {
    const buildChild1 = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const buildChild2 = makeTodo({ id: 'build2' }); // makeTodo default: planned / pending
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild1, buildChild2];
    buildChild1.parentId = 'epic1';
    buildChild2.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('build-not-green');
  });

  it('returns promote:false when a build child is done but not accepted', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'pending' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild];
    buildChild.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('build-not-green');
    expect(result.landLeafId).toBe(undefined);
  });

  it('returns promote:false when the epic is already landed (landedAt set)', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const epic = makeTodo({
      id: 'epic1',
      kind: 'epic',
      status: 'in_progress',
      landedAt: '2026-01-01T00:00:00.000Z',
    });

    const allTodos = [epic, buildChild];
    buildChild.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('epic-already-landed');
  });

  it('returns promote:false when epic is terminal (done)', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'done' });

    const allTodos = [epic, buildChild];
    buildChild.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('epic-terminal-or-held');
  });

  it('returns promote:false when epic has no build children', () => {
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic];

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(false);
    expect(result.reason).toBe('no-build-children');
  });

  it('filters out dropped children from consideration', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    const droppedChild = makeTodo({ id: 'dropped1', status: 'dropped', acceptanceStatus: 'pending' });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, droppedChild];
    buildChild.parentId = 'epic1';
    droppedChild.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(true);
    expect(result.buildChildIds).toEqual(['build1']);
  });

  it('still returns promote:true when a legacy kind:"land" child is present (land leaf is not excluded from buildChildren, but does not block promotion when done+accepted)', () => {
    const buildChild = makeTodo({ id: 'build1', status: 'done', acceptanceStatus: 'accepted' });
    // A stray legacy land leaf from before the cutover: epicGatingChildren no longer excludes
    // it by kind, so it is just an ordinary done+accepted buildChildren entry now. As long as it
    // is itself terminal/accepted it does not strand promotion.
    const legacyLandLeaf = makeTodo({
      id: 'land1',
      kind: 'land',
      status: 'done',
      acceptanceStatus: 'accepted',
    });
    const epic = makeTodo({ id: 'epic1', kind: 'epic', status: 'in_progress' });

    const allTodos = [epic, buildChild, legacyLandLeaf];
    buildChild.parentId = 'epic1';
    legacyLandLeaf.parentId = 'epic1';

    const result = missionLandLeafPromotion(allTodos, 'epic1');

    expect(result.promote).toBe(true);
    expect(result.buildChildIds).toContain('build1');
    expect(result.buildChildIds).toContain('land1');
  });
});

describe('autoLandArmedMissionEpics — continue-guard shape', () => {
  it('the armed continue-guard does not require decision.landLeafId', () => {
    // autoLandArmedMissionEpics MOVED to coordinator-land.ts (landing-subsystem extraction).
    const src = readFileSync(new URL('../coordinator-land.ts', import.meta.url), 'utf8');
    const guardLine = src.split('\n').find((l) => l.includes('if (!decision.promote'));
    expect(guardLine).toContain('if (!decision.promote) continue;');
    expect(guardLine).not.toContain('landLeafId');
  });
});
