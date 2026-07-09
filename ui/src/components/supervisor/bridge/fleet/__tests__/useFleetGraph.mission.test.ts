import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetGraph } from '../useFleetGraph';
import type { SessionTodo } from '@/types/sessionTodo';
import type { EpicNodeData } from '../types';

function todo(p: Partial<SessionTodo>): SessionTodo {
  return {
    id: '',
    ownerSession: '',
    assigneeSession: null,
    title: p.id ?? '',
    description: null,
    status: 'ready',
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
    kind: 'leaf',
    ...p,
  } as SessionTodo;
}

const base = { subs: [], openEscalations: [], now: 0 } as const;

// Missions are dropped at the fleet boundary before any structural derivation
// (see the `isMissionTodo` header comment in useFleetGraph.ts). A mission is
// never a fleet node; its epics re-root to the top-level-epic path because
// their `parentId` fails the `byId.has(parentId)` guard once the mission row
// is gone. These tests encode that contract — NOT "a mission renders as a
// root" (it renders as nothing).
describe('useFleetGraph — missions', () => {
  it('a mission-parented epic renders as a top-level epic, not a child chip', () => {
    const todos = [
      todo({ id: 'M', kind: 'mission' }),
      todo({ id: 'E', kind: 'epic', parentId: 'M' }),
      todo({ id: 'A', parentId: 'E', approvedAt: '2025-01-01' }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    const nodeE = result.current.nodes.find((n) => n.id === 'E')!;
    expect(nodeE).toBeDefined();
    expect(nodeE.type).toBe('epic');
    // Regression guard: E.parentId === 'M', so any rule that infers
    // "epic ⇔ parentId == null" would emit E as type 'todo' and this fails.
    expect(nodeE.parentId).toBeUndefined();
    expect((nodeE.data as EpicNodeData).total).toBe(1);
  });

  it('the mission itself is not a fleet node (missions are dropped at the boundary)', () => {
    const todos = [
      todo({ id: 'M', kind: 'mission' }),
      todo({ id: 'E', kind: 'epic', parentId: 'M' }),
      todo({ id: 'A', parentId: 'E' }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    // A mission is durable/non-closing and is not a fleet entity.
    expect(result.current.nodes.find((n) => n.id === 'M')).toBeUndefined();
    expect(result.current.edges.every((e) => e.source !== 'M' && e.target !== 'M')).toBe(true);
  });

  it('bucket epics stay roots', () => {
    const todos = [
      todo({ id: 'M', kind: 'mission' }),
      todo({ id: 'E', kind: 'epic', parentId: 'M' }),
      todo({ id: 'A', parentId: 'E' }),
      todo({ id: 'INBOX', kind: 'epic', title: '[EPIC] Inbox', parentId: null }),
      todo({ id: 'B', parentId: 'INBOX' }),
      todo({ id: 'BUG', kind: 'epic', title: '[EPIC] Bugfix inbox', parentId: null }),
      todo({ id: 'C', parentId: 'BUG' }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    const nodeInbox = result.current.nodes.find((n) => n.id === 'INBOX')!;
    const nodeBug = result.current.nodes.find((n) => n.id === 'BUG')!;
    expect(nodeInbox.type).toBe('epic');
    expect(nodeInbox.parentId).toBeUndefined();
    expect(nodeBug.type).toBe('epic');
    expect(nodeBug.parentId).toBeUndefined();
  });

  it('role comes from structure/kind, never from a title regex', () => {
    const todos = [todo({ id: 'FAKE', kind: 'leaf', title: '[EPIC] Not really an epic', parentId: null })];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    const nodeFake = result.current.nodes.find((n) => n.id === 'FAKE')!;
    expect(nodeFake.type).toBe('todo');
    expect(result.current.nodes.every((n) => n.type !== 'epic')).toBe(true);
  });
});
