// Runs via `bun test` (uses bun:sqlite). Stage-B migration regressions for epic ab9b32ca:
// each of the four silent-catastrophe readers is exercised TWICE — once with the legacy
// bracket-prefixed title, once with the prefix REMOVED and only the `kind` column set
// (the stage-C shape). The second variant is the whole point: it fails if a reader still
// regexes the title.
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'bun:sqlite';
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

/** Force `kind` on a row whose title carries NO role prefix — the stage-C shape. */
function setKind(proj: string, id: string, kind: 'mission' | 'epic' | 'land' | 'leaf') {
  const db = new Database(join(proj, '.collab', 'todos.db'));
  db.prepare(`UPDATE todos SET kind=? WHERE id=?`).run(kind, id);
  db.close();
  _closeProject(proj); // next store call re-opens fresh
}

let seq = 0;
/** Hand literal `Todo` factory for the pure (no-DB) suites — mirrors
 *  epic-branch-status.test.ts's `todo()` shape, incl. `kind: null` default. */
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
    kind: null,
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
  test('prefixed: leaf under a mission-parented epic resolves to the epic', async () => {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: '[MISSION] Converge' });
    const epic = await createTodo(project, { ownerSession: 's1', title: '[EPIC] Foo', parentId: mission.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'build a thing', parentId: epic.id });
    expect(resolveEpicId(leaf, project)).toBe(epic.id);
  });

  test('kind-only: leaf under a mission-parented epic resolves to the epic, never INBOX_EPIC_ID', async () => {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'Converge' });
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Foo', parentId: mission.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'build a thing', parentId: epic.id });
    setKind(project, mission.id, 'mission');
    setKind(project, epic.id, 'epic');
    const freshLeaf = getTodo(project, leaf.id)!;
    expect(resolveEpicId(freshLeaf, project)).toBe(epic.id);
    expect(resolveEpicId(freshLeaf, project)).not.toBe(INBOX_EPIC_ID);
  });

  test('no epic ancestor: orphan leaf falls back to INBOX_EPIC_ID', async () => {
    const leaf = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: 'lonely leaf' });
    expect(resolveEpicId(leaf, project)).toBe(INBOX_EPIC_ID);
  });
});

describe('mission is never rolled up / never epic-ready-to-land', () => {
  async function buildGraph(missionTitle: string, epicATitle: string, epicBTitle: string) {
    const mission = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title: missionTitle });
    const epicA = await createTodo(project, { ownerSession: 's1', title: epicATitle, parentId: mission.id });
    const epicB = await createTodo(project, { ownerSession: 's1', title: epicBTitle, parentId: mission.id });
    const leafA = await createTodo(project, { ownerSession: 's1', title: 'leaf a', parentId: epicA.id });
    const leafB = await createTodo(project, { ownerSession: 's1', title: 'leaf b', parentId: epicB.id });
    return { mission, epicA, epicB, leafA, leafB };
  }

  test('prefixed: epics roll up but the [MISSION] never does', async () => {
    const { mission, epicA, epicB, leafA, leafB } = await buildGraph('[MISSION] M', '[EPIC] A', '[EPIC] B');
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
    const { mission, epicA, epicB, leafA, leafB } = await buildGraph('M', 'A', 'B');
    setKind(project, mission.id, 'mission');
    setKind(project, epicA.id, 'epic');
    setKind(project, epicB.id, 'epic');
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

  test('prefixed: mission-parented epic is listed, stranded, mission itself is not an epic', () => {
    const mission = todo({ id: 'm1', title: '[MISSION] M', kind: 'mission', status: 'todo' });
    const epic = todo({ id: 'e1', title: '[EPIC] E', kind: 'epic', parentId: 'm1', status: 'todo' });
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

  function run(missionTitle: string, epicTitle: string, midTitle: string, leafTitle: string, kinds?: {
    mission: 'mission'; epic: 'epic';
  }) {
    const mission = todo({ id: 'sub-m', title: missionTitle, kind: kinds ? 'mission' : null, status: 'todo' });
    const epic = todo({ id: 'sub-e', title: epicTitle, kind: kinds ? 'epic' : null, parentId: 'sub-m', status: 'todo' });
    const mid = todo({ id: 'sub-mid', title: midTitle, parentId: 'sub-e', status: 'todo' });
    const leaf = todo({ id: 'sub-leaf', title: leafTitle, parentId: 'sub-mid', status: 'ready' });

    const prev = snapshotTodos([mission, epic, mid, leaf]);
    const doneLeaf = { ...leaf, status: 'done' as TodoStatus, completed: true };
    const changes = diffTodos(prev, [mission, epic, mid, doneLeaf], project);

    addSubscription(project, 'sess-1', 'epic', epic.id);
    const notifications = planNotifications(changes, [
      { project, session: 'sess-1', scope: 'epic', targetId: epic.id, mode: 'nudge', createdAt: 0 },
    ]);
    return notifications;
  }

  test('prefixed: epic-scoped subscription fires for a leaf two levels below the epic', () => {
    const notifications = run('[MISSION] M', '[EPIC] E', 'mid area', 'do the thing');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ session: 'sess-1', scope: 'epic', targetId: 'sub-e', event: 'todo_done' });
  });

  test('kind-only: subscription still fires with NO bracket titles, kind set on the literals', () => {
    const notifications = run('M', 'E', 'mid area', 'do the thing', { mission: 'mission', epic: 'epic' });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ session: 'sess-1', scope: 'epic', targetId: 'sub-e', event: 'todo_done' });
  });
});
