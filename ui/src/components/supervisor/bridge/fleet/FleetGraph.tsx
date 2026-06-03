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
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDiveIn } from '@/hooks/useDiveIn';
import { useDeckStore, type Lod } from '@/stores/deckStore';
import type { Escalation } from '@/stores/supervisorStore';
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
  subs: WorkerSub[];
  openEscalations: Escalation[];
}

const LOD_LABELS: Record<Lod | 'auto', string> = { auto: 'Auto', 0: 'L0', 1: 'L1', 2: 'L2' };

const FleetGraphInner: React.FC<FleetGraphProps> = ({ todos, subs, openEscalations }) => {
  const diveIn = useDiveIn();
  const setSelectedNodeId = useDeckStore((s) => s.setSelectedNodeId);
  const forcedLod = useDeckStore((s) => s.forcedLod);
  const setForcedLod = useDeckStore((s) => s.setForcedLod);
  const setFocalEscalationId = useDeckStore((s) => s.setFocalEscalationId);
  const setFocusNodeId = useDeckStore((s) => s.setFocusNodeId);
  const focusNodeId = useDeckStore((s) => s.focusNodeId);
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

  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());

  // Tick for liveness staleness re-eval (data merge only — no relayout).
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const { nodes, edges } = useFleetGraph({ todos, subs, openEscalations, expandedEpics, now });

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_evt, node) => {
      setSelectedNodeId(node.id);
      if (node.type === 'epic') {
        setExpandedEpics((cur) => {
          const next = new Set(cur);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        return;
      }
      if (node.type === 'worker') {
        const session = node.id.slice('worker:'.length);
        const sub = subs.find((s) => s.session === session);
        if (sub) diveIn({ project: sub.project, session, serverId: sub.serverId });
        return;
      }
      if (node.type === 'todo') {
        // A danger todo (worker has an open escalation) opens the focal card and
        // frames the node (graph-answers-the-card).
        const esc = escalationForTodo(node.id);
        if (esc) {
          setFocusNodeId(node.id);
          setFocalEscalationId(esc.id);
        }
      }
    },
    [diveIn, subs, setSelectedNodeId, escalationForTodo, setFocalEscalationId, setFocusNodeId],
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
    >
      <Background gap={20} className="!bg-gray-50 dark:!bg-gray-900" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="!bg-white dark:!bg-gray-800" />
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
