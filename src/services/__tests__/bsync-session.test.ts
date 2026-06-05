import { describe, it, expect } from 'bun:test';
import {
  deriveBsyncSessionId,
  isCadTodo,
  bsyncSessionContextNote,
  BSYNC_SESSION_PREFIX,
} from '../bsync-session';

const P = '/Users/x/Code/build123d-ocp-mcp';

describe('deriveBsyncSessionId', () => {
  it('is stable: same (project, session, todo) → same id (resume reattaches)', () => {
    const a = deriveBsyncSessionId(P, 'general-1', 'todo-123');
    const b = deriveBsyncSessionId(P, 'general-1', 'todo-123');
    expect(a).toBe(b);
  });

  it('is collab-prefixed and not bsync\'s shared "default"', () => {
    const id = deriveBsyncSessionId(P, 'general-1', 'todo-123');
    expect(id.startsWith(BSYNC_SESSION_PREFIX)).toBe(true);
    expect(id).not.toBe('default');
    // collab- + 16 hex chars
    expect(id).toMatch(/^collab-[0-9a-f]{16}$/);
  });

  it('is unique across todos in the SAME lane (no stomp for sequential work)', () => {
    const a = deriveBsyncSessionId(P, 'general-1', 'todo-a');
    const b = deriveBsyncSessionId(P, 'general-1', 'todo-b');
    expect(a).not.toBe(b);
  });

  it('is unique across concurrent lanes for the same todo id', () => {
    const a = deriveBsyncSessionId(P, 'general-1', 'todo-123');
    const b = deriveBsyncSessionId(P, 'general-2', 'todo-123');
    expect(a).not.toBe(b);
  });

  it('is unique across projects', () => {
    const a = deriveBsyncSessionId('/proj/a', 'general-1', 'todo-123');
    const b = deriveBsyncSessionId('/proj/b', 'general-1', 'todo-123');
    expect(a).not.toBe(b);
  });

  it('does not collide when triple components shift across the delimiter', () => {
    // "a","b","c" vs "a\nb","","c"-style ambiguity is avoided by the \n joiner.
    const a = deriveBsyncSessionId('a', 'b', 'c');
    const b = deriveBsyncSessionId('a\nb', '', 'c');
    expect(a).not.toBe(b);
  });
});

describe('isCadTodo', () => {
  it('is true only for type === "cad"', () => {
    expect(isCadTodo({ type: 'cad' })).toBe(true);
    expect(isCadTodo({ type: 'backend' })).toBe(false);
    expect(isCadTodo({ type: null })).toBe(false);
  });
});

describe('bsyncSessionContextNote', () => {
  it('embeds the id and tells the worker to pass session_id on every call', () => {
    const note = bsyncSessionContextNote('collab-deadbeefdeadbeef');
    expect(note).toContain('collab-deadbeefdeadbeef');
    expect(note).toContain('session_id=');
    // must steer the worker off the shared default session
    expect(note.toLowerCase()).toContain('never use the default');
  });
});
