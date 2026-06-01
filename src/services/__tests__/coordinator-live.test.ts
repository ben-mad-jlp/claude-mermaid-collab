import { describe, it, expect, afterEach } from 'bun:test';
import { makeCoordinatorDeps, startCoordinator, stopCoordinator, isCoordinatorRunning, resolveWorkerProfile } from '../coordinator-live';
import type { Todo } from '../todo-store';

describe('makeCoordinatorDeps', () => {
  it('returns an object with all required function properties', () => {
    const deps = makeCoordinatorDeps();
    expect(typeof deps.listReadyTodos).toBe('function');
    expect(typeof deps.claimTodo).toBe('function');
    expect(typeof deps.releaseExpiredClaims).toBe('function');
    expect(typeof deps.completeTodo).toBe('function');
    expect(typeof deps.launchWorker).toBe('function');
  });
});

describe('resolveWorkerProfile', () => {
  it('makes the worker autonomous: invokeSkill targets the worker skill with the todo id', () => {
    const todo = { id: 'abc12345-dead-beef-0000-000000000000' } as Todo;
    const profile = resolveWorkerProfile(todo);
    expect(profile.invokeSkill).toBe(`/mermaid-collab:worker ${todo.id}`);
    expect(profile.allowedTools).toContain('mcp__plugin_mermaid-collab_mermaid');
  });
});

describe('startCoordinator / stopCoordinator / isCoordinatorRunning', () => {
  const PROJECT = 'test-coordinator-live-a';

  afterEach(() => {
    stopCoordinator(PROJECT);
  });

  it('starts and returns true; isCoordinatorRunning is true', () => {
    expect(startCoordinator(PROJECT, 3_600_000)).toBe(true);
    expect(isCoordinatorRunning(PROJECT)).toBe(true);
  });

  it('starting again returns false (already running)', () => {
    startCoordinator(PROJECT, 3_600_000);
    expect(startCoordinator(PROJECT, 3_600_000)).toBe(false);
  });

  it('stopCoordinator returns true and isCoordinatorRunning becomes false', () => {
    startCoordinator(PROJECT, 3_600_000);
    expect(stopCoordinator(PROJECT)).toBe(true);
    expect(isCoordinatorRunning(PROJECT)).toBe(false);
  });

  it('stopCoordinator returns false when not running', () => {
    expect(stopCoordinator(PROJECT)).toBe(false);
  });
});
