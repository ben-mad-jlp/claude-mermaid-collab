// Runs via `bun test` (uses bun:sqlite via checkInvariants path) — the pure
// findViolations tests need no DB.

// Isolate the global supervisor.db BEFORE any store module is imported.
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-invariant-check-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { Todo, TodoStatus } from '../todo-store';
import { findViolations, findLandedAtDivergence, checkInvariants } from '../invariant-check';
import { mkTodo, mkLegacyTodo } from './fixtures/mk-todo';
import { MissingKindError } from '../todo-kind';
import { createTodo, openDb, stampEpicLandedAt, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

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

  test('ACCEPTANCE: seeded orphan + LAND-less epic returns exactly those two (plus phantom-open-epic)', () => {
    // Orphan: a non-epic todo with no [EPIC] ancestor.
    const orphan = todo({ id: 'orph', title: 'floating work', parentId: null, kind: 'leaf' });
    // Stranded epic (W5 cutover redefinition): an [EPIC] whose non-dropped children are all
    // done+accepted — it LOOKS done — but landedAt is null, so it never actually landed.
    const epic = todo({ id: 'e1', title: '[EPIC] no-land', status: 'todo', kind: 'epic' });
    const child = todo({ id: 'c1', title: 'child work', parentId: 'e1', dependsOn: [], kind: 'leaf', status: 'done', acceptanceStatus: 'accepted' });
    // A second, well-formed epic so we know the checker doesn't false-positive.
    const goodEpic = todo({ id: 'e2', title: '[EPIC] good', status: 'todo', kind: 'epic' });
    const goodWork = todo({ id: 'gw', title: 'gw', parentId: 'e2', kind: 'leaf' });
    const goodLand = todo({ id: 'gl', title: '[LAND] good → master', parentId: 'e2', dependsOn: ['gw'], kind: 'land' });

    const v = findViolations([orphan, epic, child, goodEpic, goodWork, goodLand]);
    const orphans = v.filter((x) => x.kind === 'orphan');
    const stranded = v.filter((x) => x.kind === 'stranded-epic');
    const phantomOpen = v.filter((x) => x.kind === 'phantom-open-epic');

    expect(orphans).toHaveLength(1);
    expect(orphans[0].todoId).toBe('orph');
    expect(stranded).toHaveLength(1);
    expect(stranded[0].todoId).toBe('e1');
    // phantom-open-epic fires on e1 (non-terminal, non-mission epic with all-terminal children)
    expect(phantomOpen).toHaveLength(1);
    expect(phantomOpen[0].todoId).toBe('e1');
    // child of the LAND-less epic has an epic ancestor → NOT an orphan.
    expect(v.find((x) => x.todoId === 'c1')).toBeUndefined();
    // three violations total: orphan + stranded-epic + phantom-open-epic
    expect(v).toHaveLength(3);
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

  test('transitive: dropped epic -> dropped intermediate -> planned grandchild yields live-child-under-terminal-epic', () => {
    // Shape A: dropped epic → dropped intermediate epic/leaf child → 'planned' grandchild
    const topEpic = todo({ id: 'e1', title: '[EPIC] top', status: 'dropped', kind: 'epic' });
    const midEpic = todo({ id: 'e2', title: '[EPIC] mid', parentId: 'e1', status: 'dropped', kind: 'epic' });
    const grandchild = todo({ id: 'c1', title: 'planned grandchild', parentId: 'e2', status: 'planned', kind: 'leaf' });

    const v = findViolations([topEpic, midEpic, grandchild]);
    const violations = v.filter((x) => x.kind === 'live-child-under-terminal-epic');
    expect(violations).toHaveLength(1);
    expect(violations[0].todoId).toBe('c1');
    // Nearest terminal ancestor is e2 (the immediate parent is dropped)
    expect(violations[0].reason).toContain('e2');
  });

  test('transitive: mutation probe — flip intermediate ancestor to non-terminal -> no live-child-under-terminal-epic', () => {
    const topEpic = todo({ id: 'e1', title: '[EPIC] top', status: 'dropped', kind: 'epic' });
    const midEpic = todo({ id: 'e2', title: '[EPIC] mid', parentId: 'e1', status: 'planned', kind: 'epic' }); // FLIPPED to planned
    const grandchild = todo({ id: 'c1', title: 'planned grandchild', parentId: 'e2', status: 'planned', kind: 'leaf' });

    const v = findViolations([topEpic, midEpic, grandchild]);
    const violations = v.filter((x) => x.kind === 'live-child-under-terminal-epic' && x.todoId === 'c1');
    // midEpic is now 'planned' (not terminal), topEpic is 'dropped' (terminal but not immediate parent)
    // grandchild walks up: e2 (planned, not terminal) → e1 (dropped, terminal)
    // So e1 becomes the nearest terminal ancestor
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain('e1');
  });

  test('mission-parented: dropped mission with a live planned epic child yields live-child-under-terminal-epic', () => {
    // Shape B: dropped mission → live 'planned' epic child
    const mission = todo({ id: 'm1', title: '[MISSION] m', status: 'dropped', kind: 'mission' });
    const epic = todo({ id: 'e1', title: '[EPIC] child', parentId: 'm1', status: 'planned', kind: 'epic' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', kind: 'leaf' });

    const v = findViolations([mission, epic, work]);
    const violations = v.filter((x) => x.kind === 'live-child-under-terminal-epic');
    // Both e1 and w1 have the dropped mission as a terminal ancestor
    expect(violations).toHaveLength(2);
    const e1Violation = violations.find((x) => x.todoId === 'e1');
    expect(e1Violation).toBeDefined();
    expect(e1Violation!.reason).toContain('m1');
    expect(e1Violation!.reason).toContain('mission');
  });

  test('mission-parented: mutation probe — flip mission to non-terminal -> no live-child-under-terminal-epic', () => {
    const mission = todo({ id: 'm1', title: '[MISSION] m', status: 'planned', kind: 'mission' }); // FLIPPED to planned
    const epic = todo({ id: 'e1', title: '[EPIC] child', parentId: 'm1', status: 'planned', kind: 'epic' });
    const work = todo({ id: 'w1', title: 'work', parentId: 'e1', kind: 'leaf' });

    const v = findViolations([mission, epic, work]);
    const violations = v.filter((x) => x.kind === 'live-child-under-terminal-epic');
    // No terminal ancestors now (mission is 'planned')
    expect(violations).toHaveLength(0);
  });

  test('phantom-open: non-terminal epic whose children are all dropped/done yields phantom-open-epic', () => {
    // Shape C: non-terminal, non-mission epic with all children done/dropped
    const epic = todo({ id: 'e1', title: '[EPIC] phantom', status: 'planned', kind: 'epic' });
    const child1 = todo({ id: 'c1', title: 'done child', parentId: 'e1', status: 'done', kind: 'leaf' });
    const child2 = todo({ id: 'c2', title: 'dropped child', parentId: 'e1', status: 'dropped', kind: 'leaf' });

    const v = findViolations([epic, child1, child2]);
    const violations = v.filter((x) => x.kind === 'phantom-open-epic');
    expect(violations).toHaveLength(1);
    expect(violations[0].todoId).toBe('e1');
    expect(violations[0].reason).toContain('all 2 child(ren) are terminal');
  });

  test('phantom-open: mutation probe — give the epic one additional live child -> no phantom-open-epic', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] phantom', status: 'planned', kind: 'epic' });
    const child1 = todo({ id: 'c1', title: 'done child', parentId: 'e1', status: 'done', kind: 'leaf' });
    const child2 = todo({ id: 'c2', title: 'dropped child', parentId: 'e1', status: 'dropped', kind: 'leaf' });
    const child3 = todo({ id: 'c3', title: 'live child', parentId: 'e1', status: 'planned', kind: 'leaf' }); // ADDED live child

    const v = findViolations([epic, child1, child2, child3]);
    const violations = v.filter((x) => x.kind === 'phantom-open-epic');
    expect(violations).toHaveLength(0);
  });

  test('phantom-open: zero-children epic is exempt (no violation)', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] empty', status: 'planned', kind: 'epic' });
    // No children

    const v = findViolations([epic]);
    const violations = v.filter((x) => x.kind === 'phantom-open-epic');
    expect(violations).toHaveLength(0);
  });
});

