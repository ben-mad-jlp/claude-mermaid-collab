/**
 * Tests for the drop cascade guard (item 2): an unconditional post-check ensures no
 * live children survive under a dropped container, catching cases where re-parenting
 * or re-dropping introduces a live child back under an already-dropped container.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-epic-cascade-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, updateTodo, getTodo, _closeProject, DroppedEpicHasLiveChildrenError } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';

beforeAll(() => { _closeSupervisorDb(); });
afterAll(() => {
  _closeSupervisorDb();
  rmSync(supervisorDir, { recursive: true, force: true });
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

describe('epic-drop-cascade-guard — drop cascade safety checks', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'epic-cascade-test-'));
  });

  afterEach(() => {
    _closeProject(project);
    try { rmSync(project, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('test A: single drop cascades status to both planned children', async () => {
    // Create an epic
    const epic = await createTodo(project, {
      allowOrphan: true,
      title: 'test epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const epicId = epic.id;

    // Create two planned children under the epic
    const child1 = await createTodo(project, {
      title: 'child 1',
      ownerSession: 'test',
      status: 'planned',
      parentId: epicId,
    });

    const child2 = await createTodo(project, {
      title: 'child 2',
      ownerSession: 'test',
      status: 'planned',
      parentId: epicId,
    });

    // Drop the epic
    await updateTodo(project, epicId, { status: 'dropped' });

    // Verify both children are now dropped
    const updatedChild1 = getTodo(project, child1.id);
    const updatedChild2 = getTodo(project, child2.id);

    expect(updatedChild1?.status).toBe('dropped');
    expect(updatedChild2?.status).toBe('dropped');
  });

  it('test B: re-parenting a live child under a dropped epic is rejected', async () => {
    // Create a parent epic and a child epic
    const parentEpic = await createTodo(project, {
      allowOrphan: true,
      title: 'parent epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const parentEpicId = parentEpic.id;

    const droppedEpic = await createTodo(project, {
      allowOrphan: true,
      title: 'dropped epic',
      ownerSession: 'test',
      kind: 'epic',
      status: 'planned',
    });
    const droppedEpicId = droppedEpic.id;

    const child = await createTodo(project, {
      title: 'live child',
      ownerSession: 'test',
      status: 'planned',
      parentId: parentEpicId,
    });
    const childId = child.id;

    // Drop the target epic
    await updateTodo(project, droppedEpicId, { status: 'dropped' });

    // Attempt to re-parent the live child under the already-dropped epic
    // This should throw DroppedEpicHasLiveChildrenError
    try {
      await updateTodo(project, childId, { parentId: droppedEpicId });
      // If we get here, the test fails because no error was thrown
      throw new Error('Expected DroppedEpicHasLiveChildrenError but updateTodo succeeded');
    } catch (err) {
      // Verify the error is the expected one
      if (err instanceof Error && err.message.includes('Expected DroppedEpicHasLiveChildrenError')) {
        throw err;
      }
      expect(err).toBeInstanceOf(DroppedEpicHasLiveChildrenError);
      if (err instanceof DroppedEpicHasLiveChildrenError) {
        expect(err.id).toBe(droppedEpicId);
        expect(err.liveCount).toBe(1);
      }
    }
  });
});
