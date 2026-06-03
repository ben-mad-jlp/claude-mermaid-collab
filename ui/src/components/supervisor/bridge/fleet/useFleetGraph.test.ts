import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetGraph } from './useFleetGraph';
import type { SessionTodo } from '@/types/sessionTodo';

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
    ...p,
  } as SessionTodo;
}

const base = { subs: [], openEscalations: [], now: 0 } as const;

describe('useFleetGraph', () => {
  it('renders a dependency edge between two top-level leaves', () => {
    const todos = [todo({ id: 'L1' }), todo({ id: 'L2', dependsOn: ['L1'] })];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0]).toMatchObject({ source: 'L1', target: 'L2', animated: false });
    // childless top-level todos are readable leaf nodes, not empty epics
    expect(result.current.nodes.every((n) => n.type === 'todo')).toBe(true);
  });

  it('treats a todo with children as a collapsed epic by default', () => {
    const todos = [todo({ id: 'E1' }), todo({ id: 'A', parentId: 'E1' })];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toContain('E1');
    expect(ids).not.toContain('A'); // child hidden while collapsed
    expect(result.current.nodes.find((n) => n.id === 'E1')!.type).toBe('epic');
  });

  it('re-routes a cross-epic child dependency to the visible epics (edges survive collapse)', () => {
    const todos = [
      todo({ id: 'E1' }),
      todo({ id: 'A', parentId: 'E1' }),
      todo({ id: 'E2' }),
      todo({ id: 'B', parentId: 'E2', dependsOn: ['A'] }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
    );
    expect(result.current.edges.some((e) => e.source === 'E1' && e.target === 'E2')).toBe(true);
  });

  it('shows children and the intra-epic edge once the epic is expanded', () => {
    const todos = [
      todo({ id: 'E1' }),
      todo({ id: 'A', parentId: 'E1' }),
      todo({ id: 'B', parentId: 'E1', dependsOn: ['A'] }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(['E1']) }),
    );
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
    expect(result.current.edges.some((e) => e.source === 'A' && e.target === 'B')).toBe(true);
  });
});
