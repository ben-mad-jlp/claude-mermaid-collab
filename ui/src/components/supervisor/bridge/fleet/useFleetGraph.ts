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
import { layoutFleet, type LayoutDirection, type LayoutEdge, type LayoutNode, type Positioned } from './layout';
import type { EpicNodeData, FleetEdge, FleetNode, TodoNodeData, WorkerNodeData } from './types';

export interface WorkerSub {
  serverId: string;
  project: string;
  session: string;
  status: 'active' | 'waiting' | 'permission' | 'unknown';
  /** REAL last-activity (ms epoch) or null when none is known. */
  lastUpdate: number | null;
  contextPercent?: number;
}

export interface UseFleetGraphInput {
  todos: SessionTodo[];
  subs: WorkerSub[];
  openEscalations: Escalation[];
  expandedEpics: Set<string>;
  now: number;
  /** dagre rankdir, mirrors the deck orientation (LR wide / TB narrow). */
  direction?: LayoutDirection;
  /**
   * G3: the sessions the coordinator SPAWNED (supervised source='spawn'). A sub
   * becomes a worker node only if it's in here OR currently holds a claimed
   * in_progress todo — so foreground operators (planner/supervisor/steward) that
   * are merely registered don't leak in as idle worker nodes. Absent → treated
   * as empty (only claim-holders qualify).
   */
  spawnedSessions?: Set<string>;
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

// Framed-container chrome (expanded epic): a header band holds the label +
// status bar; padding frames the nested children below it. G1: roomier so the
// grouped contents breathe now that every epic is an always-open container.
const EPIC_HEADER_H = 52;
const EPIC_PAD_X = 28;
const EPIC_PAD_BOTTOM = 28;

/** Output of the two-level layout: absolute/relative positions + container metadata. */
interface FleetLayout {
  /** Absolute position for top-level entities; RELATIVE (to its epic) for nested children. */
  pos: Map<string, Positioned>;
  /** childId → the expanded epic that frames it (drives React Flow parentId). */
  parentOf: Map<string, string>;
  /** epicId → its framed container size, for expanded epics only. */
  epicSize: Map<string, { width: number; height: number }>;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useFleetGraph(input: UseFleetGraphInput): { nodes: FleetNode[]; edges: FleetEdge[] } {
  const { todos: rawTodos, subs: rawSubs, openEscalations, expandedEpics, now, direction = 'LR', spawnedSessions } = input;

  // Hide finished work so the graph shows only what's live/pending: drop
  // completed orphan/leaf todos (no active epic parent) and any epic that is
  // completely done (status done/dropped, OR every child done/dropped) along with
  // its children. Completed children of an ACTIVE epic still show (progress).
  // Everything downstream derives from this filtered set.
  const todos = useMemo(() => {
    const isDone = (t: SessionTodo) => t.status === 'done' || t.status === 'dropped';
    const byId = new Map<string, SessionTodo>();
    for (const t of rawTodos) byId.set(t.id, t);
    const childrenByEpic = new Map<string, SessionTodo[]>();
    for (const t of rawTodos) {
      if (t.parentId != null && byId.has(t.parentId)) {
        const arr = childrenByEpic.get(t.parentId) ?? [];
        arr.push(t);
        childrenByEpic.set(t.parentId, arr);
      }
    }
    const epicIds = new Set(childrenByEpic.keys());
    const hidden = new Set<string>();
    for (const t of rawTodos) {
      if (epicIds.has(t.id)) {
        const kids = childrenByEpic.get(t.id) ?? [];
        if (isDone(t) || (kids.length > 0 && kids.every(isDone))) {
          hidden.add(t.id);
          for (const k of kids) hidden.add(k.id);
        }
      } else if ((t.parentId == null || !epicIds.has(t.parentId)) && isDone(t)) {
        hidden.add(t.id); // completed orphan / top-level leaf
      }
    }
    return hidden.size ? rawTodos.filter((t) => !hidden.has(t.id)) : rawTodos;
  }, [rawTodos]);

  // G3: restrict the worker nodes to the WORKING fleet. A session qualifies if
  // it was coordinator-spawned (spawnedSessions) OR it currently holds a claimed
  // in_progress todo (currentTodoFor returns non-null only for in_progress work).
  // Everything else — idle foreground operators merely registered in the
  // subscription store — is excluded. Done once here so the layout, nodes and
  // claim edges all derive from the same filtered set.
  const subs = useMemo(
    () => rawSubs.filter((s) => spawnedSessions?.has(s.session) || currentTodoFor(s.session, todos) != null),
    [rawSubs, spawnedSessions, todos],
  );

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
    // `direction` is folded in so an orientation flip is ONE deliberate relayout
    // (debounced ~250ms) — status/ctx ticks never touch the signature, so they
    // only updateNodeData in place (never-jump).
    return `${t}#${s}#${expandedKey}#${direction}`;
  }, [todos, subs, expandedKey, direction]);
  const debouncedSig = useDebounced(signature, 250);

