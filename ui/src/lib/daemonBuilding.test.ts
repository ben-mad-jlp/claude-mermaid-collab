import { describe, it, expect } from 'vitest';
import { daemonBuildingFor, pulseStage, GLOW_MS } from '@/lib/zenPulse';
import { selectLiveness, type SessionStatus } from '@/lib/statusSelectors';
import type { SessionTodo } from '@/types/sessionTodo';
import type { TodoKind } from '@/lib/todoKind';

/** Every non-`kind` field of SessionTodo at its inert default. */
function base(): Omit<SessionTodo, 'kind'> {
  return {
    id: '',
    ownerSession: 's',
    assigneeSession: null,
    title: 't',
    description: null,
    status: 'planned' as SessionTodo['status'],
    completed: false,
    priority: null,
    dueDate: null,
    parentId: null,
    dependsOn: [],
    order: 0,
    link: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    asanaGid: null,
    approvedAt: '2026-01-01T00:00:00Z',
    claim: null,
    acceptanceStatus: null,
    assigneeKind: 'agent',
  };
}

/** `kind` is REQUIRED and has NO default. */
function todo(over: Partial<SessionTodo> & { kind: TodoKind }): SessionTodo {
  return { ...base(), id: Math.random().toString(36).slice(2), ...over };
}

/** A minimal SessionStatus for testing. */
function status(over: Partial<SessionStatus>): SessionStatus {
  return {
    serverId: 'local',
    project: 'test/project',
    session: 'test-session',
    status: 'waiting' as const,
    lastUpdate: Date.now(),
    ...over,
  };
}

const NOW = 1_000_000_000;

describe('daemonBuildingFor — count owned + claimed + non-terminal todos', () => {
  it('counts only owned + claimed + non-terminal', () => {
    const todos = [
      todo({ ownerSession: 'design', claimedBy: 'coordinator', status: 'in_progress', kind: 'leaf' }),
    ];
    expect(daemonBuildingFor('design', todos)).toBe(1);
  });

  it('ignores another session\'s claimed todo', () => {
    const todos = [
      todo({ ownerSession: 'other', claimedBy: 'coordinator', status: 'in_progress', kind: 'leaf' }),
    ];
    expect(daemonBuildingFor('design', todos)).toBe(0);
  });

  it('ignores an unclaimed todo', () => {
    const todos = [
      todo({ ownerSession: 'design', claimedBy: null, status: 'in_progress', kind: 'leaf' }),
    ];
    expect(daemonBuildingFor('design', todos)).toBe(0);
  });

  it('ignores a claimed todo with status done', () => {
    const todos = [
      todo({ ownerSession: 'design', claimedBy: 'coordinator', status: 'done', kind: 'leaf' }),
    ];
    expect(daemonBuildingFor('design', todos)).toBe(0);
  });

  it('ignores a claimed todo with status dropped', () => {
    const todos = [
      todo({ ownerSession: 'design', claimedBy: 'coordinator', status: 'dropped', kind: 'leaf' }),
    ];
    expect(daemonBuildingFor('design', todos)).toBe(0);
  });

  it('returns 0 for invalid inputs', () => {
    expect(daemonBuildingFor('', [])).toBe(0);
    expect(daemonBuildingFor('session', undefined as any)).toBe(0);
    expect(daemonBuildingFor(null as any, [])).toBe(0);
  });

  it('counts multiple non-terminal claimed todos', () => {
    const todos = [
      todo({ ownerSession: 'design', claimedBy: 'coordinator', status: 'in_progress', kind: 'leaf' }),
      todo({ ownerSession: 'design', claimedBy: 'coordinator', status: 'blocked', kind: 'leaf' }),
      todo({ ownerSession: 'design', claimedBy: 'coordinator', status: 'todo', kind: 'leaf' }),
    ];
    expect(daemonBuildingFor('design', todos)).toBe(3);
  });
});

describe('selectLiveness — waiting without daemon-building increments needsAttention', () => {
  it('waiting session without daemon-building increments needsAttention', () => {
    const sessions = {
      'local:test/project:session1': status({ status: 'waiting' }),
    };
    const view = selectLiveness(sessions, { kind: 'fleet' });
    expect(view.waiting).toBe(1);
    expect(view.needsAttention).toBe(1);
  });

  it('waiting session with daemon-building does NOT increment needsAttention', () => {
    const sessions = {
      'local:test/project:session1': status({ status: 'waiting', session: 'session1' }),
    };
    const predicate = (s: SessionStatus) => s.session === 'session1';
    const view = selectLiveness(sessions, { kind: 'fleet' }, { daemonBuilding: predicate });
    expect(view.waiting).toBe(1);
    expect(view.needsAttention).toBe(0);
  });

  it('default opts (no predicate) — needsAttention counts all waiting', () => {
    const sessions = {
      'local:test/project:session1': status({ status: 'waiting' }),
      'local:test/project:session2': status({ status: 'waiting' }),
    };
    const view = selectLiveness(sessions, { kind: 'fleet' });
    expect(view.waiting).toBe(2);
    expect(view.needsAttention).toBe(2);
  });

  it('permission + daemon-building still increments needsAttention', () => {
    const sessions = {
      'local:test/project:session1': status({ status: 'permission', session: 'session1' }),
    };
    const predicate = (s: SessionStatus) => s.session === 'session1';
    const view = selectLiveness(sessions, { kind: 'fleet' }, { daemonBuilding: predicate });
    expect(view.permission).toBe(1);
    expect(view.needsAttention).toBe(1);
  });
});

describe('pulseStage — daemon-building guard returns off unconditionally', () => {
  const pane = NOW;

  it('pulseStage with daemonBuilding=true returns off', () => {
    const result = pulseStage(pane, pane + GLOW_MS * 2, 0, true);
    expect(result).toBe('off');
  });

  it('pulseStage with daemonBuilding=false at same idle time returns glowing (not off)', () => {
    const result = pulseStage(pane, pane + GLOW_MS * 2, 0, false);
    expect(result).toBe('glowing');
  });

  it('daemonBuilding=true overrides all idle time + dismissal logic', () => {
    // Would be glowing without the guard, dismissed without the dismissal logic
    const result = pulseStage(pane, pane + GLOW_MS * 2, pane, true);
    expect(result).toBe('off');
  });

  it('default (no daemonBuilding param) behaves like false', () => {
    const result = pulseStage(pane, pane + GLOW_MS * 2, 0);
    expect(result).toBe('glowing');
  });
});
