// Regression tests for reapTerminalMissionEpics: terminal-mission epic cleanup
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  getTodo,
  listTodos,
  updateTodo,
  _closeProject,
  type Todo,
} from '../todo-store';
import {
  upsertMission,
  setMissionAbandoned,
  setMissionClosed,
  listMissions,
  _resetMissionDbCache,
} from '../mission-store';
import { reapTerminalMissionEpics } from '../landed-epic-sweep';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

// Mock claude-launch so coordinator-live can load without starting a real session
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true, tmux: 'tmux-mock' }),
  runTodoInSession: async () => ({ sent: true }),
}));

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'terminal-reaper-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});

afterEach(() => {
  _closeProject(project);
  _resetMissionDbCache(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

/** Create a mission node and upsert it into mission-store */
async function createMission(title = 'Test Mission') {
  const t = await createTodo(project, {
    allowOrphan: true,
    ownerSession: 's1',
    title,
    kind: 'mission',
  });
  upsertMission(project, t.id);
  return t;
}

describe('reapTerminalMissionEpics', () => {
  test('closed mission with non-landed epic: teardown called, epic dropped', async () => {
    // Setup: CLOSED mission with a non-landed epic child
    const mission = await createMission('Closed Mission');
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] to reap',
      kind: 'epic',
      parentId: mission.id,
      status: 'todo',
    });

    // Mark mission as closed (set closedAt timestamp)
    const now = Date.now();
    setMissionClosed(project, mission.id, now);

    // Verify mission is actually closed
    const missions = listMissions(project, { includeArchived: true });
    expect(missions.some((m) => m.mission.closedAt != null && m.mission.closedAt === now)).toBe(true);

    // Track teardown calls
    const teardownCalls: Array<{ epicId: string; targetProject: string; epicBranch: string }> = [];
    const fakeTearddown = async (_wm: any, epicId: string, targetProject: string, ctx: { epicBranch: string }) => {
      teardownCalls.push({ epicId, targetProject, epicBranch: ctx.epicBranch });
    };

    // Reap with fake teardown
    const result = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });

    // Assert teardown was called
    expect(teardownCalls).toHaveLength(1);
    expect(teardownCalls[0].epicId).toBe(epic.id);
    expect(teardownCalls[0].targetProject).toBe(project);
    expect(teardownCalls[0].epicBranch).toMatch(/collab\/epic/);

    // Assert epic was marked as dropped
    const reapedEpic = getTodo(project, epic.id);
    expect(reapedEpic?.status).toBe('dropped');

    // Assert result
    expect(result.reaped).toContain(epic.id);
    expect(result.reaped).toHaveLength(1);
  });

  test('abandoned mission with non-landed epic: teardown called, epic dropped', async () => {
    // Setup: ABANDONED mission with a non-landed epic child
    const mission = await createMission('Abandoned Mission');
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] to reap',
      kind: 'epic',
      parentId: mission.id,
      status: 'ready',
    });

    // Mark mission as abandoned (set abandonedAt timestamp)
    const now = Date.now();
    setMissionAbandoned(project, mission.id, now);

    // Verify mission is actually abandoned
    const missions = listMissions(project, { includeArchived: true });
    expect(missions.some((m) => m.mission.abandonedAt != null && m.mission.abandonedAt === now)).toBe(true);

    // Track teardown calls
    const teardownCalls: Array<{ epicId: string }> = [];
    const fakeTearddown = async (_wm: any, epicId: string, _targetProject: string, _ctx: any) => {
      teardownCalls.push({ epicId });
    };

    // Reap with fake teardown
    const result = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });

    // Assert teardown was called
    expect(teardownCalls).toHaveLength(1);
    expect(teardownCalls[0].epicId).toBe(epic.id);

    // Assert epic was marked as dropped
    const reapedEpic = getTodo(project, epic.id);
    expect(reapedEpic?.status).toBe('dropped');

    // Assert result
    expect(result.reaped).toContain(epic.id);
  });

  test('open mission: epic untouched, zero teardown calls', async () => {
    // Setup: OPEN mission (no closedAt/abandonedAt) with an epic child
    const mission = await createMission('Open Mission');
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] should not be reaped',
      kind: 'epic',
      parentId: mission.id,
      status: 'planned',
    });

    // Ensure mission is NOT terminal
    const missions = listMissions(project);
    const thisMission = missions.find((m) => m.node.id === mission.id);
    expect(thisMission?.mission.closedAt).toBeNull();
    expect(thisMission?.mission.abandonedAt).toBeNull();

    // Track teardown calls
    const teardownCalls: Array<{ epicId: string }> = [];
    const fakeTearddown = async (_wm: any, epicId: string, _targetProject: string, _ctx: any) => {
      teardownCalls.push({ epicId });
    };

    // Reap
    const result = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });

    // Assert NO teardown calls for this epic
    expect(teardownCalls).toHaveLength(0);

    // Assert epic status unchanged
    const epicAfter = getTodo(project, epic.id);
    expect(epicAfter?.status).toBe('planned');

    // Assert it was skipped
    expect(result.reaped).not.toContain(epic.id);
    expect(result.skipped).toBeGreaterThan(0);
  });

  test('terminal mission with inflight epic child: epic skipped, not reaped', async () => {
    // Setup: CLOSED mission with an epic that has an in_progress child leaf
    const mission = await createMission('Closed with Inflight');
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] with inflight child',
      kind: 'epic',
      parentId: mission.id,
      status: 'planned',
    });

    // Create a leaf child in in_progress state
    const leaf = await createTodo(project, {
      ownerSession: 's1',
      title: 'leaf in flight',
      kind: 'leaf',
      parentId: epic.id,
      status: 'ready',
    });
    // Force leaf to in_progress via raw SQL (mimics epic-sweep-completeness pattern)
    const Database = require('bun:sqlite').default;
    const db = new Database(join(project, '.collab', 'todos.db'));
    const at = new Date().toISOString();
    const claim = JSON.stringify({ by: 'worker-1', token: 'tok-1', at, leaseMs: 40 * 60 * 1000 });
    db.exec(
      `UPDATE todos SET status='in_progress', claimedBy='worker-1', claimToken='tok-1', ` +
      `claimedAt='${at}', claimLeaseMs=${40 * 60 * 1000}, claim='${claim}' WHERE id='${leaf.id}'`,
    );
    db.close();
    _closeProject(project);

    // Mark mission as closed
    const now = Date.now();
    setMissionClosed(project, mission.id, now);

    // Track teardown calls
    const teardownCalls: Array<{ epicId: string }> = [];
    const fakeTearddown = async (_wm: any, epicId: string, _targetProject: string, _ctx: any) => {
      teardownCalls.push({ epicId });
    };

    // Reap
    const result = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });

    // Assert NO teardown calls for this epic (inflight child guards it)
    expect(teardownCalls).toHaveLength(0);

    // Assert epic status unchanged
    const epicAfter = getTodo(project, epic.id);
    expect(epicAfter?.status).toBe('planned');

    // Assert it was skipped
    expect(result.reaped).not.toContain(epic.id);
  });

  test('idempotent: second pass skips already-reaped epics', async () => {
    // Setup: closed mission with an epic
    const mission = await createMission('Idempotent Test');
    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] already reaped',
      kind: 'epic',
      parentId: mission.id,
      status: 'todo',
    });

    // Mark mission as closed
    const now = Date.now();
    setMissionClosed(project, mission.id, now);

    // Track teardown calls
    let teardownCallCount = 0;
    const fakeTearddown = async () => {
      teardownCallCount++;
    };

    // First reap pass
    const result1 = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });
    expect(teardownCallCount).toBe(1);
    expect(result1.reaped).toContain(epic.id);

    // Verify epic is now dropped
    let epicAfter = getTodo(project, epic.id);
    expect(epicAfter?.status).toBe('dropped');

    // Reset counter
    teardownCallCount = 0;

    // Second reap pass (should be idempotent)
    const result2 = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });

    // Assert NO new teardown calls
    expect(teardownCallCount).toBe(0);

    // Assert epic not in reaped (it was already dropped, so not in epicChildren)
    expect(result2.reaped).toHaveLength(0);
    expect(result2.reaped).not.toContain(epic.id);
  });

  test('terminal mission with multiple epics: reaped epics accumulate', async () => {
    // Setup: closed mission with multiple non-landed epic children
    const mission = await createMission('Multi-Epic Mission');
    const epic1 = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] first',
      kind: 'epic',
      parentId: mission.id,
      status: 'todo',
    });
    const epic2 = await createTodo(project, {
      ownerSession: 's1',
      title: '[EPIC] second',
      kind: 'epic',
      parentId: mission.id,
      status: 'todo',
    });

    // Mark mission as closed
    const now = Date.now();
    setMissionClosed(project, mission.id, now);

    // Track teardown calls
    const teardownCalls: Array<{ epicId: string }> = [];
    const fakeTearddown = async (_wm: any, epicId: string, _targetProject: string, _ctx: any) => {
      teardownCalls.push({ epicId });
    };

    // Reap
    const result = await reapTerminalMissionEpics(project, { teardown: fakeTearddown, wm: {} as any });

    // Assert both were reaped
    expect(teardownCalls).toHaveLength(2);
    expect(result.reaped).toContain(epic1.id);
    expect(result.reaped).toContain(epic2.id);
    expect(result.reaped).toHaveLength(2);

    // Assert both are dropped
    expect(getTodo(project, epic1.id)?.status).toBe('dropped');
    expect(getTodo(project, epic2.id)?.status).toBe('dropped');
  });
});