  // Keep latest derived helpers reachable from the structure-only memo.
  const ref = useRef({ todos, subs, visibleTodos, visibleRep, struct, expandedEpics, direction });
  ref.current = { todos, subs, visibleTodos, visibleRep, struct, expandedEpics, direction };

  // POSITIONS — recomputed only when the debounced structural signature changes.
  //
  // Two-level layout (decision d0a6bb2b): an EXPANDED epic is a framed container.
  //  - INNER: its visible children are laid out among themselves (intra-epic deps)
  //    and the bounding box → the container's size; child positions are RELATIVE
  //    to the container (offset below the header band).
  //  - OUTER: leaf top-level todos, epics (collapsed chip OR expanded container at
  //    its full size) and workers are laid out together, with every dependency
  //    edge re-routed to its TOP-LEVEL representative (a child's edges pull on its
  //    epic, not the epic's neighbours). Expanded-epic children are skipped here —
  //    they live inside their container.
  const layout = useMemo<FleetLayout>(() => {
    const { todos: allTodos, subs: curSubs, visibleTodos: vis, struct: st, expandedEpics: expanded, direction: dir } = ref.current;
    const waveMap = computeWaveMap(allTodos);
    const isExpandedEpic = (id: string) => st.epicIds.has(id) && expanded.has(id);

    // ---- INNER: each expanded epic → relative child positions + container size.
    const pos = new Map<string, Positioned>();
    const parentOf = new Map<string, string>();
    const epicSize = new Map<string, { width: number; height: number }>();
    for (const epicId of st.epicIds) {
      if (!expanded.has(epicId)) continue;
      const kids = (st.childrenByEpic.get(epicId) ?? []).filter((c) => vis.some((v) => v.id === c.id));
      if (kids.length === 0) continue;
      const kidIds = new Set(kids.map((k) => k.id));
      const innerNodes: LayoutNode[] = kids.map((k) => ({ id: k.id, width: SIZES.todo.width, height: SIZES.todo.height }));
      const seenInner = new Set<string>();
      const innerEdges: LayoutEdge[] = [];
      for (const k of kids) {
        for (const dep of k.dependsOn ?? []) {
          if (kidIds.has(dep) && !seenInner.has(`${dep}->${k.id}`)) {
            seenInner.add(`${dep}->${k.id}`);
            innerEdges.push({ source: dep, target: k.id });
          }
        }
      }
      const inner = layoutFleet(innerNodes, innerEdges, (id) => waveMap.get(id), dir);
      // Normalise to (0,0) then offset for the header + padding; size to fit.
      let minX = Infinity, minY = Infinity;
      for (const p of inner.values()) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
      if (!isFinite(minX)) { minX = 0; minY = 0; }
      let maxRight = 0, maxBottom = 0;
      for (const k of kids) {
        const p = inner.get(k.id) ?? { x: 0, y: 0 };
        const rel = { x: p.x - minX + EPIC_PAD_X, y: p.y - minY + EPIC_HEADER_H };
        pos.set(k.id, rel);
        parentOf.set(k.id, epicId);
        maxRight = Math.max(maxRight, rel.x + SIZES.todo.width);
        maxBottom = Math.max(maxBottom, rel.y + SIZES.todo.height);
      }
      epicSize.set(epicId, {
        width: Math.max(SIZES.epic.width, maxRight + EPIC_PAD_X),
        height: maxBottom + EPIC_PAD_BOTTOM,
      });
    }

    // ---- OUTER: top-level entities (skip children that now live in a container).
    const outerRep = (id: string): string | null => {
      const t = st.byId.get(id);
      if (!t) return null;
      if (st.epicIds.has(id)) return id;
      const pe = t.parentId != null && st.epicIds.has(t.parentId) ? t.parentId : null;
      return pe ?? id; // child → its epic; otherwise a top-level leaf
    };

    const outerNodes: LayoutNode[] = [];
    for (const t of vis) {
      if (parentOf.has(t.id)) continue; // nested inside an expanded epic
      const size = isExpandedEpic(t.id) ? epicSize.get(t.id)! : st.epicIds.has(t.id) ? SIZES.epic : SIZES.todo;
      outerNodes.push({ id: t.id, width: size.width, height: size.height });
    }
    const workerOf = new Map<string, SessionTodo | null>();
    for (const sub of curSubs) {
      const todo = currentTodoFor(sub.session, allTodos);
      workerOf.set(sub.session, todo);
      outerNodes.push({ id: `worker:${sub.session}`, width: SIZES.worker.width, height: SIZES.worker.height });
    }

    const seen = new Set<string>();
    const outerEdges: LayoutEdge[] = [];
    for (const t of allTodos) {
      const tgt = outerRep(t.id);
      if (!tgt) continue;
      for (const dep of t.dependsOn ?? []) {
        const src = outerRep(dep);
        if (src && src !== tgt && !seen.has(`${src}->${tgt}`)) {
          seen.add(`${src}->${tgt}`);
          outerEdges.push({ source: src, target: tgt });
        }
      }
    }
    for (const sub of curSubs) {
      const todo = workerOf.get(sub.session);
      const tgt = todo ? outerRep(todo.id) : null;
      if (tgt) outerEdges.push({ source: `worker:${sub.session}`, target: tgt });
    }

    // An epic's rank is the earliest wave among its children so it sits ahead of
    // the work that depends on it; a worker borrows its todo's representative rank.
    const rankOf = (id: string): number | undefined => {
      if (id.startsWith('worker:')) {
        const todo = workerOf.get(id.slice('worker:'.length));
        return todo ? waveMap.get(outerRep(todo.id) ?? todo.id) : 0;
      }
      if (st.epicIds.has(id)) {
        const kids = st.childrenByEpic.get(id) ?? [];
        const waves = kids.map((k) => waveMap.get(k.id)).filter((w): w is number => w != null);
        return waves.length ? Math.min(...waves) : waveMap.get(id);
      }
      return waveMap.get(id);
    };

    const outer = layoutFleet(outerNodes, outerEdges, rankOf, dir);
    for (const [id, p] of outer) pos.set(id, p); // absolute for top-level entities

    return { pos, parentOf, epicSize };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSig]);
  const { pos: positions, parentOf, epicSize } = layout;

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
          const b = bucketTodo(c, struct.byId);
          if (b) {
            counts[b] += 1;
            total += 1;
          }
        }
        const size = epicSize.get(t.id);
        const data: EpicNodeData = size
          ? { kind: 'epic', label: t.title, counts, total, expanded: true, width: size.width, height: size.height }
          : { kind: 'epic', label: t.title, counts, total };
        // An expanded epic is a framed container: give React Flow the box size so
        // it reserves space and the nested children render inside its bounds.
        out.push(
          size
            ? { id: t.id, type: 'epic', position: pos, data, style: { width: size.width, height: size.height } }
            : { id: t.id, type: 'epic', position: pos, data },
        );
      } else {
        const data: TodoNodeData = {
          kind: 'todo',
          title: t.title,
          bucket: bucketTodo(t, struct.byId) ?? 'backlog',
          retryCount: t.retryCount ?? 0,
          danger: dangerFor(t),
        };
        // A child of an expanded epic is nested: its position is relative to the
        // container and React Flow clamps it inside (extent: 'parent').
        const parent = parentOf.get(t.id);
        out.push(
          parent
            ? { id: t.id, type: 'todo', position: pos, data, parentId: parent, extent: 'parent' }
            : { id: t.id, type: 'todo', position: pos, data },
        );
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
    // React Flow requires a parent node to appear before its children. Container
    // epics have no parentId; their nested children do — a stable partition by
    // "has parentId" guarantees every container precedes the todos inside it.
    out.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
    return out;
  }, [visibleTodos, struct, todos, subs, openEscalations, positions, parentOf, epicSize, now]);

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
            // Dependency edges: a calm sky-blue, distinct from the indigo (accent)
            // animated claim edges and far more legible than the old muted gray.
            style: { stroke: '#38bdf8', strokeWidth: 1.5 },
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
