// Stage-C reader regressions for epic ab9b32ca. Each of the four silent-catastrophe readers
// (`resolveEpicId`, `sweepEpicRollups`, `buildEpicBranchStatus`, `session-notification-router`) is
// exercised TWICE over the same graph: once with a legacy/stale bracket-prefixed title, once with the
// prefix removed. The `kind` column is stated identically in both. A reader that still regexes a title
// fails the first variant; a reader that fell back to inferring from a title fails the second.
// No production symbol here may reach `kindFromTitle` — it is backfill-only (`todo-kind-backfill.ts`).
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, completeTodo, sweepEpicRollups, _closeProject } from '../todo-store';
import type { Todo, TodoStatus } from '../todo-store';
import { addSubscription, __resetForTest as __resetSubs } from '../session-subscriptions';
import {
  buildEpicBranchStatus,
  type BranchProbe,
  type GitProbe,
} from '../epic-branch-status';
import { diffTodos, planNotifications, snapshotTodos } from '../session-notification-router';

// Must be registered before the static import of coordinator-live so its module-load
// `ensureSession`/`runTodoInSession` imports resolve to the mock, not a real launch —
// same ordering as coordinator-live.test.ts. `../todo-store` is deliberately NOT mocked
// here: resolveEpicId needs the real store.
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true, tmux: 'tmux-mock' }),
  runTodoInSession: async () => ({ sent: true }),
}));
import { resolveEpicId } from '../coordinator-live';
import { INBOX_EPIC_ID } from '../../agent/worktree-manager';

let seq = 0;
/** Hand literal `Todo` factory for the pure (no-DB) suites — mirrors
 *  epic-branch-status.test.ts's `todo()` shape. `kind` defaults to 'leaf': the column
 *  is NOT NULL post-stage-C, so a literal with `kind:null` would model a row that
 *  cannot exist. Callers override via `...partial` for other roles. */
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
    kind: 'leaf',
    targetProject: null,
    acceptanceStatus: null,
    claimedBy: null,
    claimToken: null,
    claimedAt: null,
    claimLeaseMs: null,
    claim: null,
    approvedAt: null,
    approvedBy: null,
    heldAt: null,
    heldReason: null,
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

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'kindmig-'));
});
afterEach(() => {
  _closeProject(project);
  rmSync(project, { recursive: true, force: true });
});

describe('resolveEpicId (coordinator-live) — kind-driven', () => {
  test('stale prefix in title, kind column wins: leaf under a mission-parented epic resolves to the epic', async () => {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] Converge', kind: 'mission' });
    const epic = await createTodo(project, { ownerSession: 's1', title: '[EPIC] Foo', kind: 'epic', parentId: mission.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'build a thing', kind: 'leaf', parentId: epic.id });
    expect(resolveEpicId(leaf, project)).toBe(epic.id);
  });

  test('kind-only: leaf under a mission-parented epic resolves to the epic, never INBOX_EPIC_ID', async () => {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'Converge', kind: 'mission' });
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Foo', kind: 'epic', parentId: mission.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'build a thing', kind: 'leaf', parentId: epic.id });
    expect(resolveEpicId(leaf, project)).toBe(epic.id);
    expect(resolveEpicId(leaf, project)).not.toBe(INBOX_EPIC_ID);
  });

  test('no epic ancestor: orphan leaf falls back to INBOX_EPIC_ID', async () => {
    const leaf = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'lonely leaf', kind: 'leaf' });
    expect(resolveEpicId(leaf, project)).toBe(INBOX_EPIC_ID);
  });
});

describe('mission is never rolled up / never epic-ready-to-land', () => {
  async function buildGraph(t: { mission: string; epicA: string; epicB: string }) {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: t.mission, kind: 'mission' });
    const epicA = await createTodo(project, { ownerSession: 's1', title: t.epicA, kind: 'epic', parentId: mission.id });
    const epicB = await createTodo(project, { ownerSession: 's1', title: t.epicB, kind: 'epic', parentId: mission.id });
    const leafA = await createTodo(project, { ownerSession: 's1', title: 'leaf a', kind: 'leaf', parentId: epicA.id });
    const leafB = await createTodo(project, { ownerSession: 's1', title: 'leaf b', kind: 'leaf', parentId: epicB.id });
    return { mission, epicA, epicB, leafA, leafB };
  }

  test('stale prefix in title, kind column wins: epics roll up but the mission never does', async () => {
    const { mission, epicA, epicB, leafA, leafB } = await buildGraph({ mission: '[MISSION] M', epicA: '[EPIC] A', epicB: '[EPIC] B' });
    await completeTodo(project, leafA.id, 'accepted');
    await completeTodo(project, leafB.id, 'accepted');
    const result = await sweepEpicRollups(project);

    expect(getTodo(project, epicA.id)!.status).toBe('done'); // vacuity guard: epics DO roll up
    expect(getTodo(project, epicB.id)!.status).toBe('done');
    expect(getTodo(project, mission.id)!.status).not.toBe('done');
    expect(getTodo(project, mission.id)!.acceptanceStatus).not.toBe('accepted');
    expect(result.rolledUp).not.toContain(mission.id);
    expect(result.flagged.some((f) => f.epicId === mission.id)).toBe(false);
  });

  test('kind-only: epics roll up but the mission-kind row never does, never flags epic-ready-to-land', async () => {
    const { mission, epicA, epicB, leafA, leafB } = await buildGraph({ mission: 'M', epicA: 'A', epicB: 'B' });
    await completeTodo(project, leafA.id, 'accepted');
    await completeTodo(project, leafB.id, 'accepted');
    const result = await sweepEpicRollups(project);

    expect(getTodo(project, epicA.id)!.status).toBe('done'); // vacuity guard: epics DO roll up
    expect(getTodo(project, epicB.id)!.status).toBe('done');
    expect(getTodo(project, mission.id)!.status).not.toBe('done');
    expect(getTodo(project, mission.id)!.acceptanceStatus).not.toBe('accepted');
    expect(result.rolledUp).not.toContain(mission.id);
    expect(result.flagged.some((f) => f.epicId === mission.id)).toBe(false);
  });
});

