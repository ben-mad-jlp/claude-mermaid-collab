/**
 * Terminal epic "no live child" invariant check test.
 *
 * Verifies that findViolations detects when a terminal epic (done, dropped, or
 * landedAt stamped) retains live (non-terminal) children. Tests the three entry
 * points for terminating an epic: sweepEpicRollups, updateTodo drop-cascade, and
 * stampEpicLandedAt. Includes a control case (live epic with live child) and a
 * mutation-probe case that hand-orphans a live child to verify the detection fires.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-terminal-epic-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import type { Todo } from '../todo-store';
import {
  createTodo,
  completeTodo,
  listTodos,
  sweepEpicRollups,
  updateTodo,
  stampEpicLandedAt,
  openDb,
  _closeProject,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { findViolations } from '../invariant-check';

const todoBase = mkdtempSync(join(tmpdir(), 'terminal-epic-todos-'));
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

describe('terminal-epic-no-live-children', () => {
  describe('(a) rolled to done via sweepEpicRollups', () => {
    it('epic with landedAt + done child + planned leftover → leftover dropped, zero violations', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Sweep Rollup Test',
          kind: 'epic',
        });
        const doneChild = await createTodo(project, {
          ownerSession: 'test',
          title: 'done child',
          kind: 'leaf',
          parentId: epic.id,
        });
        const leftoverChild = await createTodo(project, {
          ownerSession: 'test',
          title: 'leftover planned',
          kind: 'leaf',
          parentId: epic.id,
          status: 'planned',
        });

        // Set landedAt on epic, mark done child as done+accepted
        const db = openDb(project);
        db.prepare('UPDATE todos SET landedAt = ? WHERE id = ?')
          .run('2026-01-01T00:00:00Z', epic.id);
        db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
          .run('done', 'accepted', doneChild.id);
        _closeProject(project);

        // Sweep should drop the leftover and close the epic
        const result = await sweepEpicRollups(project);

        const updated = listTodos(project, { includeCompleted: true }).find((t) => t.id === epic.id);
        expect(updated?.status).toBe('done');
        expect(result.rolledUp).toContain(epic.id);

        const droppedLeftover = listTodos(project, { includeCompleted: true }).find((t) => t.id === leftoverChild.id);
        expect(droppedLeftover?.status).toBe('dropped');

        // No violations of the new kind
        const todos = listTodos(project, { includeCompleted: true });
        const violations = findViolations(todos);
        const liveChildViolations = violations.filter((v) => v.kind === 'live-child-under-terminal-epic');
        expect(liveChildViolations).toHaveLength(0);
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('(b) dropped via updateTodo', () => {
    it('epic dropped → live children cascade to dropped, zero violations', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Drop Cascade Test',
          kind: 'epic',
        });
        const liveChild1 = await createTodo(project, {
          ownerSession: 'test',
          title: 'live child 1',
          kind: 'leaf',
          parentId: epic.id,
          status: 'planned',
        });
        const liveChild2 = await createTodo(project, {
          ownerSession: 'test',
          title: 'live child 2',
          kind: 'leaf',
          parentId: epic.id,
          status: 'todo',
        });

        // Drop the epic, which cascades to live children
        await updateTodo(project, epic.id, { status: 'dropped' });

        const updated = listTodos(project, { includeCompleted: true }).find((t) => t.id === epic.id);
        expect(updated?.status).toBe('dropped');

        const c1 = listTodos(project, { includeCompleted: true }).find((t) => t.id === liveChild1.id);
        const c2 = listTodos(project, { includeCompleted: true }).find((t) => t.id === liveChild2.id);
        expect(c1?.status).toBe('dropped');
        expect(c2?.status).toBe('dropped');

        // No violations of the new kind
        const todos = listTodos(project, { includeCompleted: true });
        const violations = findViolations(todos);
        const liveChildViolations = violations.filter((v) => v.kind === 'live-child-under-terminal-epic');
        expect(liveChildViolations).toHaveLength(0);
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('(c) landedAt stamped directly', () => {
    it('epic with children already done+accepted → stampEpicLandedAt, zero violations', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] LandedAt Stamp Test',
          kind: 'epic',
        });
        const child1 = await createTodo(project, {
          ownerSession: 'test',
          title: 'child1',
          kind: 'leaf',
          parentId: epic.id,
        });
        const child2 = await createTodo(project, {
          ownerSession: 'test',
          title: 'child2',
          kind: 'leaf',
          parentId: epic.id,
        });

        // Mark both children done+accepted
        const db = openDb(project);
        db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
          .run('done', 'accepted', child1.id);
        db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
          .run('done', 'accepted', child2.id);
        _closeProject(project);

        // Stamp landedAt
        const stamped = stampEpicLandedAt(project, epic.id, '2026-01-01T00:00:00Z');
        expect(stamped).toBe(true);

        const updated = listTodos(project, { includeCompleted: true }).find((t) => t.id === epic.id);
        expect(updated?.landedAt).not.toBeNull();

        // No violations of the new kind
        const todos = listTodos(project, { includeCompleted: true });
        const violations = findViolations(todos);
        const liveChildViolations = violations.filter((v) => v.kind === 'live-child-under-terminal-epic');
        expect(liveChildViolations).toHaveLength(0);
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('Control: open epic with live child', () => {
    it('open epic (no landedAt) with planned child → zero violations of new kind', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Open Control',
          kind: 'epic',
        });
        const child = await createTodo(project, {
          ownerSession: 'test',
          title: 'planned child',
          kind: 'leaf',
          parentId: epic.id,
          status: 'planned',
        });

        const todos = listTodos(project, { includeCompleted: true });
        const violations = findViolations(todos);
        const liveChildViolations = violations.filter((v) => v.kind === 'live-child-under-terminal-epic');

        // Live child under live epic is normal, should not be flagged
        expect(liveChildViolations).toHaveLength(0);
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('Mutation probe: hand-orphan live child under terminal epic', () => {
    it('direct DB update orphans live child under done epic → violation detected', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Mutation Probe',
          kind: 'epic',
        });
        const child = await createTodo(project, {
          ownerSession: 'test',
          title: 'orphaned child',
          kind: 'leaf',
          parentId: epic.id,
        });

        // Mark epic done and child planned (simulating a manual DB corruption)
        const db = openDb(project);
        db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
          .run('done', 'accepted', epic.id);
        db.prepare('UPDATE todos SET status = ? WHERE id = ?')
          .run('planned', child.id);
        _closeProject(project);

        const todos = listTodos(project, { includeCompleted: true });
        const violations = findViolations(todos);
        const liveChildViolations = violations.filter((v) => v.kind === 'live-child-under-terminal-epic');

        expect(liveChildViolations).toHaveLength(1);
        expect(liveChildViolations[0]!.todoId).toBe(child.id);
        expect(liveChildViolations[0]!.reason).toContain('child of terminal epic');
      } finally {
        _closeProject(project);
      }
    });

    it('direct DB update orphans live child under landed epic → violation detected', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Mutation Landed Probe',
          kind: 'epic',
        });
        const child = await createTodo(project, {
          ownerSession: 'test',
          title: 'orphaned under landed',
          kind: 'leaf',
          parentId: epic.id,
        });

        // Stamp landedAt and leave child in_progress (mutation probe)
        const db = openDb(project);
        db.prepare('UPDATE todos SET landedAt = ? WHERE id = ?')
          .run('2026-01-01T00:00:00Z', epic.id);
        db.prepare('UPDATE todos SET status = ? WHERE id = ?')
          .run('in_progress', child.id);
        _closeProject(project);

        const todos = listTodos(project, { includeCompleted: true });
        const violations = findViolations(todos);
        const liveChildViolations = violations.filter((v) => v.kind === 'live-child-under-terminal-epic');

        expect(liveChildViolations).toHaveLength(1);
        expect(liveChildViolations[0]!.todoId).toBe(child.id);
      } finally {
        _closeProject(project);
      }
    });
  });
});
