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

describe('useFleetGraph — kind is the only role source', () => {
  describe('Suite A: a split leaf is still a leaf', () => {
    it('a leaf with nine children renders as a todo node, not an epic', () => {
      const E = todo({ id: 'E', kind: 'epic' });
      const L = todo({ id: 'L', kind: 'leaf', parentId: 'E' });
      const children = Array.from({ length: 9 }, (_, i) =>
        todo({ id: `S${i + 1}`, kind: 'leaf', parentId: 'L' }),
      );
      const todos = [E, L, ...children];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set(['E']) }),
      );

      const nodeL = result.current.nodes.find((n) => n.id === 'L')!;
      expect(nodeL).toBeDefined();
      expect(nodeL.type).toBe('todo');
    });

    it('the split leaf never becomes a container', () => {
      const E = todo({ id: 'E', kind: 'epic' });
      const L = todo({ id: 'L', kind: 'leaf', parentId: 'E' });
      const children = Array.from({ length: 9 }, (_, i) =>
        todo({ id: `S${i + 1}`, kind: 'leaf', parentId: 'L' }),
      );
      const todos = [E, L, ...children];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set(['E']) }),
      );

      const nodeL = result.current.nodes.find((n) => n.id === 'L')!;
      expect(nodeL.type).toBe('todo');
      expect(nodeL.style).toBeUndefined();
      expect(nodeL.data.kind).toBe('todo');

      const epicNodes = result.current.nodes.filter((n) => n.type === 'epic');
      expect(epicNodes.map((n) => n.id)).toEqual(['E']);
    });

    it('sub-tasks are children in the graph, joined by dashed sub-task edges', () => {
      const E = todo({ id: 'E', kind: 'epic' });
      const L = todo({ id: 'L', kind: 'leaf', parentId: 'E' });
      const children = Array.from({ length: 9 }, (_, i) =>
        todo({ id: `S${i + 1}`, kind: 'leaf', parentId: 'L' }),
      );
      const todos = [E, L, ...children];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set(['E']) }),
      );

      // Each S1..S9 is present with type 'todo' and NO parentId (not nested)
      for (let i = 1; i <= 9; i++) {
        const nodeS = result.current.nodes.find((n) => n.id === `S${i}`)!;
        expect(nodeS).toBeDefined();
        expect(nodeS.type).toBe('todo');
        expect(nodeS.parentId).toBeUndefined();
      }

      // All nine sub-task edges exist with dashed style
      for (let i = 1; i <= 9; i++) {
        const edge = result.current.edges.find((e) => e.id === `sub:L->S${i}`);
        expect(edge).toBeDefined();
        expect(edge!.style?.strokeDasharray).toBe('4 3');
      }
    });

    it('sub-tasks are visible even when nothing is expanded', () => {
      const E = todo({ id: 'E', kind: 'epic' });
      const L = todo({ id: 'L', kind: 'leaf', parentId: 'E' });
      const S1 = todo({ id: 'S1', kind: 'leaf', parentId: 'L' });
      const todos = [E, L, S1];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
      );

      // S1's parentEpicIdOf(S1, epicIds) returns null (L is not an epic), so
      // isVisibleTodo(S1) is true and S1 IS emitted as a top-level node.
      // L is hidden because it's inside collapsed E. The edge is rerouted to the
      // visible representative of L, which is E (L's visible epic ancestor).
      const nodeL = result.current.nodes.find((n) => n.id === 'L');
      const nodeS1 = result.current.nodes.find((n) => n.id === 'S1');
      const nodeE = result.current.nodes.find((n) => n.id === 'E')!;

      // E is collapsed so not expanded in epicSize
      expect(nodeE).toBeDefined();
      expect(nodeE.data.expanded).toBeUndefined();

      // L is hidden because it's inside collapsed E
      expect(nodeL).toBeUndefined();

      // S1 is emitted as a top-level node with a sub-task edge rerouted through E
      expect(nodeS1).toBeDefined();
      expect(nodeS1!.type).toBe('todo');
      const subEdge = result.current.edges.find((e) => e.id === 'sub:E->S1');
      expect(subEdge).toBeDefined();
      expect(subEdge!.style?.strokeDasharray).toBe('4 3');
    });
  });

  describe('Suite B: a childless epic is still an epic', () => {
    it('a brand-new epic with zero children renders as an epic node', () => {
      const E0 = todo({ id: 'E0', kind: 'epic' });
      const todos = [E0];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
      );

      const nodeE0 = result.current.nodes.find((n) => n.id === 'E0')!;
      expect(nodeE0).toBeDefined();
      expect(nodeE0.type).toBe('epic');
      const data = nodeE0.data as EpicNodeData;
      expect(data.total).toBe(0);
      expect(data.counts.backlog).toBe(0);
      expect(data.counts.ready).toBe(0);
      expect(data.counts.inflight).toBe(0);
      expect(data.counts.blocked).toBe(0);
      expect(data.counts.done).toBe(0);
    });

    it('an EXPANDED childless epic does not crash the layout', () => {
      const E0 = todo({ id: 'E0', kind: 'epic' });
      const todos = [E0];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set(['E0']) }),
      );

      const nodeE0 = result.current.nodes.find((n) => n.id === 'E0')!;
      expect(nodeE0).toBeDefined();
      expect(nodeE0.type).toBe('epic');
      const data = nodeE0.data as EpicNodeData;
      expect(data.expanded).toBe(true);
      // The fallback SIZES.epic is applied at useFleetGraph.ts:268
      expect(nodeE0.style?.width).toBe(200);
      expect(nodeE0.style?.height).toBe(56);
    });

    it('a childless epic is not hidden by the done-rollup', () => {
      // Create a ready (non-done) childless epic and a done epic with children
      const E0 = todo({ id: 'E0', kind: 'epic', status: 'ready' });
      const E1 = todo({ id: 'E1', kind: 'epic', status: 'done' });
      const C1 = todo({ id: 'C1', kind: 'leaf', parentId: 'E1', status: 'done' });
      const todos = [E0, E1, C1];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
      );

      const nodeE0 = result.current.nodes.find((n) => n.id === 'E0');
      const nodeE1 = result.current.nodes.find((n) => n.id === 'E1');
      const nodeC1 = result.current.nodes.find((n) => n.id === 'C1');

      // E0 is childless and ready, so not hidden
      expect(nodeE0).toBeDefined();
      expect(nodeE0!.type).toBe('epic');

      // E1 is done (and has children), so hidden with its children
      expect(nodeE1).toBeUndefined();
      expect(nodeC1).toBeUndefined();
    });
  });

  describe('Suite C: structure is never a role', () => {
    it('epic-ness comes from kind, not from having children', () => {
      const P = todo({ id: 'P', kind: 'leaf' });
      const C = todo({ id: 'C', kind: 'leaf', parentId: 'P' });
      const E0 = todo({ id: 'E0', kind: 'epic' });
      const todos = [P, C, E0];

      const { result } = renderHook(() =>
        useFleetGraph({ ...base, todos, expandedEpics: new Set() }),
      );

      const epicNodeIds = result.current.nodes
        .filter((n) => n.type === 'epic')
        .map((n) => n.id);

      // Only E0 should be an epic; P is a leaf with children but still renders as todo
      expect(epicNodeIds).toEqual(['E0']);
    });
  });
});
