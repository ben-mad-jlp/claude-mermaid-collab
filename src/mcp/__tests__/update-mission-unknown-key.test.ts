import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTodo, _closeProject } from '../../services/todo-store.js';
import { getMission, _resetMissionDbCache } from '../../services/mission-store.js';
import { handleMissionTool } from '../mission-tools.js';
import { _closeDb as closeSupervisorDb } from '../../services/supervisor-store.js';

let project: string;
const session = 'test-session-123';
let missionTodoId: string;

beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'update-mission-unknown-key-'));
  process.env.MERMAID_SUPERVISOR_DIR = project;

  // Import addSessionTodo to create a mission node
  const { addSessionTodo } = await import('../tools/session-todos.js');
  const missionNode = await addSessionTodo(project, session, 'Original title', undefined, { kind: 'mission' });
  missionTodoId = missionNode.id;
});

afterEach(() => {
  _resetMissionDbCache(project);
  _closeProject(project);
  closeSupervisorDb();
  delete process.env.MERMAID_SUPERVISOR_DIR;
  rmSync(project, { recursive: true, force: true });
});

describe('update_mission unknown key validation', () => {
  test('rejects an undeclared argument key and performs no write', async () => {
    // Capture initial state
    const initialTodo = getTodo(project, missionTodoId)!;
    const initialTitle = initialTodo.title;
    const initialMission = getMission(project, missionTodoId);
    const initialAbandonedAt = initialMission?.abandonedAt ?? null;
    const initialBudgetUsd = initialMission?.budgetUsd ?? null;

    // Call with an undeclared key (bogusKey)
    const result = await handleMissionTool('update_mission', {
      project,
      todoId: missionTodoId,
      title: 'new title',
      bogusKey: 'x',
    });

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);

    // Verify the error response
    expect(parsed.error).toContain('bogusKey');
    expect(parsed.unknownKey).toBe('bogusKey');

    // Verify that the mission row was NOT modified
    const todoAfter = getTodo(project, missionTodoId)!;
    expect(todoAfter.title).toBe(initialTitle); // title should be unchanged
    const missionAfter = getMission(project, missionTodoId);
    expect(missionAfter?.abandonedAt ?? null).toBe(initialAbandonedAt ?? null);
    expect(missionAfter?.budgetUsd ?? null).toBe(initialBudgetUsd ?? null);
  });

  test('applies an update whose keys are all declared', async () => {
    // Call with only declared keys (no bogusKey)
    const result = await handleMissionTool('update_mission', {
      project,
      todoId: missionTodoId,
      title: 'new title',
    });

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);

    // Verify the response contains the updated title
    expect(parsed.title).toBe('new title');

    // Verify the mission was actually updated
    const todoAfter = getTodo(project, missionTodoId)!;
    expect(todoAfter.title).toBe('new title');
  });
});
