// Runs via `bun test` (uses bun:sqlite) — excluded from vitest (Node) in vitest.config.ts.
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createTodo,
  updateTodo,
  resetTodo,
  completeTodo,
  removeTodo,
  _closeProject,
} from '../todo-store';
import { projectRegistry } from '../project-registry';

let dataDir: string;
let projectA: string;
let projectB: string;

beforeEach(() => {
  // Create a temp data directory and set it as the registry location
  dataDir = mkdtempSync(join(tmpdir(), 'todo-not-found-'));
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

describe('todoNotFoundMessage: cross-project resolver', () => {
  test('updateTodo(B, id) rejects naming project A as the hit', async () => {
    // Create a todo in project A
    const todoA = await createTodo(projectA, {
      allowOrphan: true,
      ownerSession: 'test-session',
      title: 'Test TODO',
    });
    const id = todoA.id;

    // Register both projects so listRegisteredProjectPathsSync can find them
    await projectRegistry.register(projectA);
    await projectRegistry.register(projectB);

    // updateTodo(B, id) should fail with a message naming A as the hit
    const err = await updateTodo(projectB, id, { title: 'Updated' }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain(`todo not found: ${id}`);
    expect(msg).toContain(`in project ${projectB}`);
    expect(msg).toContain(`it exists in ${projectA}`);
    expect(msg).toContain(`pass project=${projectA}`);
  });

  test('resetTodo(B, id) rejects naming project A as the hit', async () => {
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

    // resetTodo(B, id) should fail with a message naming A as the hit
    const err = await resetTodo(projectB, id).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain(`todo not found: ${id}`);
    expect(msg).toContain(`in project ${projectB}`);
    expect(msg).toContain(`it exists in ${projectA}`);
    expect(msg).toContain(`pass project=${projectA}`);
  });

  test('completeTodo(B, id) rejects naming project A as the hit', async () => {
    // Create a todo in project A and move it to a claimable state
    const todoA = await createTodo(projectA, {
      allowOrphan: true,
      ownerSession: 'test-session',
      title: 'Test TODO',
    });
    const id = todoA.id;

    // Register both projects
    await projectRegistry.register(projectA);
    await projectRegistry.register(projectB);

    // completeTodo(B, id) should fail with a message naming A as the hit
    const err = await completeTodo(projectB, id).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain(`todo not found: ${id}`);
    expect(msg).toContain(`in project ${projectB}`);
    expect(msg).toContain(`it exists in ${projectA}`);
    expect(msg).toContain(`pass project=${projectA}`);
  });

  test('updateTodo(A, id) resolves for full id and short id without a registry probe', async () => {
    // Create a todo in project A
    const todoA = await createTodo(projectA, {
      allowOrphan: true,
      ownerSession: 'test-session',
      title: 'Test TODO',
    });
    const id = todoA.id;
    const shortId = id.slice(0, 8);

    // Register projects (so list doesn't error, but shouldn't probe on happy path)
    await projectRegistry.register(projectA);
    await projectRegistry.register(projectB);

    // updateTodo(A, id) should succeed for full id
    const result1 = await updateTodo(projectA, id, { title: 'Updated Full' });
    expect(result1.title).toBe('Updated Full');

    // updateTodo(A, shortId) should succeed for short id
    const result2 = await updateTodo(projectA, shortId, { title: 'Updated Short' });
    expect(result2.title).toBe('Updated Short');
  });

  test('id absent from every registered project rejects naming B with no it-exists-in clause', async () => {
    // Register both projects
    await projectRegistry.register(projectA);
    await projectRegistry.register(projectB);

    // Try to update a non-existent id
    const fakeId = '12345678-abcd-ef00-0000-000000000000';
    const err = await updateTodo(projectB, fakeId, { title: 'Updated' }).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain(`todo not found: ${fakeId}`);
    expect(msg).toContain(`in project ${projectB}`);
    expect(msg).not.toContain(`it exists in`);
  });
});
