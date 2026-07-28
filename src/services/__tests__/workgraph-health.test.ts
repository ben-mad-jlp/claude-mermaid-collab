/**
 * Workgraph health computation test.
 *
 * Tests that computeWorkgraphHealth correctly identifies:
 * - orphan leaves (no parent, parent-is-mission, parent-is-terminal-epic)
 * - terminal epics with open children
 * - accurate child status counts per epic
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-workgraph-health-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import type { Todo } from '../todo-store';
import {
  createTodo,
  listTodos,
  openDb,
  _closeProject,
} from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { computeWorkgraphHealth } from '../workgraph-health';

const todoBase = mkdtempSync(join(tmpdir(), 'workgraph-health-todos-'));
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

describe('workgraph-health', () => {
  describe('epicChildCounts', () => {
    it('healthy control epic: 2 done+accepted children counts correctly', async () => {
      const project = freshProject();
      try {
        // Create a healthy epic (no landedAt, status='planned') with 2 done+accepted children
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Healthy Control',
          kind: 'epic',
        });
        const child1 = await createTodo(project, {
          ownerSession: 'test',
          title: 'child 1',
          kind: 'leaf',
          parentId: epic.id,
        });
        const child2 = await createTodo(project, {
          ownerSession: 'test',
          title: 'child 2',
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

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        // Find the epic in epicChildCounts
        const epicEntry = health.epicChildCounts.find((e) => e.epicId === epic.id);
        expect(epicEntry).toBeDefined();
        expect(epicEntry!.total).toBe(2);
        expect(epicEntry!.counts.done).toBe(2);
        expect(epicEntry!.counts.dropped).toBe(0);
        expect(epicEntry!.landed).toBe(false);
        expect(epicEntry!.terminal).toBe(false);
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('terminalEpicsWithOpenChildren', () => {
    it('terminal epic with exactly 1 open child is reported', async () => {
      const project = freshProject();
      try {
        // Create a terminal epic (landedAt stamped)
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Terminal with Open',
          kind: 'epic',
        });
        // One done child
        const doneChild = await createTodo(project, {
          ownerSession: 'test',
          title: 'done child',
          kind: 'leaf',
          parentId: epic.id,
        });
        // One open (planned) child — this is the problem we report
        const openChild = await createTodo(project, {
          ownerSession: 'test',
          title: 'open planned child',
          kind: 'leaf',
          parentId: epic.id,
          status: 'planned',
        });

        // Stamp landedAt on the epic and mark done child as done+accepted
        const db = openDb(project);
        db.prepare('UPDATE todos SET landedAt = ? WHERE id = ?')
          .run('2026-01-01T00:00:00Z', epic.id);
        db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
          .run('done', 'accepted', doneChild.id);
        _closeProject(project);

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        expect(health.terminalEpicsWithOpenChildren).toHaveLength(1);
        const entry = health.terminalEpicsWithOpenChildren[0]!;
        expect(entry.epicId).toBe(epic.id);
        expect(entry.openChildren).toHaveLength(1);
        expect(entry.openChildren[0]!.todoId).toBe(openChild.id);
        expect(entry.openChildren[0]!.status).toBe('planned');
      } finally {
        _closeProject(project);
      }
    });

    it('terminal epic with zero open children is not reported', async () => {
      const project = freshProject();
      try {
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Terminal Clean',
          kind: 'epic',
        });
        const child = await createTodo(project, {
          ownerSession: 'test',
          title: 'done child',
          kind: 'leaf',
          parentId: epic.id,
        });

        // Stamp landedAt and mark child done+accepted
        const db = openDb(project);
        db.prepare('UPDATE todos SET landedAt = ? WHERE id = ?')
          .run('2026-01-01T00:00:00Z', epic.id);
        db.prepare('UPDATE todos SET status = ?, acceptanceStatus = ? WHERE id = ?')
          .run('done', 'accepted', child.id);
        _closeProject(project);

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        // This epic should NOT appear in terminalEpicsWithOpenChildren
        const entry = health.terminalEpicsWithOpenChildren.find((e) => e.epicId === epic.id);
        expect(entry).toBeUndefined();
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('orphanLeaves', () => {
    it('leaf with null parentId is reported as orphan', async () => {
      const project = freshProject();
      try {
        // Create a leaf with no parent (using allowOrphan escape hatch)
        const orphan = await createTodo(project, {
          ownerSession: 'test',
          title: 'orphan leaf',
          kind: 'leaf',
          allowOrphan: true,
        });

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        expect(health.orphanLeaves).toHaveLength(1);
        const entry = health.orphanLeaves[0]!;
        expect(entry.todoId).toBe(orphan.id);
        expect(entry.reason).toBe('missing-parent');
        expect(entry.parentId).toBe(null);
      } finally {
        _closeProject(project);
      }
    });

    it('leaf under a mission is reported as orphan', async () => {
      const project = freshProject();
      try {
        // Create a mission
        const mission = await createTodo(project, {
          ownerSession: 'test',
          title: 'Test Mission',
          kind: 'mission',
        });
        // Create a leaf directly under the mission
        const leaf = await createTodo(project, {
          ownerSession: 'test',
          title: 'leaf under mission',
          kind: 'leaf',
          parentId: mission.id,
        });

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        const orphanEntry = health.orphanLeaves.find((o) => o.todoId === leaf.id);
        expect(orphanEntry).toBeDefined();
        expect(orphanEntry!.reason).toBe('parent-is-mission');
        expect(orphanEntry!.parentId).toBe(mission.id);
      } finally {
        _closeProject(project);
      }
    });

    it('leaf under a terminal epic is reported as orphan', async () => {
      const project = freshProject();
      try {
        // Create a terminal epic (landedAt stamped, status done)
        const terminalEpic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Terminal',
          kind: 'epic',
        });
        // Create a live leaf under it
        const leaf = await createTodo(project, {
          ownerSession: 'test',
          title: 'leaf under terminal epic',
          kind: 'leaf',
          parentId: terminalEpic.id,
          status: 'planned',
        });

        // Stamp the epic as terminal (landedAt)
        const db = openDb(project);
        db.prepare('UPDATE todos SET landedAt = ? WHERE id = ?')
          .run('2026-01-01T00:00:00Z', terminalEpic.id);
        _closeProject(project);

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        const orphanEntry = health.orphanLeaves.find((o) => o.todoId === leaf.id);
        expect(orphanEntry).toBeDefined();
        expect(orphanEntry!.reason).toBe('parent-is-terminal-epic');
        expect(orphanEntry!.parentId).toBe(terminalEpic.id);
      } finally {
        _closeProject(project);
      }
    });

    it('terminal leaf (done/dropped) is not reported as orphan', async () => {
      const project = freshProject();
      try {
        // Create a done leaf with no parent (using allowOrphan escape hatch)
        const doneOrphan = await createTodo(project, {
          ownerSession: 'test',
          title: 'done orphan',
          kind: 'leaf',
          status: 'done',
          allowOrphan: true,
        });
        // Set acceptanceStatus to accepted
        const db = openDb(project);
        db.prepare('UPDATE todos SET acceptanceStatus = ? WHERE id = ?')
          .run('accepted', doneOrphan.id);
        _closeProject(project);

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        const orphanEntry = health.orphanLeaves.find((o) => o.todoId === doneOrphan.id);
        expect(orphanEntry).toBeUndefined();
      } finally {
        _closeProject(project);
      }
    })

    it('leaf under live epic is not reported as orphan', async () => {
      const project = freshProject();
      try {
        // Create a live (non-terminal) epic
        const liveEpic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Live',
          kind: 'epic',
        });
        // Create a planned leaf under it
        const leaf = await createTodo(project, {
          ownerSession: 'test',
          title: 'child of live epic',
          kind: 'leaf',
          parentId: liveEpic.id,
          status: 'planned',
        });

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        const orphanEntry = health.orphanLeaves.find((o) => o.todoId === leaf.id);
        expect(orphanEntry).toBeUndefined();
      } finally {
        _closeProject(project);
      }
    });
  });

  describe('baseline consistency', () => {
    it('epicChildCounts deep-equals a direct computation from listTodos', async () => {
      const project = freshProject();
      try {
        // Create an epic with children in various statuses
        const epic = await createTodo(project, {
          ownerSession: 'test',
          title: '[EPIC] Baseline Test',
          kind: 'epic',
        });
        await createTodo(project, {
          ownerSession: 'test',
          title: 'child1 - backlog',
          kind: 'leaf',
          parentId: epic.id,
          status: 'backlog',
        });
        await createTodo(project, {
          ownerSession: 'test',
          title: 'child2 - planned',
          kind: 'leaf',
          parentId: epic.id,
          status: 'planned',
        });
        await createTodo(project, {
          ownerSession: 'test',
          title: 'child3 - todo',
          kind: 'leaf',
          parentId: epic.id,
          status: 'todo',
        });

        const todos = listTodos(project, { includeCompleted: true });
        const health = computeWorkgraphHealth(todos);

        // Compute baseline directly
        const epicEntry = health.epicChildCounts.find((e) => e.epicId === epic.id);
        const directChildren = todos.filter((t) => t.parentId === epic.id);
        const directCounts = {
          backlog: directChildren.filter((c) => c.status === 'backlog').length,
          planned: directChildren.filter((c) => c.status === 'planned').length,
          todo: directChildren.filter((c) => c.status === 'todo').length,
          ready: directChildren.filter((c) => c.status === 'ready').length,
          in_progress: directChildren.filter((c) => c.status === 'in_progress').length,
          blocked: directChildren.filter((c) => c.status === 'blocked').length,
          done: directChildren.filter((c) => c.status === 'done').length,
          dropped: directChildren.filter((c) => c.status === 'dropped').length,
        };

        expect(epicEntry!.counts).toEqual(directCounts);
        expect(epicEntry!.total).toBe(directChildren.length);
      } finally {
        _closeProject(project);
      }
    });
  });
});
