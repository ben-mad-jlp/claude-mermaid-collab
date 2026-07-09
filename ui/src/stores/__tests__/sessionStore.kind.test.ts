import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../sessionStore';
import type { SessionTodo } from '../../types/sessionTodo';

describe('useSessionStore — todo `kind` field (decision e852fb0c, stage A)', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  const createMockSessionTodo = (overrides?: Partial<SessionTodo>): SessionTodo => ({
    id: 'todo-1',
    ownerSession: 'test-session',
    assigneeSession: null,
    title: '[EPIC] Test epic',
    description: null,
    status: 'todo',
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    asanaGid: null,
    ...overrides,
  });

  it('survives setSessionTodos into the store unchanged', () => {
    const todo = createMockSessionTodo({ kind: 'epic' });
    useSessionStore.getState().setSessionTodos([todo]);
    expect(useSessionStore.getState().sessionTodos[0].kind).toBe('epic');
  });

  it('survives upsertSessionTodo into the store unchanged', () => {
    const todo = createMockSessionTodo({ id: 'todo-2', title: '[MISSION] Test mission', kind: 'mission' });
    useSessionStore.getState().upsertSessionTodo(todo);
    expect(useSessionStore.getState().sessionTodos[0].kind).toBe('mission');
  });
});
