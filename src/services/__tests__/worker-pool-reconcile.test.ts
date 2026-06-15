/**
 * P3 (fe153cdd): the pure worker-pool restart-reconcile primitives —
 * parsePoolSessionName (inverse of poolSessionName) and restoreBusySlot.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  parsePoolSessionName,
  restoreBusySlot,
  poolSessionName,
  listPool,
  resetPool,
} from '../worker-pool.ts';

describe('parsePoolSessionName (inverse of poolSessionName)', () => {
  it('round-trips a default claude lane', () => {
    expect(parsePoolSessionName('backend-claude-1')).toEqual({ type: 'backend', provider: 'claude', slot: 1 });
    expect(parsePoolSessionName(poolSessionName('frontend', 'claude', 3))).toEqual({ type: 'frontend', provider: 'claude', slot: 3 });
  });

  it('handles a hyphenated provider (grok-build)', () => {
    expect(parsePoolSessionName('backend-grok-build-1')).toEqual({ type: 'backend', provider: 'grok-build', slot: 1 });
    expect(parsePoolSessionName(poolSessionName('cad', 'grok-build' as any, 2))).toEqual({ type: 'cad', provider: 'grok-build', slot: 2 });
  });

  it('rejects non-pool names (unknown type, no slot, too few parts)', () => {
    expect(parsePoolSessionName('planner')).toBeNull();
    expect(parsePoolSessionName('steward-claude')).toBeNull(); // unknown type 'steward' + no numeric slot
    expect(parsePoolSessionName('backend-claude-x')).toBeNull(); // non-numeric slot
    expect(parsePoolSessionName('backend-claude-0')).toBeNull(); // slot must be >= 1
  });
});

describe('restoreBusySlot', () => {
  beforeEach(() => resetPool());

  it('rebuilds a busy slot from a live session + claimed todo', () => {
    const slot = restoreBusySlot('/proj', 'backend-claude-1', 'todo-123', 'mc-proj-backendclaude1');
    expect(slot).not.toBeNull();
    expect(slot!).toMatchObject({
      project: '/proj',
      type: 'backend',
      provider: 'claude',
      slot: 1,
      status: 'busy',
      currentTodoId: 'todo-123',
      tmux: 'mc-proj-backendclaude1',
    });
    const pool = listPool();
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ sessionName: 'backend-claude-1', status: 'busy' });
  });

  it('is idempotent (re-restoring overwrites, no duplicate)', () => {
    restoreBusySlot('/proj', 'backend-claude-1', 'todo-a', 'mc-proj-backendclaude1');
    restoreBusySlot('/proj', 'backend-claude-1', 'todo-b', 'mc-proj-backendclaude1');
    const pool = listPool();
    expect(pool).toHaveLength(1);
    expect(pool[0].currentTodoId).toBe('todo-b');
  });

  it('partitions by project (same lane name, two projects)', () => {
    restoreBusySlot('/a', 'backend-claude-1', 't1', 'mc-a-backendclaude1');
    restoreBusySlot('/b', 'backend-claude-1', 't2', 'mc-b-backendclaude1');
    expect(listPool()).toHaveLength(2);
  });

  it('returns null for an unparseable session name (no registry mutation)', () => {
    expect(restoreBusySlot('/proj', 'planner', 't1', 'mc-proj-planner')).toBeNull();
    expect(listPool()).toHaveLength(0);
  });
});
