// Real-store proof that raiseBaseRepairEpic (with no io override) leaves its repair
// leaf claimable: the 'ready' status write on the epic must flow through
// translateStatusWrite's approval seam, releasing the epic ancestor gate. A mutation
// probe (updateTodo stubbed to a no-op) proves the assertion is non-vacuous.
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { raiseBaseRepairEpic } from '../base-repair-epic';
import { getTodo, listTodos, _closeProject, type Todo } from '../todo-store';
import { claimReason } from '../claimability';

const projects: string[] = [];

function newProject(): string {
  const project = mkdtempSync(join(tmpdir(), 'base-repair-claimable-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;
  projects.push(project);
  return project;
}

afterEach(() => {
  while (projects.length > 0) {
    const project = projects.pop()!;
    _closeProject(project);
    rmSync(project, { recursive: true, force: true });
  }
  delete process.env.MERMAID_SUPERVISOR_DIR;
});

function byIdMap(todos: Todo[]): Map<string, Todo> {
  const byId = new Map<string, Todo>();
  for (const t of todos) byId.set(t.id, t);
  return byId;
}

test('raiseBaseRepairEpic against real store IO approves the epic and leaves its leaf claimable', async () => {
  const project = newProject();

  const result = await raiseBaseRepairEpic({
    project,
    session: 's1',
    epicId: 'aaaaaaaa1111',
    targetProject: project,
    laneSignature: 'bbbbbbbb2222',
    cause: 'epic-base-red',
    reasonTail: 'red base detail',
    epicBranch: 'epic-under-test',
  });

  expect(result.created).toBe(true);
  const epic = getTodo(project, result.epicId!)!;
  expect(epic).toBeTruthy();
  expect(typeof epic.approvedAt).toBe('string');
  expect(epic.approvedAt).not.toBeNull();

  const todos = listTodos(project, { includeCompleted: true });
  const byId = byIdMap(todos);
  const leaves = todos.filter((t) => t.parentId === epic.id);
  expect(leaves.length).toBe(1);
  const leaf = leaves[0];

  expect(claimReason(leaf, byId)).toBe('claimable');
});

test('with the release call stubbed to a no-op, the leaf reports parent-unreleased', async () => {
  const project = newProject();

  const result = await raiseBaseRepairEpic(
    {
      project,
      session: 's1',
      epicId: 'cccccccc3333',
      targetProject: project,
      laneSignature: 'dddddddd4444',
      cause: 'epic-base-red',
      reasonTail: 'red base detail',
      epicBranch: 'epic-under-test',
    },
    { updateTodo: async () => ({} as any) },
  );

  expect(result.created).toBe(true);
  const epic = getTodo(project, result.epicId!)!;
  expect(epic).toBeTruthy();

  const todos = listTodos(project, { includeCompleted: true });
  const byId = byIdMap(todos);
  const leaves = todos.filter((t) => t.parentId === epic.id);
  expect(leaves.length).toBe(1);
  const leaf = leaves[0];

  expect(claimReason(leaf, byId)).toBe('parent-unreleased');
});
