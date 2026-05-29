import { describe, it, expect } from 'vitest';
import { shouldRefetchTodos, type TodoUpdatedEvent } from './todoEvents';

const ctx = { project: '/repo', session: 'me' };
const base: TodoUpdatedEvent = { type: 'session_todos_updated', project: '/repo', session: 'other' };

describe('shouldRefetchTodos', () => {
  it('true when the event session is mine (direct)', () => {
    expect(shouldRefetchTodos({ ...base, session: 'me' }, ctx)).toBe(true);
  });
  it('true when ownerSession is mine', () => {
    expect(shouldRefetchTodos({ ...base, ownerSession: 'me' }, ctx)).toBe(true);
  });
  it('true when assigneeSession is mine (cross-session assignment)', () => {
    expect(shouldRefetchTodos({ ...base, assigneeSession: 'me' }, ctx)).toBe(true);
  });
  it('true when previousAssigneeSession is mine (reassigned away from me)', () => {
    expect(shouldRefetchTodos({ ...base, assigneeSession: 'someone-else', previousAssigneeSession: 'me' }, ctx)).toBe(true);
  });
  it('false when project differs', () => {
    expect(shouldRefetchTodos({ ...base, project: '/other', session: 'me', ownerSession: 'me', assigneeSession: 'me' }, ctx)).toBe(false);
  });
  it('false when not involved', () => {
    expect(shouldRefetchTodos({ ...base, ownerSession: 'x', assigneeSession: 'y' }, ctx)).toBe(false);
  });
});
