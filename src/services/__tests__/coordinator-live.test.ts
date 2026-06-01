import { describe, it, expect, afterEach } from 'bun:test';
import { makeCoordinatorDeps, startCoordinator, stopCoordinator, isCoordinatorRunning } from '../coordinator-live';

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
