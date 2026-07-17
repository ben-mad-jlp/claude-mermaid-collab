// Regression tests for the previously-dead mission rollup guards in completeTodo (:1588)
// and sweepEpicRollups (:1796). After decision ea83ac9f, `parentId===null` means "epic or mission"
// (not "epic" alone), and role is determined by `kind` not title regex.
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  completeTodo,
  sweepEpicRollups,
  getTodo,
  listTodos,
  updateTodo,
  _closeProject,
} from '../todo-store';
import type { Todo } from '../todo-store';
import {
  upsertMission,
  setMissionActive,
  getMissionRollup,
  listMissions,
  _resetMissionDbCache,
} from '../mission-store';
import { buildEpicBranchStatus, epicBranchName } from '../epic-branch-status';
import type { GitProbe } from '../epic-branch-status';

// Must be registered before the static import of coordinator-live so its module-load
// side effects resolve to the mock, not a real launch.
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true, tmux: 'tmux-mock' }),
  runTodoInSession: async () => ({ sent: true }),
}));
import { resolveEpicId } from '../coordinator-live';
import { INBOX_EPIC_ID } from '../../agent/worktree-manager';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-parent-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});
afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Create a mission node. Must be followed by upsertMission for rollup/gauge tests. */
async function mission(title = 'Converge on X') {
  const t = await createTodo(project, { allowOrphan: true, ownerSession: 's1', title, kind: 'mission' });
  upsertMission(project, t.id);
  return t;
}

describe('mission never auto-closes when epic children complete', () => {
  test('event path (:1588): completeTodo does not roll up a mission when all its epic children finish', async () => {
    // Graph: mission ← epicA ← leafA, mission ← epicB ← leafB
    const m = await mission();
    const epicA = await createTodo(project, { ownerSession: 's1', title: 'epic A', kind: 'epic', parentId: m.id });
    const epicB = await createTodo(project, { ownerSession: 's1', title: 'epic B', kind: 'epic', parentId: m.id });
    const leafA = await createTodo(project, { ownerSession: 's1', title: 'leaf A', kind: 'leaf', parentId: epicA.id });
    const leafB = await createTodo(project, { ownerSession: 's1', title: 'leaf B', kind: 'leaf', parentId: epicB.id });

    // Complete both leaves — this should roll up both epics but NOT the mission.
    await completeTodo(project, leafA.id, 'accepted');
    await completeTodo(project, leafB.id, 'accepted');

    // Vacuity guard: both epics must have rolled up to 'done'.
    expect(getTodo(project, epicA.id)!.status).toBe('done');
    expect(getTodo(project, epicB.id)!.status).toBe('done');

    // Primary guard: mission must NOT roll up.
    expect(getTodo(project, m.id)!.status).not.toBe('done');
    expect(getTodo(project, m.id)!.acceptanceStatus).not.toBe('accepted');
  });

  test('sweep path (:1796): sweepEpicRollups does not roll up a mission when all its epic children are done', async () => {
    // Graph: mission ← epicA ← leafA, mission ← epicB ← leafB
    const m = await mission();
    const epicA = await createTodo(project, { ownerSession: 's1', title: 'epic A', kind: 'epic', parentId: m.id });
    const epicB = await createTodo(project, { ownerSession: 's1', title: 'epic B', kind: 'epic', parentId: m.id });
    const leafA = await createTodo(project, { ownerSession: 's1', title: 'leaf A', kind: 'leaf', parentId: epicA.id });
    const leafB = await createTodo(project, { ownerSession: 's1', title: 'leaf B', kind: 'leaf', parentId: epicB.id });

    // Complete both leaves to roll up the epics to done/accepted via the event path.
    // This tests that sweepEpicRollups is a no-op on the resulting graph (both epics already done).
    await completeTodo(project, leafA.id, 'accepted');
    await completeTodo(project, leafB.id, 'accepted');

    // Vacuity guard: verify both epics are now done/accepted (rolled up by completeTodo event path).
    expect(getTodo(project, epicA.id)!.status).toBe('done');
    expect(getTodo(project, epicB.id)!.status).toBe('done');

    // Now run sweepEpicRollups on the graph where both epics are already done.
    // The sweep will find nothing to roll up (epics are terminal), so it's a no-op on M.
    const result = await sweepEpicRollups(project);

    // Primary guard: the mission must NOT be in rolledUp (the sweep does not auto-close missions).
    expect(result.rolledUp).not.toContain(m.id);

    // Mission must not surface as an unaccepted-children flag either.
    expect(result.flagged.some((f) => f.epicId === m.id)).toBe(false);

    // Mission status must still not be 'done'.
    expect(getTodo(project, m.id)!.status).not.toBe('done');
  });

  test('zero-children edge: a mission with no epic children is never closed by sweepEpicRollups', async () => {
    const m = await mission();

    const result = await sweepEpicRollups(project);

    // Mission must not be in rolled-up list.
    expect(result.rolledUp).not.toContain(m.id);
    expect(getTodo(project, m.id)!.status).not.toBe('done');
  });
});

