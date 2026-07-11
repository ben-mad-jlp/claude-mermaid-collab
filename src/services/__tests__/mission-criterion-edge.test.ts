// Regression tests for the mission-homed epic → criterion edge (A3).
// Verifies that servesCriterionId can be set over the wire (REST + MCP) and that
// the approval-time guard reads the effective (post-patch) value.
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTodo, getTodo, updateTodo, MissingCriterionEdgeError, _closeProject } from '../todo-store';
import type { Todo } from '../todo-store';
import {
  addSessionTodo,
  updateSessionTodo,
} from '../../mcp/tools/session-todos';

// Must be registered before the static import of coordinator-live so its module-load
// side effects resolve to the mock, not a real launch.
mock.module('../claude-launch', () => ({
  ensureSession: async () => ({ ready: true, tmux: 'tmux-mock' }),
  runTodoInSession: async () => ({ sent: true }),
}));

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mission-criterion-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
});

afterEach(() => {
  _closeProject(project);
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('mission-homed epic approval guard (A3 epic→criterion edge)', () => {
  test('approving unedged mission-homed epic throws MissingCriterionEdgeError', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: 'Epic without edge',
      kind: 'epic',
      parentId: mission.id,
    });

    // Verify epic has no edge set.
    expect(getTodo(project, epic.id)!.servesCriterionId).toBe(null);

    // Attempt to approve should throw.
    expect(async () => {
      await updateTodo(project, epic.id, { status: 'ready' });
    }).toThrow(MissingCriterionEdgeError);
  });

  test('setting edge then approving in separate calls succeeds', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: 'Deliverable',
      kind: 'epic',
      parentId: mission.id,
    });

    // Set the edge.
    const edged = await updateTodo(project, epic.id, {
      servesCriterionId: 'crit-1',
    });
    expect(edged.servesCriterionId).toBe('crit-1');

    // Now approve.
    const approved = await updateTodo(project, epic.id, {
      status: 'ready',
    });
    expect(approved.approvedAt).not.toBe(null);
  });

  test('combined set-edge-and-approve in one call succeeds', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: 'Deliverable',
      kind: 'epic',
      parentId: mission.id,
    });

    // Combined call: set edge and approve atomically.
    const result = await updateTodo(project, epic.id, {
      servesCriterionId: 'crit-1',
      status: 'ready',
    });

    expect(result.servesCriterionId).toBe('crit-1');
    expect(result.approvedAt).not.toBe(null);
  });

  test('created with edge approved immediately over MCP', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });

    const result = await addSessionTodo(
      project,
      's1',
      'Deliverable with edge',
      undefined,
      {
        kind: 'epic',
        parentId: mission.id,
        servesCriterionId: 'crit-1',
        status: 'ready',
      }
    );

    expect(result.servesCriterionId).toBe('crit-1');
    expect(result.approvedAt).not.toBe(null);
  });

  test('MCP updateSessionTodo can set edge and approve together', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: 'Deliverable',
      kind: 'epic',
      parentId: mission.id,
    });

    const result = await updateSessionTodo(project, 's1', epic.id, {
      servesCriterionId: 'crit-1',
      status: 'ready',
    });

    expect(result.servesCriterionId).toBe('crit-1');
    expect(result.approvedAt).not.toBe(null);
  });

  test('clearing edge nullifies it', async () => {
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Mission: converge',
      kind: 'mission',
    });

    const epic = await createTodo(project, {
      ownerSession: 's1',
      title: 'Deliverable',
      kind: 'epic',
      parentId: mission.id,
      servesCriterionId: 'crit-1',
    });

    const cleared = await updateTodo(project, epic.id, {
      servesCriterionId: null,
    });

    expect(cleared.servesCriterionId).toBe(null);
  });

  test('non-mission-homed epic can approve without edge', async () => {
    const root = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 's1',
      title: 'Root Epic',
      kind: 'epic',
    });

    // Should not throw even without servesCriterionId.
    const approved = await updateTodo(project, root.id, {
      status: 'ready',
    });

    expect(approved.approvedAt).not.toBe(null);
  });
});
