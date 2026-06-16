/**
 * FleetGraph — the live React Flow fleet view (BR-3, design §3/§6/§8).
 *
 * Fills the SplitDeck right half: epics, todos and workers as nodes; dependency
 * edges (muted/static) and claim edges (the only animated/accent ones). Layout
 * is dagre LR with columns seeded from the work-graph waves. Semantic zoom
 * (L0 dots → L1 pills → L2 cards) is driven by the live zoom + a HUD override.
 * Clicking a worker dives into its Studio; any click spotlights the node
 * (deckStore, two-way with the left panel). Epics collapse/expand on click.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDiveIn, type DiveTarget } from '@/hooks/useDiveIn';
import { useDeckStore, type Lod } from '@/stores/deckStore';
import { useSupervisorStore, type Escalation } from '@/stores/supervisorStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import type { SessionTodo } from '@/types/sessionTodo';
import { EpicNode } from './nodes/EpicNode';
import { TodoNode } from './nodes/TodoNode';
import { WorkerNode } from './nodes/WorkerNode';
import { useFleetGraph, type WorkerSub } from './useFleetGraph';

const NODE_TYPES: NodeTypes = {
  epic: EpicNode,
  todo: TodoNode,
  worker: WorkerNode,
};

export interface FleetGraphProps {
  todos: SessionTodo[];
  /**
   * Live worker subscriptions — drives the worker nodes + animated claim edges.
   * OPTIONAL so the graph can render from todos+deps alone (e.g. the task view)
   * with no worker/claim overlay. Defaults to no workers.
   */
  subs?: WorkerSub[];
  /**
   * Open escalations — drives the danger tint + focal-card affordance. OPTIONAL
   * (no danger overlay when absent). Defaults to none.
   */
  openEscalations?: Escalation[];
  /**
   * Bridge P5: override the worker-node click. When provided, clicking a worker
   * selects+shows its session IN PLACE (stays in Bridge, swaps the Z3 artifact
   * pane) instead of the default dive-to-Studio. Absent → default dive.
   */
  onWorkerSelect?: (target: DiveTarget) => void;
  /**
   * Notified when a todo node is clicked, with the clicked todo. The Bridge wires
   * this to surface the TodoDetailView in its left panel. OPTIONAL — absent (e.g.
   * the task view) → clicking a todo just spotlights the node, no detail callout.
   */
  onSelectTodo?: (todo: SessionTodo) => void;
  /**
   * Notified when an epic node is clicked, with the epic's todo id + label. The
   * Bridge wires this to surface the EpicHistoryView (escalation + decision history
   * for the epic). OPTIONAL — absent → clicking an epic just spotlights it.
   */
  onSelectEpic?: (epic: { id: string; label: string }) => void;
}

const LOD_LABELS: Record<Lod | 'auto', string> = { auto: 'Auto', 0: 'L0', 1: 'L1', 2: 'L2' };