describe('resolveEpicId under a mission-parented epic', () => {
  test('leaf under mission-parented epic resolves to the epic, not INBOX_EPIC_ID', async () => {
    const m = await mission();
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Deliverable', kind: 'epic', parentId: m.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'work item', kind: 'leaf', parentId: epic.id });

    expect(resolveEpicId(leaf, project)).toBe(epic.id);
    expect(resolveEpicId(leaf, project)).not.toBe(INBOX_EPIC_ID);
  });

  test('grandchild walk does not stop at the first non-epic ancestor', async () => {
    const m = await mission();
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Deliverable', kind: 'epic', parentId: m.id });
    const midLeaf = await createTodo(project, { ownerSession: 's1', title: 'mid-leaf', kind: 'leaf', parentId: epic.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'grandchild', kind: 'leaf', parentId: midLeaf.id });

    expect(resolveEpicId(leaf, project)).toBe(epic.id);
  });

  test('leaf whose parent IS a mission has no epic ancestor → INBOX_EPIC_ID', async () => {
    const m = await mission();
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'orphan', kind: 'leaf', parentId: m.id });

    expect(resolveEpicId(leaf, project)).toBe(INBOX_EPIC_ID);
  });
});

describe('land_epic / epic_branch_status resolve the branch for mission-parented epic', () => {
  test('branch seam (landEpic lines 1391-1393): epicBranchName(resolveEpicId(leaf)) === epicBranchName(epic.id)', async () => {
    const m = await mission();
    const epic = await createTodo(project, { ownerSession: 's1', title: 'Deliverable', kind: 'epic', parentId: m.id });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'work item', kind: 'leaf', parentId: epic.id });

    // This mirrors the seam in landEpic (coordinator-live.ts:1391-1393), which does:
    // epicBranchName(resolveEpicId(child, project))
    // We test the composition, not the git mechanics.
    expect(epicBranchName(resolveEpicId(leaf, project))).toBe(epicBranchName(epic.id));
    expect(epicBranchName(resolveEpicId(leaf, project))).not.toBe(epicBranchName(INBOX_EPIC_ID));
  });

  test('buildEpicBranchStatus excludes missions from the epic-branch report', () => {
    // Hand-built literal Todo objects (pure function, no DB).
    const todos: Todo[] = [
      {
        id: 'm1',
        kind: 'mission',
        title: 'Converge on X',
        parentId: null,
        status: 'ready',
        completed: false,
        acceptanceStatus: null,
        ownerSession: 's1',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
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
        servesCriterionId: null, servesCriterionIds: [],
        decisionRef: null,
        claimProbe: null,
      inheritedBlueprintFrom: null,
      inheritedFiles: [],
      isBucket: false,
      },
      {
        id: 'e1',
        kind: 'epic',
        title: 'Deliverable',
        parentId: 'm1',
        status: 'ready',
        completed: false,
        acceptanceStatus: null,
        ownerSession: 's1',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
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
        servesCriterionId: null, servesCriterionIds: [],
        decisionRef: null,
        claimProbe: null,
      inheritedBlueprintFrom: null,
      inheritedFiles: [],
      isBucket: false,
      },
      {
        id: 'land1',
        kind: 'land',
        title: 'LAND',
        parentId: 'e1',
        status: 'ready',
        completed: false,
        acceptanceStatus: null,
        ownerSession: 's1',
        assigneeSession: null,
        assigneeKind: 'agent',
        description: null,
        priority: null,
        dueDate: null,
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
        servesCriterionId: null, servesCriterionIds: [],
        decisionRef: null,
        claimProbe: null,
      inheritedBlueprintFrom: null,
      inheritedFiles: [],
      isBucket: false,
      },
    ];

    const probe: GitProbe = () => ({ exists: true, ahead: 5, behind: 0, mergeable: true });
    const report = buildEpicBranchStatus(todos, probe);

    // The report should contain only the epic, not the mission.
    expect(report.epics.length).toBe(1);
    expect(report.epics[0].epicId).toBe('e1');
    expect(report.epics[0].branch).toBe(epicBranchName('e1'));
    expect(report.epics[0].stranded).toBe(true);

    // Mission must not appear in the epic-branch report.
    expect(report.epics.some((e) => e.epicId === 'm1')).toBe(false);
  });
});

