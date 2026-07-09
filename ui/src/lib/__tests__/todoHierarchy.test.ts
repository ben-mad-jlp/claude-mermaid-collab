import { describe, it, expect } from 'vitest';
import {
  type IdentifiedKindBearing,
  type TodoKind,
  MissingKindError,
} from '../todoKind';
import {
  buildTodoHierarchy,
  parentEpicOf,
  hasSubtasks,
  descendantsOf,
} from '../todoHierarchy';

/** Fixture builder: mk(id, kind, parentId?) */
const mk = (id: string, kind: TodoKind, parentId?: string): IdentifiedKindBearing => ({
  id,
  kind,
  parentId: parentId ?? null,
});

describe('todoHierarchy', () => {
  it('case 1: split leaf (epic E → leaf L → 3 children of L)', () => {
    const E = mk('E', 'epic');
    const L = mk('L', 'leaf', 'E');
    const C1 = mk('C1', 'leaf', 'L');
    const C2 = mk('C2', 'leaf', 'L');
    const C3 = mk('C3', 'leaf', 'L');

    const h = buildTodoHierarchy([E, L, C1, C2, C3]);

    expect(h.epicIds).toEqual(new Set(['E']));
    expect(h.childrenByEpic.get('E')).toEqual([L]);
    expect(h.subtasksByParent.get('L')).toEqual([C1, C2, C3]);
    expect(h.orphans).toEqual([]);

    expect(hasSubtasks(L, h)).toBe(true);
    expect(hasSubtasks(E, h)).toBe(false);
    expect(hasSubtasks(C1, h)).toBe(false);

    expect(parentEpicOf(L, h)).toBe('E');
    expect(parentEpicOf(C1, h)).toBeNull();
    expect(parentEpicOf(C2, h)).toBeNull();
    expect(parentEpicOf(C3, h)).toBeNull();
  });

  it('case 2: childless epic', () => {
    const E = mk('E', 'epic');

    const h = buildTodoHierarchy([E]);

    expect(h.epicIds).toEqual(new Set(['E']));
    expect(h.childrenByEpic.get('E')).toEqual([]);
    expect(h.childrenByEpic.has('E')).toBe(true);
    expect(h.subtasksByParent.size).toBe(0);
    expect(h.orphans).toEqual([]);
  });

  it('case 3: top-level leaf with no parent', () => {
    const L = mk('L', 'leaf');

    const h = buildTodoHierarchy([L]);

    expect(h.epicIds.size).toBe(0);
    expect(h.childrenByEpic.size).toBe(0);
    expect(h.subtasksByParent.size).toBe(0);
    expect(h.orphans).toEqual([L]);
  });

  it('case 4: land child of epic', () => {
    const E = mk('E', 'epic');
    const LAND = mk('LAND', 'land', 'E');

    const h = buildTodoHierarchy([E, LAND]);

    expect(h.epicIds).toEqual(new Set(['E']));
    expect(h.childrenByEpic.get('E')).toEqual([LAND]);
    expect(h.subtasksByParent.size).toBe(0);
    expect(h.orphans).toEqual([]);
    expect(hasSubtasks(LAND, h)).toBe(false);
    expect(parentEpicOf(LAND, h)).toBe('E');
  });

  it('case 5: dangling parentId (parent not in input)', () => {
    const L = mk('L', 'leaf', 'missing-parent');

    const h = buildTodoHierarchy([L]);

    expect(h.epicIds.size).toBe(0);
    expect(h.childrenByEpic.size).toBe(0);
    expect(h.subtasksByParent.size).toBe(0);
    expect(h.orphans).toEqual([L]);
  });

  it('case 6: missing kind throws MissingKindError', () => {
    const noKind: IdentifiedKindBearing = {
      id: 'test',
      kind: undefined,
    };

    expect(() => buildTodoHierarchy([noKind])).toThrow(MissingKindError);
  });

  it('case 7: descendantsOf is cycle-safe', () => {
    // Create a cycle: A.parentId = B, B.parentId = A
    // Both become subtasks of each other via the cycle, but descendantsOf should
    // not infinite loop due to the seen-set.
    const A: IdentifiedKindBearing = {
      id: 'A',
      kind: 'leaf',
      parentId: 'B',
    };
    const B: IdentifiedKindBearing = {
      id: 'B',
      kind: 'leaf',
      parentId: 'A',
    };

    const h = buildTodoHierarchy([A, B]);
    const descendants = descendantsOf('A', h);

    // Should not infinite loop. Traversal visits both items via the cycle but
    // the seen-set prevents infinite recursion.
    expect(descendants.length).toBe(2);
    expect(descendants[0].id).toBe('B');
    expect(descendants[1].id).toBe('A');
  });

  it('descendantsOf returns transitive descendants in pre-order', () => {
    const E1 = mk('E1', 'epic');
    const E2 = mk('E2', 'epic', 'E1');
    const L1 = mk('L1', 'leaf', 'E2');
    const L2 = mk('L2', 'leaf', 'L1');
    const L3 = mk('L3', 'leaf', 'L1');

    const h = buildTodoHierarchy([E1, E2, L1, L2, L3]);

    const descendants = descendantsOf('E1', h);

    // Pre-order: E1's children first, then each child's descendants
    // E1 → [E2]
    // E2 → [L1]
    // L1 → [L2, L3] (subtasks)
    expect(descendants.map(d => d.id)).toEqual(['E2', 'L1', 'L2', 'L3']);
  });

  it('descendantsOf returns empty for leaf with no children', () => {
    const L = mk('L', 'leaf');

    const h = buildTodoHierarchy([L]);
    const descendants = descendantsOf('L', h);

    expect(descendants).toEqual([]);
  });

  it('preserves input order', () => {
    const todos = [
      mk('A', 'epic'),
      mk('B', 'leaf', 'A'),
      mk('C', 'leaf', 'A'),
      mk('D', 'leaf', 'A'),
    ];

    const h = buildTodoHierarchy(todos);

    expect(h.childrenByEpic.get('A')).toEqual([todos[1], todos[2], todos[3]]);
  });

  it('multiple epics each get an empty lane initially', () => {
    const E1 = mk('E1', 'epic');
    const E2 = mk('E2', 'epic');
    const E3 = mk('E3', 'epic');

    const h = buildTodoHierarchy([E1, E2, E3]);

    expect(h.childrenByEpic.get('E1')).toEqual([]);
    expect(h.childrenByEpic.get('E2')).toEqual([]);
    expect(h.childrenByEpic.get('E3')).toEqual([]);
    expect(h.orphans).toEqual([]);
  });

  it('split leaf with multiple levels of subtasks', () => {
    const E = mk('E', 'epic');
    const L = mk('L', 'leaf', 'E');
    const S1 = mk('S1', 'leaf', 'L');
    const S2 = mk('S2', 'land', 'L');
    const S2a = mk('S2a', 'leaf', 'S2');
    const S2b = mk('S2b', 'leaf', 'S2');

    const h = buildTodoHierarchy([E, L, S1, S2, S2a, S2b]);

    expect(h.epicIds).toEqual(new Set(['E']));
    expect(h.childrenByEpic.get('E')).toEqual([L]);
    expect(h.subtasksByParent.get('L')).toEqual([S1, S2]);
    expect(h.subtasksByParent.get('S2')).toEqual([S2a, S2b]);
    expect(h.orphans).toEqual([]);
  });

  it('mixed epics and orphans', () => {
    const E1 = mk('E1', 'epic');
    const E1c1 = mk('E1c1', 'leaf', 'E1');
    const E2 = mk('E2', 'epic');
    const orphan1 = mk('orphan1', 'leaf');
    const orphan2 = mk('orphan2', 'leaf');

    const h = buildTodoHierarchy([E1, E1c1, E2, orphan1, orphan2]);

    expect(h.epicIds).toEqual(new Set(['E1', 'E2']));
    expect(h.childrenByEpic.get('E1')).toEqual([E1c1]);
    expect(h.childrenByEpic.get('E2')).toEqual([]);
    expect(h.orphans).toEqual([orphan1, orphan2]);
  });

  it('epic with mission child (missions are not filtered)', () => {
    const E = mk('E', 'epic');
    const M = mk('M', 'mission', 'E');

    const h = buildTodoHierarchy([E, M]);

    expect(h.epicIds).toEqual(new Set(['E']));
    expect(h.childrenByEpic.get('E')).toEqual([M]);
    expect(parentEpicOf(M, h)).toBe('E');
  });
});