const FleetGraphInner: React.FC<FleetGraphProps> = ({ todos, subs = [], openEscalations = [], onWorkerSelect, onSelectTodo, onSelectEpic }) => {
  const diveIn = useDiveIn();
  const setSelectedNodeId = useDeckStore((s) => s.setSelectedNodeId);
  const forcedLod = useDeckStore((s) => s.forcedLod);
  const setForcedLod = useDeckStore((s) => s.setForcedLod);
  const setFocalEscalationId = useDeckStore((s) => s.setFocalEscalationId);
  const setFocusNodeId = useDeckStore((s) => s.setFocusNodeId);
  const focusNodeId = useDeckStore((s) => s.focusNodeId);
  const setActiveProject = useUIStore((s) => s.setActiveProject);
  const setSelectedProject = useProjectStore((s) => s.setSelectedProject);
  const { fitView } = useReactFlow();

  // Graph-answers-the-card: when a decision is focused, frame its todo node.
  useEffect(() => {
    if (focusNodeId) fitView({ nodes: [{ id: focusNodeId }], duration: 250, maxZoom: 1.2 });
  }, [focusNodeId, fitView]);

  // Map a todo id → the open escalation on its claiming/assigned worker.
  const escalationForTodo = useCallback(
    (todoId: string) => {
      const todo = todos.find((t) => t.id === todoId);
      if (!todo) return null;
      return (
        openEscalations.find(
          (e) => e.session === todo.claimedBy || e.session === todo.assigneeSession || e.session === todo.sessionName,
        ) ?? null
      );
    },
    [todos, openEscalations],
  );

  // G1: epics are ALWAYS expanded — every epic renders as a framed container
  // with its todos nested inside. `expandedEpics` is therefore the full set of
  // epic ids (any todo that has children). It's a pure function of topology, so
  // it only changes when the work-graph structure changes — never per tick
  // (never-jump). No collapse-by-default, no click-to-collapse.
  const expandedEpics = useMemo(() => {
    const ids = new Set(todos.map((t) => t.id));
    const epics = new Set<string>();
    for (const t of todos) if (t.parentId && ids.has(t.parentId)) epics.add(t.parentId);
    return epics;
  }, [todos]);

  // Tick for liveness staleness re-eval (data merge only — no relayout).
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // The fleet graph flows left→right (LR): dependency waves read as columns
  // advancing rightward, which suits the full-width bottom graph strip.
  const direction = 'LR';
  // G3: only the coordinator-spawned sessions count as "working fleet" workers
  // (plus any session currently holding a claimed in_progress todo, derived in
  // the hook). Foreground operators registered in the subscription store are
  // filtered out so they don't show up as idle worker nodes.
  const supervised = useSupervisorStore((s) => s.supervised);
  const spawnedSessions = useMemo(
    () => new Set(supervised.filter((s) => s.source === 'spawn').map((s) => s.session)),
    [supervised],
  );
  const { nodes, edges } = useFleetGraph({ todos, subs, openEscalations, expandedEpics, now, direction, spawnedSessions });

  // Fit the graph to its pane once nodes populate and after each relayout — the
  // <ReactFlow fitView> prop only fires on the initial (empty) mount, which left
  // the graph stuck at min-zoom showing a sliver. Keyed on a layout signature
  // (node count + collapsed-epic set) so it re-fits on populate / expand / collapse.
  const layoutSig = `${nodes.length}:${expandedEpics.size}`;
  useEffect(() => {
    if (nodes.length === 0) return;
    const raf = requestAnimationFrame(() => fitView({ padding: 0.1, duration: 200, maxZoom: 1.2 }));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, fitView]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_evt, node) => {
      setSelectedNodeId(node.id);
      if (node.type === 'epic') {
        // G1: epics are always expanded — clicking spotlights the container (no
        // collapse toggle) and, when wired, surfaces the epic's escalation +
        // decision history in the host (Bridge Column 2).
        const epicData = node.data as { label?: string } | undefined;
        onSelectEpic?.({ id: node.id, label: epicData?.label ?? node.id });
        return;
      }
      if (node.type === 'worker') {
        const session = node.id.slice('worker:'.length);
        const sub = subs.find((s) => s.session === session);
        if (sub) {
          const target = { project: sub.project, session, serverId: sub.serverId };
          // Multi-project fleet view follows the worker you clicked: switch the
          // active/selected project context to the clicked worker's project so the
          // rest of the UI re-scopes to it. A worker already in the selected
          // project is a no-op for selection (the setters short-circuit on equal
          // value). This is alongside — not instead of — the terminal-open below.
          setActiveProject(target.project);
          setSelectedProject(target.project);
          // P5: select-in-place (stay in Bridge, swap the artifact pane) when the
          // host wires it; otherwise the default dive-to-Studio.
          if (onWorkerSelect) onWorkerSelect(target);
          else diveIn(target);
        }
        return;
      }
      if (node.type === 'todo') {
        // Surface the clicked todo's detail in the host (Bridge left panel) when
        // wired; the task view passes no handler → spotlight only.
        const todo = todos.find((t) => t.id === node.id);
        if (todo) onSelectTodo?.(todo);
        // A danger todo (worker has an open escalation) opens the focal card and
        // frames the node (graph-answers-the-card).
        const esc = escalationForTodo(node.id);
        if (esc) {
          setFocusNodeId(node.id);
          setFocalEscalationId(esc.id);
        }
      }
    },
    [diveIn, onWorkerSelect, onSelectTodo, onSelectEpic, todos, subs, setSelectedNodeId, escalationForTodo, setFocalEscalationId, setFocusNodeId, setActiveProject, setSelectedProject],
  );

  const lodButtons = useMemo<(Lod | 'auto')[]>(() => ['auto', 0, 1, 2], []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={onNodeClick}
      onPaneClick={() => setSelectedNodeId(null)}
      onlyRenderVisibleElements
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="!bg-gray-50 dark:!bg-gray-900"
    >
      <Controls
        showInteractive={false}
        className="!shadow-sm [&_button]:!bg-white dark:[&_button]:!bg-gray-800 [&_button]:!border-gray-200 dark:[&_button]:!border-gray-700 [&_button:hover]:!bg-gray-100 dark:[&_button:hover]:!bg-gray-700 [&_path]:!fill-gray-600 dark:[&_path]:!fill-gray-200"
      />
      <Panel position="top-right" className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-800/90 px-1.5 py-1">
        {lodButtons.map((l) => {
          const active = l === 'auto' ? forcedLod === null : forcedLod === l;
          return (
            <button
              key={String(l)}
              type="button"
              onClick={() => setForcedLod(l === 'auto' ? null : l)}
              className={`px-1.5 py-0.5 text-xs rounded ${
                active
                  ? 'bg-accent-100 dark:bg-accent-900/50 text-accent-700 dark:text-accent-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {LOD_LABELS[l]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => fitView({ duration: 200 })}
          className="px-1.5 py-0.5 text-xs rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="Fit view"
        >
          ⤢ Fit
        </button>
      </Panel>
    </ReactFlow>
  );
};

export const FleetGraph: React.FC<FleetGraphProps> = (props) => (
  <div data-testid="fleet-graph" className="flex-1 h-full min-h-0">
    <ReactFlowProvider>
      <FleetGraphInner {...props} />
    </ReactFlowProvider>
  </div>
);

export default FleetGraph;