describe('stranded-leaf', () => {
  function landedEpicFixture(extraChildStatus: Omit<Partial<Todo>, 'kind'> = { status: 'planned' }) {
    const epic = todo({ id: 'e1', title: '[EPIC] shipped', status: 'todo', landedAt: '2026-01-01T00:00:00Z', kind: 'epic' });
    const done1 = todo({ id: 'c1', title: 'done1', parentId: 'e1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' });
    const done2 = todo({ id: 'c2', title: 'done2', parentId: 'e1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' });
    const done3 = todo({ id: 'c3', title: 'done3', parentId: 'e1', status: 'done', acceptanceStatus: 'accepted', kind: 'leaf' });
    const stray = todo({ id: 'c4', title: 'stray', parentId: 'e1', kind: 'leaf', ...extraChildStatus });
    return { epic, done1, done2, done3, stray };
  }

  test('(a) landed epic with a planned child yields exactly one stranded-leaf on that child', () => {
    const { epic, done1, done2, done3, stray } = landedEpicFixture({ status: 'planned' });
    const v = findViolations([epic, done1, done2, done3, stray]).filter((x) => x.kind === 'stranded-leaf');
    expect(v).toHaveLength(1);
    expect(v[0].todoId).toBe('c4');
    expect(v[0].title).toBe('stray');
  });

  test('(b) landed epic with a dropped stray child yields no stranded-leaf', () => {
    const { epic, done1, done2, done3, stray } = landedEpicFixture({ status: 'dropped' });
    const v = findViolations([epic, done1, done2, done3, stray]).filter((x) => x.kind === 'stranded-leaf');
    expect(v).toHaveLength(0);
  });

  test('(c) landed epic with all four children done+accepted yields no stranded-leaf', () => {
    const { epic, done1, done2, done3, stray } = landedEpicFixture({ status: 'done', acceptanceStatus: 'accepted' });
    const v = findViolations([epic, done1, done2, done3, stray]).filter((x) => x.kind === 'stranded-leaf');
    expect(v).toHaveLength(0);
  });

  test('(d) unlanded epic with a planned child yields no stranded-leaf (but stranded-epic does not fire either, since not all children are done+accepted)', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] not shipped', status: 'todo', kind: 'epic' });
    const child = todo({ id: 'c1', title: 'planned child', parentId: 'e1', status: 'planned', kind: 'leaf' });
    const v = findViolations([epic, child]);
    expect(v.filter((x) => x.kind === 'stranded-leaf')).toHaveLength(0);
    expect(v.filter((x) => x.kind === 'stranded-epic')).toHaveLength(0);
    expect(v.filter((x) => x.kind === 'live-child-under-terminal-epic')).toHaveLength(0);
  });

  test('(e) coexistence pin: stranded-leaf and live-child-under-terminal-epic both fire for the same planned child of a landed epic', () => {
    const { epic, done1, done2, done3, stray } = landedEpicFixture({ status: 'planned' });
    const v = findViolations([epic, done1, done2, done3, stray]);
    const strandedLeaf = v.filter((x) => x.kind === 'stranded-leaf' && x.todoId === 'c4');
    const liveChild = v.filter((x) => x.kind === 'live-child-under-terminal-epic' && x.todoId === 'c4');
    expect(strandedLeaf).toHaveLength(1);
    expect(liveChild).toHaveLength(1);
  });
});