describe('bucket epics stay roots', () => {
  test('bucket epic titles never adopt a mission parent, even with an active mission present', async () => {
    // Each title in ITS OWN project: one-bucket enforcement (DR-bugfix-bucket-dedupe) rejects a
    // second bucket whose normalized title collides — 'Inbox' / 'inbox' / '[EPIC] Inbox' all
    // normalize to 'inbox'. This test only asserts each bucket title stays a ROOT under an
    // active mission, so isolate per title to avoid the (correct) duplicate rejection.
    const created: string[] = [];
    for (const title of ['Inbox', 'Bugfix inbox', 'inbox', '[EPIC] Inbox']) {
      project = mkdtempSync(join(tmpdir(), 'mission-parent-bucket-'));
      created.push(project);
      const m = await mission();
      setMissionActive(project, m.id, true);
      const e = await createTodo(project, { ownerSession: 's1', title, kind: 'epic' });
      expect(e.parentId).toBeNull();
    }
    for (const p of created) rmSync(p, { recursive: true, force: true });
  });

  test('deliverable epic with active mission is homed under it', async () => {
    const m = await mission();
    setMissionActive(project, m.id, true);

    const e = await createTodo(project, { ownerSession: 's1', title: 'Deliverable', kind: 'epic' });
    expect(e.parentId).toBe(m.id);
  });

  test('explicit opt-out (missionId: null) beats default parenting', async () => {
    const m = await mission();
    setMissionActive(project, m.id, true);

    const e = await createTodo(project, { ownerSession: 's1', title: 'Deliverable', kind: 'epic', missionId: null });
    expect(e.parentId).toBeNull();
  });

  test('explicit homing beats bucket check', async () => {
    const m = await mission();
    setMissionActive(project, m.id, true);

    const e = await createTodo(project, { ownerSession: 's1', title: 'Inbox', kind: 'epic', missionId: m.id });
    expect(e.parentId).toBe(m.id);
  });

  test('bucket epic\'s leaves still resolveEpicId to the bucket epic, not INBOX_EPIC_ID', async () => {
    const m = await mission();
    setMissionActive(project, m.id, true);

    const bucket = await createTodo(project, { ownerSession: 's1', title: 'Inbox', kind: 'epic' });
    const leaf = await createTodo(project, { ownerSession: 's1', title: 'work item', kind: 'leaf', parentId: bucket.id });

    expect(resolveEpicId(leaf, project)).toBe(bucket.id);
    expect(resolveEpicId(leaf, project)).not.toBe(INBOX_EPIC_ID);
  });
});

describe('mission BUILD gauge counts real epic children', () => {
  test('getMissionRollup counts only epic children and excludes dropped ones', async () => {
    const m = await mission();
    const epicA = await createTodo(project, { ownerSession: 's1', title: 'epic A', kind: 'epic', parentId: m.id });
    const epicB = await createTodo(project, { ownerSession: 's1', title: 'epic B', kind: 'epic', parentId: m.id });
    const droppedEpic = await createTodo(project, { ownerSession: 's1', title: 'dropped epic', kind: 'epic', parentId: m.id });
    const leafUnderMission = await createTodo(project, { ownerSession: 's1', title: 'leaf', kind: 'leaf', parentId: m.id });
    const leafUnderEpicA = await createTodo(project, { ownerSession: 's1', title: 'leaf A', kind: 'leaf', parentId: epicA.id });
    const leafUnderEpicB = await createTodo(project, { ownerSession: 's1', title: 'leaf B', kind: 'leaf', parentId: epicB.id });

    // Drop the extra epic so it doesn't count in the gauge.
    await updateTodo(project, droppedEpic.id, { status: 'dropped' });

    // Initially, gauge should report 2 epic children (the active ones: epicA, epicB).
    let rollup = getMissionRollup(project, m.id);
    expect(rollup.mechanical).toEqual({ done: 0, total: 2 });

    // Complete epicA's leaf → epicA rolls up done.
    await completeTodo(project, leafUnderEpicA.id, 'accepted');
    rollup = getMissionRollup(project, m.id);
    expect(rollup.mechanical).toEqual({ done: 1, total: 2 });

    // Complete epicB's leaf → epicB rolls up done.
    await completeTodo(project, leafUnderEpicB.id, 'accepted');
    rollup = getMissionRollup(project, m.id);
    expect(rollup.mechanical).toEqual({ done: 2, total: 2 });

    // Both epics are done, but the mission itself is still open.
    expect(getTodo(project, m.id)!.status).not.toBe('done');

    // Verify listMissions reports 2 epics in the items list.
    const missions = listMissions(project);
    expect(missions[0].epics).toHaveLength(2);
  });

  test('dropping an epic via updateTodo excludes it from the gauge', async () => {
    const m = await mission();
    const epicA = await createTodo(project, { ownerSession: 's1', title: 'epic A', kind: 'epic', parentId: m.id });
    const epicB = await createTodo(project, { ownerSession: 's1', title: 'epic B', kind: 'epic', parentId: m.id });

    // Initially 2 epics.
    let rollup = getMissionRollup(project, m.id);
    expect(rollup.mechanical.total).toBe(2);

    // Drop epicA.
    await updateTodo(project, epicA.id, { status: 'dropped' });

    // Now only epicB counts.
    rollup = getMissionRollup(project, m.id);
    expect(rollup.mechanical.total).toBe(1);
  });
});
