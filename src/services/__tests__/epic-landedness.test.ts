/**
 * Characterization test for epic-landedness.ts: three distinct notions pinning
 * the old inline expressions at mission-store.ts:1465/1477 and related sites.
 *
 * Fixtures test pure predicates (isLanded, hasLandStamp, isEpicStatusDone) without DB.
 * Live-store cases (hasGitReachedMaster, isEpicWorkReachable) use temp DBs and no git repo,
 * verifying error safety.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate supervisor db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-landedness-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import type { Todo } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { recordEpicLand } from '../epic-land-record-store';
import {
  isLanded,
  hasLandStamp,
  isEpicStatusDone,
  hasGitReachedMaster,
  isEpicWorkReachable,
  type EpicWorkReachability,
} from '../epic-landedness';

const todoBase = mkdtempSync(join(tmpdir(), 'landedness-todos-'));
let projectCounter = 0;

function freshProject(): string {
  const p = join(todoBase, `proj-${++projectCounter}`);
  mkdirSync(join(p, '.collab'), { recursive: true });
  return p;
}

function baseTodo(overrides: Partial<Todo>): Todo {
  return {
    id: overrides.id ?? 'id',
    ownerSession: 'test',
    assigneeSession: null,
    assigneeKind: 'agent',
    title: overrides.title ?? 'todo',
    description: null,
    status: overrides.status ?? 'planned',
    completed: false,
    priority: null,
    dueDate: null,
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

beforeAll(() => {
  _closeSupervisorDb();
});

afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  rmSync(todoBase, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

// ─────────────────────────────────────────────────────────────────────────
// Pure predicates (no DB, no git)
// ─────────────────────────────────────────────────────────────────────────

describe('epic-landedness pure predicates', () => {
  it('(a) masking case: landedAt set + status:todo → isLanded true, hasLandStamp true, isEpicStatusDone false', () => {
    const epic = baseTodo({
      id: 'epic-a',
      landedAt: '2026-01-02T00:00:00.000Z',
      status: 'todo',
    });

    expect(isLanded(epic)).toBe(true);
    expect(hasLandStamp(epic)).toBe(true);
    expect(isEpicStatusDone(epic)).toBe(false);
  });

  it('(c) status:done + landedAt:null → isLanded true, isEpicStatusDone true, hasLandStamp false', () => {
    const epic = baseTodo({
      id: 'epic-c',
      status: 'done',
      landedAt: null,
    });

    expect(isLanded(epic)).toBe(true);
    expect(isEpicStatusDone(epic)).toBe(true);
    expect(hasLandStamp(epic)).toBe(false);
  });

  it('(d) control: status:todo + landedAt:null → all false', () => {
    const epic = baseTodo({
      id: 'epic-d',
      status: 'todo',
      landedAt: null,
    });

    expect(isLanded(epic)).toBe(false);
    expect(isEpicStatusDone(epic)).toBe(false);
    expect(hasLandStamp(epic)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DB-backed predicates (land records, project state)
// ─────────────────────────────────────────────────────────────────────────

describe('epic-landedness DB-backed predicates', () => {
  it('(b) stamp-without-merge: landedAt set, no land record → hasLandStamp true, hasGitReachedMaster false', () => {
    const project = freshProject();
    const epicId = 'epic-b';
    const epic = baseTodo({
      id: epicId,
      landedAt: '2026-01-02T00:00:00.000Z',
      status: 'todo',
    });

    // Verify the Todo has a stamp.
    expect(hasLandStamp(epic)).toBe(true);

    // Verify no land record exists in the DB (we do not insert one).
    expect(hasGitReachedMaster(project, epicId)).toBe(false);
  });

  it('(b) variant: stamp WITH land record but empty landedMergeSha → hasGitReachedMaster false', () => {
    const project = freshProject();
    const epicId = 'epic-b-empty-sha';
    const epic = baseTodo({
      id: epicId,
      landedAt: '2026-01-02T00:00:00.000Z',
    });

    // Insert a land record with empty landedMergeSha.
    recordEpicLand(project, {
      epicId,
      epicTipSha: 'abc123',
      landedMergeSha: '', // empty
      landedAt: Date.now(),
    });

    // Stamp exists on the epic.
    expect(hasLandStamp(epic)).toBe(true);

    // But git-reached-master checks the DB record and sees empty sha after trim.
    expect(hasGitReachedMaster(project, epicId)).toBe(false);
  });

  it('(b+) variant: stamp WITH land record and non-empty landedMergeSha → hasGitReachedMaster true', () => {
    const project = freshProject();
    const epicId = 'epic-b-with-sha';

    // Insert a land record with actual landedMergeSha.
    recordEpicLand(project, {
      epicId,
      epicTipSha: 'abc123',
      landedMergeSha: 'def456', // non-empty
      landedAt: Date.now(),
    });

    // git-reached-master finds the record and sees non-empty sha.
    expect(hasGitReachedMaster(project, epicId)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Async work-reachability shape (no repo, error-safe)
// ─────────────────────────────────────────────────────────────────────────

describe('epic-landedness async reachability', () => {
  it('(e) isEpicWorkReachable shape: returns three-field object, does not throw', async () => {
    const project = freshProject();
    const epicId = 'epic-e-no-todos';

    // Project has no todos, no git repo, no epic to find.
    // The async call should succeed (not throw) and return the shape with all three fields.
    const result: EpicWorkReachability = await isEpicWorkReachable(project, epicId);

    // Shape is always present, never throws.
    expect(result).toHaveProperty('reachable');
    expect(result).toHaveProperty('indeterminate');
    expect(result).toHaveProperty('stranded');

    // All three fields are present and have the correct types.
    expect(typeof result.reachable).toBe('boolean');
    expect(typeof result.indeterminate).toBe('boolean');
    expect(Array.isArray(result.stranded)).toBe(true);
  });
});
