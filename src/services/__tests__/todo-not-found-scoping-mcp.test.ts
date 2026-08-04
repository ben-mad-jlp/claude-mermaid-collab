// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  _closeProject,
} from '../todo-store';
import { projectRegistry } from '../project-registry';
import { handleEpicTool } from '../../mcp/epic-tools.js';

let dataDir: string;
let projectA: string;
let projectB: string;

beforeEach(() => {
  // Create a temp data directory and set it as the registry location
  dataDir = mkdtempSync(join(tmpdir(), 'todo-not-found-mcp-'));
  process.env.MERMAID_DATA_DIR = dataDir;

  // Create two project directories with .collab subdirs
  projectA = join(dataDir, 'project-a');
  projectB = join(dataDir, 'project-b');
  mkdirSync(join(projectA, '.collab'), { recursive: true });
  mkdirSync(join(projectB, '.collab'), { recursive: true });
});

afterEach(() => {
  _closeProject(projectA);
  _closeProject(projectB);
  delete process.env.MERMAID_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('handleEpicTool MCP: scoped todo-not-found messages', () => {
  test('get_todo rejects with the scoped cross-project message and still resolves for the owning project', async () => {
    // Create a todo in project A
    const todoA = await createTodo(projectA, {
      allowOrphan: true,
      ownerSession: 'test-session',
      title: 'Test TODO',
    });
    const id = todoA.id;

    // Register both projects
    await projectRegistry.register(projectA);
    await projectRegistry.register(projectB);

    // get_todo(B, id) should reject with cross-project message
    try {
      await handleEpicTool('get_todo', { project: projectB, todoId: id });
      throw new Error('Expected get_todo to reject for cross-project todo');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(`in project ${projectB}`);
      expect(msg).toContain(`it exists in ${projectA}`);
      expect(msg).toContain(`pass project=${projectA}`);
    }

    // get_todo(A, id) should resolve to the todo view
    const result = await handleEpicTool('get_todo', { project: projectA, todoId: id });
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!);
    expect(parsed).toHaveProperty('id');
    expect(parsed.id).toBe(id);
  });

  test('leaf_inspect rejects with the scoped cross-project message when scoped, and preserves ran:false for a real never-run leaf and an unscoped unknown id', async () => {
    // Create a todo in project A
    const todoA = await createTodo(projectA, {
      allowOrphan: true,
      ownerSession: 'test-session',
      title: 'Test TODO',
    });
    const id = todoA.id;

    // Register both projects
    await projectRegistry.register(projectA);
    await projectRegistry.register(projectB);

    // leaf_inspect(B, id) should reject with cross-project message
    try {
      await handleEpicTool('leaf_inspect', { project: projectB, leafId: id });
      throw new Error('Expected leaf_inspect to reject for cross-project todo');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(`in project ${projectB}`);
      expect(msg).toContain(`it exists in ${projectA}`);
      expect(msg).toContain(`pass project=${projectA}`);
    }

    // leaf_inspect(A, id) should resolve to {ran: false} for a real never-run leaf
    const result1 = await handleEpicTool('leaf_inspect', { project: projectA, leafId: id });
    expect(result1).toBeTruthy();
    const parsed1 = JSON.parse(result1!);
    expect(parsed1).toEqual({ ran: false, leafId: id });

    // leaf_inspect(no project, unknown id) should resolve to {ran: false} as today
    const result2 = await handleEpicTool('leaf_inspect', { leafId: 'nope' });
    expect(result2).toBeTruthy();
    const parsed2 = JSON.parse(result2!);
    expect(parsed2).toEqual({ ran: false, leafId: 'nope' });
  });
});
