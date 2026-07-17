/**
 * W3 bidirectional equivalence: an epic's `landedAt` is non-null IFF it has a done
 * [LAND] leaf child.
 *
 *   (a) Fixture-based pure test over 5 named shapes, mirroring findViolations's style
 *       (invariant-check.ts) — no DB.
 *   (b) Live-store sweep: creates the same 5 shapes for real via createTodo/completeTodo
 *       and asserts findLandedAtDivergence returns zero violations — proving the
 *       backfill (todo-store.ts openDb()) converges the live shape, not just fixtures.
 *
 * Mirrors the auto-land-stamp-after-merge.test.ts harness: isolate MERMAID_SUPERVISOR_DIR
 * before importing the store, use a temp dir as the project, _closeDb in lifecycle hooks.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-landed-at-equiv-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import type { Todo } from '../todo-store';
import { createTodo, completeTodo, listTodos, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { findLandedAtDivergence } from '../invariant-check';

const todoBase = mkdtempSync(join(tmpdir(), 'landed-at-equiv-todos-'));
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

// ─────────────────────────────────────────────────────────────────────────
// (a) Fixture-based pure test — hand-built Todo objects, no DB.
// ─────────────────────────────────────────────────────────────────────────

function baseTodo(overrides: Partial<Todo>): Todo {
  return {
    id: overrides.id ?? 'id',
    ownerSession: 'test',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: overrides.title ?? 'todo',
    status: overrides.status ?? 'planned',
    parentId: overrides.parentId ?? null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: overrides.completedAt ?? null,
    asanaGid: null,
    sessionName: null,
    executedBySession: null,
    blueprintId: null,
    type: null,
    kind: overrides.kind ?? 'leaf',
    targetProject: 'proj',
    acceptanceStatus: null,
    completedBy: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
    landedAt: overrides.landedAt ?? null,
    retryCount: 0,
    objectRef: null,
    servesCriterionId: null,
    servesCriterionIds: null,
    decisionRef: null,
    claimProbe: null,
    inheritedBlueprintFrom: null,
    inheritedFiles: null,
    isBucket: overrides.isBucket ?? false,
    bucketType: null,
    triageTag: null,
    promotedTo: null,
    tier: null,
    ...overrides,
  } as Todo;
}

describe('findLandedAtDivergence — fixture-based bidirectional equivalence', () => {
  it('landed mission epic: landedAt set + done land-leaf child → no divergence', () => {
    const mission = baseTodo({ id: 'mission', kind: 'mission', title: 'mission' });
    const epic = baseTodo({ id: 'epic-1', kind: 'epic', title: 'epic', parentId: 'mission', landedAt: '2026-01-02T00:00:00.000Z' });
    const land = baseTodo({ id: 'land-1', kind: 'land', title: 'land', parentId: 'epic-1', status: 'done', completedAt: '2026-01-02T00:00:00.000Z' });
    expect(findLandedAtDivergence([mission, epic, land])).toEqual([]);
  });

  it('landed root epic (no mission parent): landedAt set + done land-leaf child → no divergence', () => {
    const epic = baseTodo({ id: 'epic-2', kind: 'epic', title: 'epic', landedAt: '2026-01-02T00:00:00.000Z' });
    const land = baseTodo({ id: 'land-2', kind: 'land', title: 'land', parentId: 'epic-2', status: 'done', completedAt: '2026-01-02T00:00:00.000Z' });
    expect(findLandedAtDivergence([epic, land])).toEqual([]);
  });

  it('in-flight epic: no landedAt, land leaf not done → no divergence', () => {
    const epic = baseTodo({ id: 'epic-3', kind: 'epic', title: 'epic' });
    const land = baseTodo({ id: 'land-3', kind: 'land', title: 'land', parentId: 'epic-3', status: 'planned' });
    expect(findLandedAtDivergence([epic, land])).toEqual([]);
  });

  it('bucket epic: never lands, excluded (not flagged) even without landedAt', () => {
    const bucket = baseTodo({ id: 'bucket-1', kind: 'epic', title: 'bucket', isBucket: true });
    expect(findLandedAtDivergence([bucket])).toEqual([]);
  });

  it('epic with an INERT terminal land leaf that is NOT done → reads as "not landed", no divergence', () => {
    const epic = baseTodo({ id: 'epic-4', kind: 'epic', title: 'epic' });
    const land = baseTodo({ id: 'land-4', kind: 'land', title: 'land', parentId: 'epic-4', status: 'planned' });
    expect(findLandedAtDivergence([epic, land])).toEqual([]);
  });

  it('divergent: epic has done land-leaf child but landedAt is null → flagged', () => {
    const epic = baseTodo({ id: 'epic-5', kind: 'epic', title: 'epic' });
    const land = baseTodo({ id: 'land-5', kind: 'land', title: 'land', parentId: 'epic-5', status: 'done', completedAt: '2026-01-02T00:00:00.000Z' });
    const violations = findLandedAtDivergence([epic, land]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('landed-at-divergence');
    expect(violations[0].todoId).toBe('epic-5');
  });

  it('divergent: epic has landedAt set but no done land-leaf child → flagged', () => {
    const epic = baseTodo({ id: 'epic-6', kind: 'epic', title: 'epic', landedAt: '2026-01-02T00:00:00.000Z' });
    const land = baseTodo({ id: 'land-6', kind: 'land', title: 'land', parentId: 'epic-6', status: 'planned' });
    const violations = findLandedAtDivergence([epic, land]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('landed-at-divergence');
    expect(violations[0].todoId).toBe('epic-6');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) Live-store read-only sweep — real DB, real dual-write, zero divergence.
// ─────────────────────────────────────────────────────────────────────────

describe('findLandedAtDivergence — live-store sweep', () => {
  let project: string;

  beforeEach(() => {
    project = freshProject();
  });

  afterEach(() => {
    _closeProject(project);
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('5 fixture shapes created for real → zero divergence', async () => {
    // 1. landed mission epic (dual-write via completeTodo's land-leaf-done path is NOT
    //    exercised here — stampEpicLandedAt is the coordinator-live call site, not
    //    completeTodo itself — so this shape is built directly for the sweep predicate.)
    const mission = await createTodo(project, {
      allowOrphan: true, title: '[MISSION] test', ownerSession: 'test', kind: 'mission',
    });
    const missionEpic = await createTodo(project, {
      allowOrphan: true, title: 'epic under mission', ownerSession: 'test', kind: 'epic', parentId: mission.id,
    });
    const missionLand = await createTodo(project, {
      allowOrphan: true, title: '[LAND] → master', ownerSession: 'test', kind: 'land', parentId: missionEpic.id,
    });
    await completeTodo(project, missionLand.id, 'accepted', 'test');

    // 2. landed root epic (no mission parent).
    const rootEpic = await createTodo(project, {
      allowOrphan: true, title: 'root epic', ownerSession: 'test', kind: 'epic',
    });
    const rootLand = await createTodo(project, {
      allowOrphan: true, title: '[LAND] → master', ownerSession: 'test', kind: 'land', parentId: rootEpic.id,
    });
    await completeTodo(project, rootLand.id, 'accepted', 'test');

    // 3. in-flight epic (land leaf not done).
    const inFlightEpic = await createTodo(project, {
      allowOrphan: true, title: 'in-flight epic', ownerSession: 'test', kind: 'epic',
    });
    await createTodo(project, {
      allowOrphan: true, title: '[LAND] → master', ownerSession: 'test', kind: 'land', parentId: inFlightEpic.id,
    });

    // 4. bucket epic — never lands, must be excluded.
    await createTodo(project, {
      allowOrphan: true, title: 'bucket epic', ownerSession: 'test', kind: 'epic', isBucket: true,
    });

    // 5. epic with an inert (not-done) terminal land leaf.
    const inertEpic = await createTodo(project, {
      allowOrphan: true, title: 'inert epic', ownerSession: 'test', kind: 'epic',
    });
    await createTodo(project, {
      allowOrphan: true, title: '[LAND] → master', ownerSession: 'test', kind: 'land', parentId: inertEpic.id, status: 'dropped',
    });

    // The dual-write (stampEpicLandedAt) is called from coordinator-live's stamp sites,
    // not from raw completeTodo — the two landed epics above have a done land leaf but
    // no landedAt yet from THIS test's writes. The backfill in openDb() only runs once
    // per DB and this is a fresh DB opened AFTER those rows were created within the same
    // process (openDb caches per project), so re-open via _closeProject + a fresh op to
    // force the backfill to see the now-done land leaves.
    _closeProject(project);
    const todos = listTodos(project, { includeCompleted: true });
    const violations = findLandedAtDivergence(todos);
    expect(violations).toEqual([]);
  });
});
