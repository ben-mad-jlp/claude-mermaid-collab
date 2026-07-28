/**
 * Regression test for the 'open-children' land blocker: an epic with an open
 * (not done+dropped) direct child must not roll up to 'done' via sweepEpicRollups,
 * and landReadiness must surface a blocker naming the open child — both flip green
 * once that child is done+accepted.
 *
 * Mirrors the epic-close-single-site.test.ts harness: isolate MERMAID_SUPERVISOR_DIR
 * before importing the store, use a temp dir as the project, _closeProject in
 * lifecycle hooks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the global supervisor.db BEFORE any store module is imported.
const supervisorDir = mkdtempSync(join(tmpdir(), 'sup-open-children-'));
process.env.MERMAID_SUPERVISOR_DIR = supervisorDir;

import { createTodo, completeTodo, listTodos, sweepEpicRollups, _closeProject } from '../todo-store';
import { _closeDb as _closeSupervisorDb } from '../supervisor-store';
import { landReadiness, type LandProbes } from '../land-authority';

const todoBase = mkdtempSync(join(tmpdir(), 'open-children-todos-'));
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

const GREEN_PROBES: LandProbes = {
  presence: (project, epicId) => ({
    project,
    epicId,
    epicBranch: 'epic-branch',
    blocking: false,
    findings: [],
    exemptions: [],
    duplicateCommits: [],
    checked: 0,
  }),
  merge: () => ({ tscClean: true, mergeClean: true }),
  gate: async () => ({
    status: 'pass',
    declared: false,
    manifestPath: '',
    units: [],
    regressions: [],
    inherited: [],
    incidents: [],
    reasons: [],
    specFiles: [],
    epicTipSha: null,
    baseSha: null,
  }),
  worktreeCwd: (project) => project,
};

describe('open-children land blocker', () => {
  it('blocks rollup and landReadiness while a child is open, then flips green once accepted', async () => {
    const project = freshProject();
    try {
      const epic = await createTodo(project, {
        ownerSession: 'test',
        title: '[EPIC] Open Children Test',
        kind: 'epic',
      });
      const childA = await createTodo(project, {
        ownerSession: 'test',
        title: 'child A',
        kind: 'leaf',
        parentId: epic.id,
      });
      const childB = await createTodo(project, {
        ownerSession: 'test',
        title: 'child B',
        kind: 'leaf',
        parentId: epic.id,
      });

      await completeTodo(project, childA.id, 'accepted');

      // (a) rollup: epic must NOT close while childB is still open (planned)
      const sweepBefore = await sweepEpicRollups(project);
      const epicBefore = listTodos(project, { includeCompleted: true }).find((t) => t.id === epic.id);
      expect(epicBefore?.status).not.toBe('done');
      expect(sweepBefore.rolledUp).not.toContain(epic.id);

      // (b) landReadiness surfaces the open-children blocker naming childB
      const allTodosBefore = listTodos(project, { includeCompleted: true });
      const readinessBefore = await landReadiness(project, epic.id, {
        todos: allTodosBefore,
        probes: GREEN_PROBES,
      });
      expect(readinessBefore.green).toBe(false);
      const blockerBefore = readinessBefore.blockers.find((b) => b.code === 'open-children');
      expect(blockerBefore).toBeDefined();
      expect(blockerBefore?.message).toContain(childB.id.slice(0, 8));

      // Now close out childB
      await completeTodo(project, childB.id, 'accepted');

      // (a') the epic is now closed (completeTodo on the last child closes it directly;
      // sweepEpicRollups is idempotent on an already-closed epic)
      await sweepEpicRollups(project);
      const epicAfter = listTodos(project, { includeCompleted: true }).find((t) => t.id === epic.id);
      expect(epicAfter?.status).toBe('done');

      // (b') landReadiness no longer has an open-children blocker
      const allTodosAfter = listTodos(project, { includeCompleted: true });
      const readinessAfter = await landReadiness(project, epic.id, {
        todos: allTodosAfter,
        probes: GREEN_PROBES,
      });
      expect(readinessAfter.blockers.find((b) => b.code === 'open-children')).toBeUndefined();
    } finally {
      _closeProject(project);
    }
  });
});
