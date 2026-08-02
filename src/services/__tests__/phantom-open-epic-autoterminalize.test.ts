// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  updateTodo,
  getTodo,
  sweepEpicRollups,
  stampEpicLandedAt,
  _closeProject,
  listTodos,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { findViolations } from '../invariant-check';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'phantom-open-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  _closeSupervisorDb();
});

afterEach(() => {
  _closeProject(project);
  _closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('sweepEpicRollups — phantom-open epic auto-terminalize', () => {
  test('drops a phantom-open epic whose children are all dropped', async () => {
    // Create an epic with two children, then drop both
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] phantom-open test',
      kind: 'epic',
      status: 'planned',
    });
    const child1 = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'child 1',
      parentId: epic.id,
      status: 'ready',
    });
    const child2 = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'child 2',
      parentId: epic.id,
      status: 'ready',
    });

    // Drop both children
    await updateTodo(project, child1.id, { status: 'dropped' });
    await updateTodo(project, child2.id, { status: 'dropped' });

    // Run sweep
    const { rolledUp } = await sweepEpicRollups(project);

    // Epic should be dropped
    expect(rolledUp).toContain(epic.id);
    expect(getTodo(project, epic.id)?.status).toBe('dropped');

    // No phantom-open violations should remain
    const all = listTodos(project, { includeCompleted: true });
    const violations = findViolations(all);
    const phantomOpenViolations = violations.filter((v) => v.kind === 'phantom-open-epic');
    expect(phantomOpenViolations).toHaveLength(0);
  });

  test('closes a landed epic done+accepted when its only surviving child is done+accepted and the other is dropped', async () => {
    // Create a landed epic with two children: one done+accepted, one dropped
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] landed phantom-open test',
      kind: 'epic',
      status: 'planned',
    });
    const doneChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'done child',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, doneChild.id, { status: 'done', acceptanceStatus: 'accepted' });

    const droppedChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'dropped child',
      parentId: epic.id,
      status: 'ready',
    });
    await updateTodo(project, droppedChild.id, { status: 'dropped' });

    // Stamp the epic as landed
    const now = new Date().toISOString();
    stampEpicLandedAt(project, epic.id, now);

    // Run sweep
    const { rolledUp } = await sweepEpicRollups(project);

    // Epic should be closed (done+accepted)
    expect(rolledUp).toContain(epic.id);
    expect(getTodo(project, epic.id)?.status).toBe('done');
    expect(getTodo(project, epic.id)?.acceptanceStatus).toBe('accepted');
  });

  test('control: epic with zero children stays non-terminal', async () => {
    // Create an epic with zero children
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] zero-child control',
      kind: 'epic',
      status: 'planned',
    });

    const statusBefore = getTodo(project, epic.id)?.status;

    // Run sweep
    const { rolledUp } = await sweepEpicRollups(project);

    // Epic should not be rolled up or changed
    expect(rolledUp).not.toContain(epic.id);
    expect(getTodo(project, epic.id)?.status).toBe(statusBefore);
  });

  test('control: epic with one planned child stays non-terminal', async () => {
    // Create an epic with one planned child
    const epic = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] planned-child control',
      kind: 'epic',
      status: 'planned',
    });
    const plannedChild = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'w',
      title: 'planned child',
      parentId: epic.id,
      status: 'planned',
    });

    const statusBefore = getTodo(project, epic.id)?.status;

    // Run sweep
    const { rolledUp } = await sweepEpicRollups(project);

    // Epic should not be rolled up or changed
    expect(rolledUp).not.toContain(epic.id);
    expect(getTodo(project, epic.id)?.status).toBe(statusBefore);
  });

  test('control: mission with all-terminal epic children stays open', async () => {
    // Create a mission todo with two epic children, both done
    const mission = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[MISSION] control mission',
      kind: 'mission',
      status: 'planned',
    });
    const epicChild1 = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] child 1',
      kind: 'epic',
      parentId: mission.id,
      status: 'ready',
    });
    await updateTodo(project, epicChild1.id, { status: 'done', acceptanceStatus: 'accepted' });

    const epicChild2 = await createTodo(project, {
      allowOrphan: true,
      ownerSession: 'planner',
      title: '[EPIC] child 2',
      kind: 'epic',
      parentId: mission.id,
      status: 'ready',
    });
    await updateTodo(project, epicChild2.id, { status: 'done', acceptanceStatus: 'accepted' });

    const statusBefore = getTodo(project, mission.id)?.status;

    // Run sweep
    const { rolledUp } = await sweepEpicRollups(project);

    // Mission should not be rolled up (missions are durable)
    expect(rolledUp).not.toContain(mission.id);
    expect(getTodo(project, mission.id)?.status).toBe(statusBefore);
  });
});
