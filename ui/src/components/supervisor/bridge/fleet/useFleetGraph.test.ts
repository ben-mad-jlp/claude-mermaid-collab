import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFleetGraph, type WorkerSub } from './useFleetGraph';
import type { SessionTodo } from '@/types/sessionTodo';

function sub(session: string): WorkerSub {
  return { serverId: 'local', project: 'P', session, status: 'active', lastUpdate: 0 };
}

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

  it('forces a node to the inflight bucket when its id is in inflightLeafIds (headless leaf with no local claim)', () => {
    // A headless leaf-executor run never flips the todo's local status/claimedBy,
    // so without the daemon ledger it would read as its plain status. The daemon
    // inflight set must light it up as `inflight`.
    const todos = [todo({ id: 'L1', status: 'ready' }), todo({ id: 'L2', status: 'ready' })];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(), inflightLeafIds: new Set(['L1']) }),
    );
    const n1 = result.current.nodes.find((n) => n.id === 'L1')!;
    const n2 = result.current.nodes.find((n) => n.id === 'L2')!;
    expect((n1.data as { bucket: string }).bucket).toBe('inflight');
    expect((n2.data as { bucket: string }).bucket).not.toBe('inflight'); // not in the set → unchanged
  });

  it('counts a headless-inflight child toward its epic inflight tally', () => {
    const todos = [
      todo({ id: 'E1' }),
      todo({ id: 'A', parentId: 'E1', status: 'ready' }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(), inflightLeafIds: new Set(['A']) }),
    );
    const epic = result.current.nodes.find((n) => n.id === 'E1')!;
    expect((epic.data as { counts: Record<string, number> }).counts.inflight).toBe(1);
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

  it('frames an expanded epic as a container: children are parented + the epic is sized', () => {
    const todos = [
      todo({ id: 'E1' }),
      todo({ id: 'A', parentId: 'E1' }),
      todo({ id: 'B', parentId: 'E1', dependsOn: ['A'] }),
    ];
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(['E1']) }),
    );
    const epic = result.current.nodes.find((n) => n.id === 'E1')!;
    expect(epic.type).toBe('epic');
    expect((epic.data as { expanded?: boolean }).expanded).toBe(true);
    // The container is sized to frame its children.
    expect((epic.data as { width?: number }).width).toBeGreaterThan(0);
    expect((epic.data as { height?: number }).height).toBeGreaterThan(0);
    // Children are nested (parentId == the epic) and clamped to the parent.
    const a = result.current.nodes.find((n) => n.id === 'A')!;
    const b = result.current.nodes.find((n) => n.id === 'B')!;
    expect(a.parentId).toBe('E1');
    expect(b.parentId).toBe('E1');
    expect(a.extent).toBe('parent');
    // The container precedes its children in the node array (React Flow requires it).
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids.indexOf('E1')).toBeLessThan(ids.indexOf('A'));
    expect(ids.indexOf('E1')).toBeLessThan(ids.indexOf('B'));
  });

  it('threads direction into the layout: LR spreads waves along x, TB along y', () => {
    const todos = [todo({ id: 'A' }), todo({ id: 'B', dependsOn: ['A'] })];
    const lr = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(), direction: 'LR' }),
    );
    const tb = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(), direction: 'TB' }),
    );
    const pos = (r: typeof lr, id: string) => r.result.current.nodes.find((n) => n.id === id)!.position;
    // dependent B sits in the next wave: to the RIGHT of A in LR, BELOW A in TB.
    expect(pos(lr, 'B').x).toBeGreaterThan(pos(lr, 'A').x);
    expect(pos(tb, 'B').y).toBeGreaterThan(pos(tb, 'A').y);
  });

  it('G1: TB flow with the epic expanded frames a container with parented children', () => {
    const todos = [
      todo({ id: 'E1' }),
      todo({ id: 'A', parentId: 'E1' }),
      todo({ id: 'B', parentId: 'E1', dependsOn: ['A'] }),
    ];
    // G1 default at the FleetGraph level: TB + the epic always in expandedEpics.
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, expandedEpics: new Set(['E1']), direction: 'TB' }),
    );
    const epic = result.current.nodes.find((n) => n.id === 'E1')!;
    expect(epic.type).toBe('epic');
    expect((epic.data as { expanded?: boolean }).expanded).toBe(true);
    const a = result.current.nodes.find((n) => n.id === 'A')!;
    const b = result.current.nodes.find((n) => n.id === 'B')!;
    expect(a.parentId).toBe('E1');
    expect(b.parentId).toBe('E1');
    expect(a.extent).toBe('parent');
    // TB inner flow: dependent child B is below A within the container.
    expect(b.position.y).toBeGreaterThan(a.position.y);
  });

  it('G3: worker nodes only for the working fleet (spawned OR holding a claimed in_progress todo)', () => {
    const todos = [todo({ id: 'T', status: 'in_progress', claimedBy: 'worker-x' })];
    const subs = [sub('worker-x'), sub('planner-1')];

    // No session spawned: worker-x holds a claimed in_progress todo → node;
    // planner-1 is an idle foreground operator → NO node.
    const { result } = renderHook(() =>
      useFleetGraph({ ...base, todos, subs, expandedEpics: new Set(), spawnedSessions: new Set() }),
    );
    const ids = result.current.nodes.map((n) => n.id);
    expect(ids).toContain('worker:worker-x');
    expect(ids).not.toContain('worker:planner-1');

    // Mark planner-1 as coordinator-spawned → it now qualifies as a worker node.
    const spawned = renderHook(() =>
      useFleetGraph({ ...base, todos, subs, expandedEpics: new Set(), spawnedSessions: new Set(['planner-1']) }),
    );
    expect(spawned.result.current.nodes.map((n) => n.id)).toContain('worker:planner-1');
  });
});