describe('findLandedAtDivergence', () => {
  test('landed-satisfies: landedAt set, no [LAND] child, ahead=0 → []', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] shipped', status: 'done', kind: 'epic', landedAt: '2026-07-20T00:00:00Z' });
    const aheadOf = (epicId: string) => (epicId === 'e1' ? 0 : undefined);
    expect(findLandedAtDivergence([epic], aheadOf)).toEqual([]);
  });

  test('stranded-still-violates: landedAt set, no [LAND] child, ahead=3 → one violation', () => {
    const epic = todo({ id: 'e1', title: '[EPIC] stranded', status: 'done', kind: 'epic', landedAt: '2026-07-20T00:00:00Z' });
    const aheadOf = (epicId: string) => (epicId === 'e1' ? 3 : undefined);
    const v = findLandedAtDivergence([epic], aheadOf);
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe('landed-at-divergence');
    expect(v[0].todoId).toBe('e1');
  });
});

describe('checkInvariants (DB-backed)', () => {
  const todoBase = mkdtempSync(join(tmpdir(), 'invariant-check-todos-'));
  let projectCounter = 0;
  function freshProject(): string {
    const p = join(todoBase, `proj-${++projectCounter}`);
    mkdirSync(join(p, '.collab'), { recursive: true });
    return p;
  }

  beforeAll(() => { _closeSupervisorDb(); });
  afterAll(() => {
    _closeSupervisorDb();
    rmSync(supervisorDir, { recursive: true, force: true });
    rmSync(todoBase, { recursive: true, force: true });
    delete process.env.MERMAID_SUPERVISOR_DIR;
  });

  test('checkInvariants: landed epic with one non-terminal child yields exactly one stranded-leaf violation naming that child', async () => {
    const project = freshProject();
    try {
      const epic = await createTodo(project, {
        ownerSession: 'test',
        title: '[EPIC] DB-backed stranded-leaf',
        kind: 'epic',
      });
      const child = await createTodo(project, {
        ownerSession: 'test',
        title: 'live child',
        kind: 'leaf',
        parentId: epic.id,
      });

      const stamped = stampEpicLandedAt(project, epic.id, '2026-01-01T00:00:00Z');
      expect(stamped).toBe(true);
      _closeProject(project);

      const violations = await checkInvariants(project);
      const stranded = violations.filter((v) => v.kind === 'stranded-leaf');
      expect(stranded).toHaveLength(1);
      expect(stranded[0]!.todoId).toBe(child.id);
    } finally {
      _closeProject(project);
    }
  });

  test('checkInvariants: landed epic whose only child is done+accepted yields no stranded-leaf violation', async () => {
    const project = freshProject();
    try {
      const epic = await createTodo(project, {
        ownerSession: 'test',
        title: '[EPIC] DB-backed no-strand',
        kind: 'epic',
      });
      const child = await createTodo(project, {
        ownerSession: 'test',
        title: 'settled child',
        kind: 'leaf',
        parentId: epic.id,
      });

      const db = openDb(project);
      db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
        .run('done', 'accepted', child.id);

      const stamped = stampEpicLandedAt(project, epic.id, '2026-01-01T00:00:00Z');
      expect(stamped).toBe(true);
      _closeProject(project);

      const violations = await checkInvariants(project);
      const stranded = violations.filter((v) => v.kind === 'stranded-leaf');
      expect(stranded).toHaveLength(0);
    } finally {
      _closeProject(project);
    }
  });

  test('checkInvariants: project with a phantom-open epic returns a non-empty phantom-open-epic violation', async () => {
    const project = freshProject();
    try {
      const epic = await createTodo(project, {
        ownerSession: 'test',
        title: '[EPIC] phantom-open-test',
        kind: 'epic',
      });
      const child1 = await createTodo(project, {
        ownerSession: 'test',
        title: 'done child',
        kind: 'leaf',
        parentId: epic.id,
      });
      const child2 = await createTodo(project, {
        ownerSession: 'test',
        title: 'dropped child',
        kind: 'leaf',
        parentId: epic.id,
      });

      const db = openDb(project);
      // Mark child1 done
      db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
        .run('done', 'accepted', child1.id);
      // Mark child2 dropped
      db.prepare('UPDATE todos SET status = ? WHERE id = ?')
        .run('dropped', child2.id);

      _closeProject(project);

      const violations = await checkInvariants(project);
      const phantomOpen = violations.filter((v) => v.kind === 'phantom-open-epic');
      expect(phantomOpen.length > 0).toBe(true);
      expect(phantomOpen[0].todoId).toBe(epic.id);
    } finally {
      _closeProject(project);
    }
  });
});
