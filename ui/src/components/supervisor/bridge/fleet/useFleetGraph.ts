/**
 * useFleetGraph — the topology + data selector for the FleetGraph (BR-3, §3/§8).
 *
 * Two clocks keep the graph from ever jumping:
 *  - TOPOLOGY (node ids, edges, positions) is recomputed only when the
 *    *structural* signature changes — parent/dep/claim joins, the visible set —
 *    and that recompute is debounced ~250ms so a burst of updates settles once.
 *  - DATA (status bucket, retry, danger, liveness, ctx, claimed title) is merged
 *    fresh every render onto the stable positions.
 *
 * So live status churn repaints nodes in place; only real structural change
 * moves them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { computeWaveMap } from '@/components/supervisor/roadmapToMermaid';
import { bucketTodo, type FunnelKey } from '../funnel';
import { currentTodoFor, deriveLiveness, roleGlyph } from '@/lib/liveness';
import type { SessionTodo } from '@/types/sessionTodo';
import type { Escalation } from '@/stores/supervisorStore';
import { layoutFleet, type LayoutEdge, type LayoutNode } from './layout';
import type { EpicNodeData, FleetEdge, FleetNode, TodoNodeData, WorkerNodeData } from './types';

export interface WorkerSub {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  lastUpdate: number;
  contextPercent?: number;
}

export interface UseFleetGraphInput {
  todos: SessionTodo[];
  subs: WorkerSub[];
  openEscalations: Escalation[];
  expandedEpics: Set<string>;
  now: number;
}

const EMPTY_COUNTS = (): Record<FunnelKey, number> => ({
  backlog: 0,
  ready: 0,
  inflight: 0,
  blocked: 0,
  done: 0,
});

const SIZES = {
  epic: { width: 200, height: 56 },
  todo: { width: 180, height: 52 },
  worker: { width: 170, height: 60 },
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useFleetGraph(input: UseFleetGraphInput): { nodes: FleetNode[]; edges: FleetEdge[] } {
  const { todos, subs, openEscalations, expandedEpics, now } = input;

  const isEpic = (t: SessionTodo) => t.parentId == null;

  // Visible todos: epics always; child todos only when their epic is expanded.
  const visibleTodos = useMemo(
    () => todos.filter((t) => isEpic(t) || (t.parentId != null && expandedEpics.has(t.parentId))),
    [todos, expandedEpics],
  );

  // Structural signature → drives the debounced topology recompute.
  const expandedKey = useMemo(() => Array.from(expandedEpics).sort().join(','), [expandedEpics]);
  const signature = useMemo(() => {
    const t = todos
      .map((x) => `${x.id}:${x.parentId ?? ''}:${(x.dependsOn ?? []).join('|')}:${x.claimedBy ?? ''}:${x.assigneeSession ?? ''}`)
      .join(';');
    const s = subs.map((x) => x.session).sort().join(',');
    return `${t}#${s}#${expandedKey}`;
  }, [todos, subs, expandedKey]);
  const debouncedSig = useDebounced(signature, 250);

  // Keep latest data reachable from the structure-only memo without widening deps.
  const ref = useRef({ todos, subs, visibleTodos });
  ref.current = { todos, subs, visibleTodos };

  // POSITIONS — recomputed only when the debounced structural signature changes.
  const positions = useMemo(() => {
    const { todos: allTodos, subs: curSubs, visibleTodos: vis } = ref.current;
    const waveMap = computeWaveMap(allTodos);
    const visibleIds = new Set(vis.map((t) => t.id));

    const layoutNodes: LayoutNode[] = [];
    for (const t of vis) {
      const size = isEpic(t) ? SIZES.epic : SIZES.todo;
      layoutNodes.push({ id: t.id, width: size.width, height: size.height });
    }
    const workerOf = new Map<string, SessionTodo | null>();
    for (const sub of curSubs) {
      const todo = currentTodoFor(sub.session, allTodos);
      workerOf.set(sub.session, todo);
      layoutNodes.push({ id: `worker:${sub.session}`, width: SIZES.worker.width, height: SIZES.worker.height });
    }

    const layoutEdges: LayoutEdge[] = [];
    for (const t of vis) {
      for (const dep of t.dependsOn ?? []) {
        if (visibleIds.has(dep)) layoutEdges.push({ source: dep, target: t.id });
      }
    }
    for (const sub of curSubs) {
      const todo = workerOf.get(sub.session);
      if (todo && visibleIds.has(todo.id)) layoutEdges.push({ source: `worker:${sub.session}`, target: todo.id });
    }

    const rankOf = (id: string): number | undefined => {
      if (id.startsWith('worker:')) {
        const todo = workerOf.get(id.slice('worker:'.length));
        return todo ? waveMap.get(todo.id) : 0;
      }
      return waveMap.get(id);
    };

    return layoutFleet(layoutNodes, layoutEdges, rankOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSig]);

  // NODES — fresh data each render, stable positions.
  const nodes = useMemo<FleetNode[]>(() => {
    const out: FleetNode[] = [];
    const childrenByEpic = new Map<string, SessionTodo[]>();
    for (const t of todos) {
      if (t.parentId != null) {
        const arr = childrenByEpic.get(t.parentId) ?? [];
        arr.push(t);
        childrenByEpic.set(t.parentId, arr);
      }
    }
    const dangerFor = (t: SessionTodo): boolean =>
      openEscalations.some(
        (e) => e.session === t.claimedBy || e.session === t.assigneeSession || e.session === t.sessionName,
      );

    for (const t of visibleTodos) {
      const pos = positions.get(t.id) ?? { x: 0, y: 0 };
      if (isEpic(t)) {
        const counts = EMPTY_COUNTS();
        let total = 0;
        for (const c of childrenByEpic.get(t.id) ?? []) {
          const b = bucketTodo(c);
          if (b) {
            counts[b] += 1;
            total += 1;
          }
        }
        const data: EpicNodeData = { kind: 'epic', label: t.title, counts, total };
        out.push({ id: t.id, type: 'epic', position: pos, data });
      } else {
        const data: TodoNodeData = {
          kind: 'todo',
          title: t.title,
          bucket: bucketTodo(t) ?? 'backlog',
          retryCount: t.retryCount ?? 0,
          danger: dangerFor(t),
        };
        out.push({ id: t.id, type: 'todo', position: pos, data });
      }
    }

    for (const sub of subs) {
      const id = `worker:${sub.session}`;
      const pos = positions.get(id) ?? { x: 0, y: 0 };
      const todo = currentTodoFor(sub.session, todos);
      const data: WorkerNodeData = {
        kind: 'worker',
        session: sub.session,
        glyph: roleGlyph(sub.session),
        liveness: deriveLiveness(sub, todo, now),
        contextPercent: sub.contextPercent,
        todoTitle: todo?.title,
      };
      out.push({ id, type: 'worker', position: pos, data });
    }
    return out;
  }, [visibleTodos, todos, subs, openEscalations, positions, now]);

  // EDGES — structural; dep edges muted/static, claim edges accent/animated.
  const edges = useMemo<FleetEdge[]>(() => {
    const visibleIds = new Set(visibleTodos.map((t) => t.id));
    const out: FleetEdge[] = [];
    for (const t of visibleTodos) {
      for (const dep of t.dependsOn ?? []) {
        if (visibleIds.has(dep)) {
          out.push({
            id: `dep:${dep}->${t.id}`,
            source: dep,
            target: t.id,
            animated: false,
            style: { stroke: 'var(--color-muted-400, #9ca3af)', strokeWidth: 1 },
          });
        }
      }
    }
    for (const sub of subs) {
      const todo = currentTodoFor(sub.session, todos);
      if (todo && visibleIds.has(todo.id)) {
        out.push({
          id: `claim:${sub.session}->${todo.id}`,
          source: `worker:${sub.session}`,
          target: todo.id,
          animated: true,
          style: { stroke: 'var(--color-accent-500, #6366f1)', strokeWidth: 2 },
        });
      }
    }
    return out;
  }, [visibleTodos, subs, todos]);

  return { nodes, edges };
}