describe('buildEpicBranchStatus lists a mission-parented epic', () => {
  const probe: GitProbe = () => ({ exists: true, ahead: 5, behind: 0, mergeable: true } as BranchProbe);

  test('stale prefix in title, kind column wins: mission-parented epic is listed, stranded, mission itself is not an epic', () => {
    const mission = todo({ id: 'm1', title: '[MISSION] M', kind: 'mission', status: 'todo' });
    const epic = todo({ id: 'e1', title: '[MISSION] E', kind: 'epic', parentId: 'm1', status: 'todo' });
    const land = todo({ id: 'l1', title: '[LAND] E → master', kind: 'land', parentId: 'e1', status: 'ready' });
    const report = buildEpicBranchStatus([mission, epic, land], probe);

    expect(report.epics).toHaveLength(1);
    expect(report.epics[0].epicId).toBe('e1');
    expect(report.epics[0].stranded).toBe(true);
    expect(report.epics.some((e) => e.epicId === 'm1')).toBe(false);
  });

  test('kind-only: same graph with NO bracket titles, kind column set on the literals', () => {
    const mission = todo({ id: 'm2', title: 'M', kind: 'mission', status: 'todo' });
    const epic = todo({ id: 'e2', title: 'E', kind: 'epic', parentId: 'm2', status: 'todo' });
    const land = todo({ id: 'l2', title: '→ master', kind: 'land', parentId: 'e2', status: 'ready' });
    const report = buildEpicBranchStatus([mission, epic, land], probe);

    expect(report.epics).toHaveLength(1);
    expect(report.epics[0].epicId).toBe('e2');
    expect(report.epics[0].stranded).toBe(true);
    expect(report.epics.some((e) => e.epicId === 'm2')).toBe(false);
  });
});

describe('epic-scoped subscription fires for a grandchild leaf', () => {
  beforeEach(() => {
    process.env.MERMAID_DATA_DIR = project;
    __resetSubs();
  });
  afterEach(() => {
    delete process.env.MERMAID_DATA_DIR;
    __resetSubs();
  });

  function run(missionTitle: string, epicTitle: string, midTitle: string, leafTitle: string) {
    const mission = todo({ id: 'sub-m', title: missionTitle, kind: 'mission', status: 'todo' });
    const epic = todo({ id: 'sub-e', title: epicTitle, kind: 'epic', parentId: 'sub-m', status: 'todo' });
    const mid = todo({ id: 'sub-mid', title: midTitle, kind: 'leaf', parentId: 'sub-e', status: 'todo' });
    const leaf = todo({ id: 'sub-leaf', title: leafTitle, kind: 'leaf', parentId: 'sub-mid', status: 'ready' });

    const prev = snapshotTodos([mission, epic, mid, leaf]);
    const doneLeaf = { ...leaf, status: 'done' as TodoStatus, completed: true };
    const changes = diffTodos(prev, [mission, epic, mid, doneLeaf], project);

    addSubscription(project, 'sess-1', 'epic', epic.id);
    const notifications = planNotifications(changes, [
      { project, session: 'sess-1', scope: 'epic', targetId: epic.id, mode: 'nudge', createdAt: 0 },
    ]);
    return notifications;
  }

  test('stale prefix in title, kind column wins: epic-scoped subscription fires for a leaf two levels below the epic', () => {
    const notifications = run('[MISSION] M', '[EPIC] E', 'mid area', 'do the thing');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ session: 'sess-1', scope: 'epic', targetId: 'sub-e', event: 'todo_done' });
  });

  test('kind-only: subscription still fires with NO bracket titles, kind set on the literals', () => {
    const notifications = run('M', 'E', 'mid area', 'do the thing');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ session: 'sess-1', scope: 'epic', targetId: 'sub-e', event: 'todo_done' });
  });
});
