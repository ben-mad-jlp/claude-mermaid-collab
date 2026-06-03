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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

  // Structure: an EPIC is any todo that actually HAS children. A parentId==null
  // todo with no children is a readable LEAF, not an empty-rollup epic block —
  // this is what made an idle fleet read as a field of dots.
  const struct = useMemo(() => {
    const byId = new Map<string, SessionTodo>();
    for (const t of todos) byId.set(t.id, t);
    const childrenByEpic = new Map<string, SessionTodo[]>();
    for (const t of todos) {
      if (t.parentId != null && byId.has(t.parentId)) {
        const arr = childrenByEpic.get(t.parentId) ?? [];
        arr.push(t);
        childrenByEpic.set(t.parentId, arr);
      }
    }
    return { byId, childrenByEpic, epicIds: new Set(childrenByEpic.keys()) };
  }, [todos]);

  // The visible epic an orphan/leaf hangs under (null = it's a top-level node).
  const parentEpicOf = useCallback(
    (t: SessionTodo): string | null => (t.parentId != null && struct.epicIds.has(t.parentId) ? t.parentId : null),
    [struct],
  );
  const isVisibleTodo = useCallback(
    (t: SessionTodo): boolean => {
      const pe = parentEpicOf(t);
      return pe == null || expandedEpics.has(pe);
    },
    [parentEpicOf, expandedEpics],
  );
  const visibleTodos = useMemo(() => todos.filter(isVisibleTodo), [todos, isVisibleTodo]);

  // Re-route any todo id to its nearest VISIBLE node (itself, or its
  // collapsed-epic ancestor) so dependency/claim edges survive collapse instead
  // of being dropped — the cause of the zero-edges graph.
  const visibleRep = useCallback(
    (id: string): string | null => {
      const t = struct.byId.get(id);
      if (!t) return null;
      if (isVisibleTodo(t)) return id;
      const pe = parentEpicOf(t);
      if (pe) {
        const ep = struct.byId.get(pe);
        if (ep && isVisibleTodo(ep)) return pe;
      }
      return null;
    },
    [struct, isVisibleTodo, parentEpicOf],
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

  // Keep latest derived helpers reachable from the structure-only memo.
  const ref = useRef({ todos, subs, visibleTodos, visibleRep, epicIds: struct.epicIds });
  ref.current = { todos, subs, visibleTodos, visibleRep, epicIds: struct.epicIds };

  // POSITIONS — recomputed only when the debounced structural signature changes.
  const positions = useMemo(() => {
    const { todos: allTodos, subs: curSubs, visibleTodos: vis, visibleRep: rep, epicIds } = ref.current;
    const waveMap = computeWaveMap(allTodos);

    const layoutNodes: LayoutNode[] = [];
    for (const t of vis) {
      const size = epicIds.has(t.id) ? SIZES.epic : SIZES.todo;
      layoutNodes.push({ id: t.id, width: size.width, height: size.height });
    }
    const workerOf = new Map<string, SessionTodo | null>();
    for (const sub of curSubs) {
      const todo = currentTodoFor(sub.session, allTodos);
      workerOf.set(sub.session, todo);
      layoutNodes.push({ id: `worker:${sub.session}`, width: SIZES.worker.width, height: SIZES.worker.height });
    }

    // Dependency edges, re-routed to visible representatives + deduped.
    const seen = new Set<string>();
    const layoutEdges: LayoutEdge[] = [];
    for (const t of allTodos) {
      const tgt = rep(t.id);
      if (!tgt) continue;
      for (const dep of t.dependsOn ?? []) {
        const src = rep(dep);
        if (src && src !== tgt && !seen.has(`${src}->${tgt}`)) {
          seen.add(`${src}->${tgt}`);
          layoutEdges.push({ source: src, target: tgt });
        }
      }
    }
    for (const sub of curSubs) {
      const todo = workerOf.get(sub.session);
      const tgt = todo ? rep(todo.id) : null;
      if (tgt) layoutEdges.push({ source: `worker:${sub.session}`, target: tgt });
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
    const dangerFor = (t: SessionTodo): boolean =>
      openEscalations.some(
        (e) => e.session === t.claimedBy || e.session === t.assigneeSession || e.session === t.sessionName,
      );

    for (const t of visibleTodos) {
      const pos = positions.get(t.id) ?? { x: 0, y: 0 };
      if (struct.epicIds.has(t.id)) {
        const counts = EMPTY_COUNTS();
        let total = 0;
        for (const c of struct.childrenByEpic.get(t.id) ?? []) {
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
  }, [visibleTodos, struct, todos, subs, openEscalations, positions, now]);

  // EDGES — dep edges (muted/static) re-routed through collapsed epics so they
  // always connect visible nodes; claim edges (accent/animated) only for active
  // workers (an idle worker has no in_progress todo → no claim edge).
  const edges = useMemo<FleetEdge[]>(() => {
    const out: FleetEdge[] = [];
    const seen = new Set<string>();
    for (const t of todos) {
      const tgt = visibleRep(t.id);
      if (!tgt) continue;
      for (const dep of t.dependsOn ?? []) {
        const src = visibleRep(dep);
        if (src && src !== tgt && !seen.has(`${src}->${tgt}`)) {
          seen.add(`${src}->${tgt}`);
          out.push({
            id: `dep:${src}->${tgt}`,
            source: src,
            target: tgt,
            animated: false,
            style: { stroke: 'var(--color-muted-400, #9ca3af)', strokeWidth: 1 },
          });
        }
      }
    }
    for (const sub of subs) {
      const todo = currentTodoFor(sub.session, todos);
      const tgt = todo ? visibleRep(todo.id) : null;
      if (tgt) {
        out.push({
          id: `claim:${sub.session}->${tgt}`,
          source: `worker:${sub.session}`,
          target: tgt,
          animated: true,
          style: { stroke: 'var(--color-accent-500, #6366f1)', strokeWidth: 2 },
        });
      }
    }
    return out;
  }, [todos, subs, visibleRep]);

  return { nodes, edges };
}
