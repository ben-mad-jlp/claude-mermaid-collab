import { describe, test, expect } from 'bun:test';
import { criterionEdgesOf, todoServesCriterion } from '../criterion-edges';

describe('criterion-edges', () => {
  test('ids-only', () => {
    const todo = { servesCriterionIds: ['c1', 'c2'] };
    const edges = criterionEdgesOf(todo);
    expect(edges).toEqual(['c1', 'c2']);
    expect(todoServesCriterion(todo, 'c2')).toBe(true);
    expect(todoServesCriterion(todo, 'c9')).toBe(false);
  });

  test('singular-only', () => {
    const todo = { servesCriterionId: 'c1' };
    const edges = criterionEdgesOf(todo);
    expect(edges).toEqual(['c1']);
    expect(todoServesCriterion(todo, 'c1')).toBe(true);
    expect(todoServesCriterion(todo, 'c2')).toBe(false);
  });

  test('both set, different values — ids win', () => {
    const todo = { servesCriterionId: 'solo', servesCriterionIds: ['c1', 'c2'] };
    const edges = criterionEdgesOf(todo);
    expect(edges).toEqual(['c1', 'c2']);
    expect(edges).not.toContain('solo');
    expect(todoServesCriterion(todo, 'solo')).toBe(false);
  });

  test('neither', () => {
    // Case 1: both undefined
    const todo1 = {};
    const edges1 = criterionEdgesOf(todo1);
    expect(edges1).toEqual([]);
    expect(todoServesCriterion(todo1, 'anything')).toBe(false);

    // Case 2: both null
    const todo2 = { servesCriterionId: null, servesCriterionIds: null };
    const edges2 = criterionEdgesOf(todo2);
    expect(edges2).toEqual([]);
    expect(todoServesCriterion(todo2, 'anything')).toBe(false);

    // Case 3: ids empty array (falls through to absent singular)
    const todo3 = { servesCriterionIds: [] };
    const edges3 = criterionEdgesOf(todo3);
    expect(edges3).toEqual([]);
    expect(todoServesCriterion(todo3, 'anything')).toBe(false);
  });
});
