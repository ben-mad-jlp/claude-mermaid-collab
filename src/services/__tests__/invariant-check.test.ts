// Runs via `bun test` (uses bun:sqlite via checkInvariants path) — the pure
// findViolations tests need no DB.
import { describe, test, expect } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import { findViolations } from '../invariant-check';
import { mkTodo, mkLegacyTodo } from './fixtures/mk-todo';
import { MissingKindError } from '../todo-kind';

let seq = 0;
function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus; kind: string }): Todo {
  const status = partial.status ?? 'ready';
  return mkTodo({
    ...partial,
    id: partial.id ?? `t${++seq}`,
    status,
    completed: status === 'done',
    kind: partial.kind as any,
  });
}

describe('findViolations', () => {
  test('clean graph returns []', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] feature', status: 'todo', kind: 'epic' });
    const work = todo({ id: 'w1', title: 'do thing', parentId: 'e1', kind: 'leaf' });
    const land = todo({ id: 'l1', title: '[LAND] feature → master', parentId: 'e1', dependsOn: ['w1'], kind: 'land' });
    expect(findViolations([epic, work, land])).toEqual([]);
  });

  test('ACCEPTANCE: seeded orphan + LAND-less epic returns exactly those two', () => {
    // Orphan: a non-epic todo with no [EPIC] ancestor.
    const orphan = todo({ id: 'orph', title: 'floating work', parentId: null, kind: 'leaf' });
    // LAND-less epic: an [EPIC] with a child but no [LAND] leaf beneath it.
    const epic = todo({ id: 'e1', title: '[EPIC] no-land', status: 'todo', kind: 'epic' });
    const child = todo({ id: 'c1', title: 'child work', parentId: 'e1', dependsOn: [], kind: 'leaf' });
    // A second, well-formed epic so we know the checker doesn't false-positive.
    const goodEpic = todo({ id: 'e2', title: '[EPIC] good', status: 'todo', kind: 'epic' });
    const goodWork = todo({ id: 'gw', title: 'gw', parentId: 'e2', kind: 'leaf' });
    const goodLand = todo({ id: 'gl', title: '[LAND] good → master', parentId: 'e2', dependsOn: ['gw'], kind: 'land' });

    const v = findViolations([orphan, epic, child, goodEpic, goodWork, goodLand]);
    const orphans = v.filter((x) => x.kind === 'orphan');
    const stranded = v.filter((x) => x.kind === 'stranded-epic');

    expect(orphans).toHaveLength(1);
    expect(orphans[0].todoId).toBe('orph');
    expect(stranded).toHaveLength(1);
    expect(stranded[0].todoId).toBe('e1');
    // child of the LAND-less epic has an epic ancestor → NOT an orphan.
    expect(v.find((x) => x.todoId === 'c1')).toBeUndefined();
    // exactly two violations total.
    expect(v).toHaveLength(2);
  });

  test('land leaf may be a transitive (grandchild) descendant', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] nested', status: 'todo', kind: 'epic' });
    const sub = todo({ id: 's1', title: 'sub-area', parentId: 'e1', kind: 'leaf' });
    const land = todo({ id: 'l1', title: '[LAND] nested → master', parentId: 's1', kind: 'land' });
    expect(findViolations([epic, sub, land]).filter((x) => x.kind === 'stranded-epic')).toEqual([]);
  });

  test('epic-planned-ready-child: RETIRED — released epic with claimable child yields no violation', () => {
    // A released epic (approvedAt set, status still 'planned') with a claimable child.
    // The old check would have fired; it is now dead and must not appear.
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'planned', approvedAt: '2026-01-01T00:00:00Z', kind: 'epic' });
    const child = todo({ id: 'c1', title: 'c', parentId: 'e1', approvedAt: '2026-01-01T00:00:00Z', kind: 'leaf' });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1', kind: 'land' });
    const v = findViolations([epic, child, land]);
    // Retirement proof: a released epic with a claimable child produces no violations
    // (the old check would have fired here). The kind is no longer in the enum.
    expect(v).toEqual([]);
  });

  test('broken dependsOn: missing and dropped targets', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'todo', kind: 'epic' });
    const dropped = todo({ id: 'd1', title: 'gone', parentId: 'e1', status: 'dropped', kind: 'leaf' });
    const work = todo({ id: 'w1', title: 'w', parentId: 'e1', dependsOn: ['missing-id', 'd1'], kind: 'leaf' });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1', kind: 'land' });
    const v = findViolations([epic, dropped, work, land]).filter((x) => x.kind === 'broken-depends-on');
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.todoId === 'w1')).toBe(true);
  });

  test('S4: blocked-with-all-deps-done is NO LONGER flagged (check removed — readiness is derived)', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'todo', kind: 'epic' });
    const dep = todo({ id: 'd1', title: 'dep', parentId: 'e1', status: 'done', kind: 'leaf' });
    const blocked = todo({ id: 'b1', title: 'b', parentId: 'e1', status: 'blocked', dependsOn: ['d1'], kind: 'leaf' });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1', kind: 'land' });
    // 'blocked' is now legacy noise the predicate ignores; not an invariant violation.
    const v = findViolations([epic, dep, blocked, land]);
    expect(v.some((x) => x.todoId === 'b1')).toBe(false);
  });

  test('done/dropped todos are not flagged as orphans', () => {
    const doneOrphan = todo({ id: 'o1', title: 'old', status: 'done', kind: 'leaf' });
    const droppedOrphan = todo({ id: 'o2', title: 'scrapped', status: 'dropped', kind: 'leaf' });
    expect(findViolations([doneOrphan, droppedOrphan])).toEqual([]);
  });

  test('kind column wins without a title prefix (proves the switch happened)', () => {
    const epic = todo({ id: 'e1', title: 'Ship it', kind: 'epic', status: 'todo' });
    const child = todo({ id: 'c1', title: 'child work', parentId: 'e1', kind: 'leaf' });
    const land = todo({ id: 'l1', title: 'to master', kind: 'land', parentId: 'e1' });

    const withKind = findViolations([epic, child, land]);
    expect(withKind.find((x) => x.kind === 'stranded-epic')).toBeUndefined();
    expect(withKind.find((x) => x.kind === 'orphan')).toBeUndefined();
  });

  test('a pre-backfill legacy row has kind === null. `kindOf` is fail-closed by design (todo-kind.ts): reading one is a hard error, never a silent orphan.', () => {
    // A pre-backfill legacy row with kind === null. Every predicate reading it throws MissingKindError.
    const epicNoKind = mkLegacyTodo({ id: 'e2', title: 'Ship it', parentId: null, status: 'todo' });
    const childNoKind = mkLegacyTodo({ id: 'c2', title: 'child work', parentId: 'e2' });
    const landNoKind = mkLegacyTodo({ id: 'l2', title: 'to master', parentId: 'e2' });
    expect(() => findViolations([epicNoKind, childNoKind, landNoKind])).toThrow(MissingKindError);
  });
});
