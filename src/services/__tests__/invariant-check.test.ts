// Runs via `bun test` (uses bun:sqlite via checkInvariants path) — the pure
// findViolations tests need no DB.
import { describe, test, expect } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import { findViolations } from '../invariant-check';

let seq = 0;
function todo(partial: Partial<Todo> & { id?: string; title: string; status?: TodoStatus }): Todo {
  const status = partial.status ?? 'ready';
  return {
    ownerSession: 's',
    assigneeSession: null,
    assigneeKind: 'agent',
    description: null,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    retryCount: 0,
    completedBy: null,
    objectRef: null,
    decisionRef: null,
    claimProbe: null,
    ...partial,
    id: partial.id ?? `t${++seq}`,
    status,
    completed: status === 'done',
  };
}

describe('findViolations', () => {
  test('clean graph returns []', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] feature', status: 'todo' });
    const work = todo({ id: 'w1', title: 'do thing', parentId: 'e1' });
    const land = todo({ id: 'l1', title: '[LAND] feature → master', parentId: 'e1', dependsOn: ['w1'] });
    expect(findViolations([epic, work, land])).toEqual([]);
  });

  test('ACCEPTANCE: seeded orphan + LAND-less epic returns exactly those two', () => {
    // Orphan: a non-epic todo with no [EPIC] ancestor.
    const orphan = todo({ id: 'orph', title: 'floating work', parentId: null });
    // LAND-less epic: an [EPIC] with a child but no [LAND] leaf beneath it.
    const epic = todo({ id: 'e1', title: '[EPIC] no-land', status: 'todo' });
    const child = todo({ id: 'c1', title: 'child work', parentId: 'e1', dependsOn: [] });
    // A second, well-formed epic so we know the checker doesn't false-positive.
    const goodEpic = todo({ id: 'e2', title: '[EPIC] good', status: 'todo' });
    const goodWork = todo({ id: 'gw', title: 'gw', parentId: 'e2' });
    const goodLand = todo({ id: 'gl', title: '[LAND] good → master', parentId: 'e2', dependsOn: ['gw'] });

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
    const epic = todo({ id: 'e1', title: '[EPIC] nested', status: 'todo' });
    const sub = todo({ id: 's1', title: 'sub-area', parentId: 'e1' });
    const land = todo({ id: 'l1', title: '[LAND] nested → master', parentId: 's1' });
    expect(findViolations([epic, sub, land]).filter((x) => x.kind === 'stranded-epic')).toEqual([]);
  });

  test('epic still planned with a ready child is flagged', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'planned' });
    const child = todo({ id: 'c1', title: 'c', parentId: 'e1', status: 'ready' });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1' });
    const v = findViolations([epic, child, land]);
    expect(v.find((x) => x.kind === 'epic-planned-ready-child' && x.todoId === 'e1')).toBeTruthy();
  });

  test('broken dependsOn: missing and dropped targets', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'todo' });
    const dropped = todo({ id: 'd1', title: 'gone', parentId: 'e1', status: 'dropped' });
    const work = todo({ id: 'w1', title: 'w', parentId: 'e1', dependsOn: ['missing-id', 'd1'] });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1' });
    const v = findViolations([epic, dropped, work, land]).filter((x) => x.kind === 'broken-depends-on');
    expect(v).toHaveLength(2);
    expect(v.every((x) => x.todoId === 'w1')).toBe(true);
  });

  test('blocked-on-nothing: blocked with all deps done', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'todo' });
    const dep = todo({ id: 'd1', title: 'dep', parentId: 'e1', status: 'done' });
    const blocked = todo({ id: 'b1', title: 'b', parentId: 'e1', status: 'blocked', dependsOn: ['d1'] });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1' });
    const v = findViolations([epic, dep, blocked, land]);
    expect(v.find((x) => x.kind === 'blocked-on-nothing' && x.todoId === 'b1')).toBeTruthy();
  });

  test('blocked with an unfinished dep is NOT blocked-on-nothing', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] x', status: 'todo' });
    const dep = todo({ id: 'd1', title: 'dep', parentId: 'e1', status: 'in_progress' });
    const blocked = todo({ id: 'b1', title: 'b', parentId: 'e1', status: 'blocked', dependsOn: ['d1'] });
    const land = todo({ id: 'l1', title: '[LAND] x → master', parentId: 'e1' });
    expect(findViolations([epic, dep, blocked, land]).filter((x) => x.kind === 'blocked-on-nothing')).toEqual([]);
  });

  test('done/dropped todos are not flagged as orphans', () => {
    const doneOrphan = todo({ id: 'o1', title: 'old', status: 'done' });
    const droppedOrphan = todo({ id: 'o2', title: 'scrapped', status: 'dropped' });
    expect(findViolations([doneOrphan, droppedOrphan])).toEqual([]);
  });
});
