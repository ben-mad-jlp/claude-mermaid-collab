/**
 * Topic Graph - Interactive graph visualization using React Flow
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useOnboarding } from './OnboardingLayout';
import { onboardingApi } from '@/lib/onboarding-api';
import type { Category as Directory, ProgressEntry, GraphNode as ApiGraphNode, GraphEdge as ApiGraphEdge } from '@/lib/onboarding-api';

const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

// ─── Custom Node ───────────────────────────────────────────────────────────

interface TopicNodeData {
  label: string;
  color: string;
  explored: boolean;
  onboardMode: boolean;
  [key: string]: unknown;
}

const TopicNode: React.FC<NodeProps<Node<TopicNodeData>>> = ({ data }) => {
  const { label, color, explored, onboardMode } = data;
  const isHollow = onboardMode && !explored;

  return (
    <div className="group relative flex items-center justify-center">
      <Handle type="target" position={Position.Top} className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0" />
      <div
        className="w-5 h-5 rounded-full transition-transform group-hover:scale-150 cursor-pointer"
        style={{
          backgroundColor: isHollow ? 'white' : color,
          border: isHollow ? `2.5px solid ${color}` : 'none',
          boxShadow: `0 0 0 2px white, 0 1px 3px rgba(0,0,0,0.15)`,
        }}
      />
      <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="px-2 py-0.5 text-xs font-semibold bg-gray-900 text-white rounded shadow-lg">
          {label}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0" />
    </div>
  );
};

const nodeTypes = { topic: TopicNode };

// ─── Force layout (simple spring-based) ────────────────────────────────────

function forceLayout(
  apiNodes: ApiGraphNode[],
  apiEdges: ApiGraphEdge[],
  colorMap: Map<string, string>,
  exploredSet: Set<string>,
  onboardMode: boolean,
): { nodes: Node<TopicNodeData>[]; edges: Edge[] } {
  // Initialize positions
  const N = apiNodes.length;
  const simNodes = apiNodes.map((n, i) => ({
    ...n,
    x: (Math.random() - 0.5) * 600,
    y: (Math.random() - 0.5) * 600,
    vx: 0,
    vy: 0,
  }));

  const nodeMap = new Map(simNodes.map(n => [n.id, n]));
  const repulsion = Math.max(1500, N * 30);
  const idealLen = Math.max(100, Math.sqrt(800 * 800 / N) * 0.8);

  // Run simulation synchronously (fast for <200 nodes)
  for (let iter = 0; iter < 300; iter++) {
    // Repulsion
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = simNodes[i], b = simNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        const f = repulsion / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // Edge attraction
    for (const e of apiEdges) {
      const s = nodeMap.get(e.source);
      const t = nodeMap.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - idealLen) * 0.006;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }

    // Center gravity
    for (const n of simNodes) {
      n.vx -= n.x * 0.001;
      n.vy -= n.y * 0.001;
    }

    // Integrate with damping
    const damp = Math.max(0.1, 0.9 - iter * 0.002);
    for (const n of simNodes) {
      n.vx *= damp;
      n.vy *= damp;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  // Convert to React Flow format
  const nodes: Node<TopicNodeData>[] = simNodes.map(n => ({
    id: n.id,
    type: 'topic',
    position: { x: n.x, y: n.y },
    data: {
      label: n.name,
      color: colorMap.get(n.directory) || '#9ca3af',
      explored: exploredSet.has(n.id),
      onboardMode,
    },
    draggable: true,
  }));

  const edges: Edge[] = apiEdges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    style: { stroke: '#d1d5db', strokeWidth: 1 },
    animated: false,
  }));

  return { nodes, edges };
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TopicGraph: React.FC = () => {
  const { project, mode, currentUser } = useOnboarding();
  const navigate = useNavigate();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopicNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [selectedDirectories, setSelectedDirectories] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const exploredSet = useMemo(() => new Set(
    progress.filter(p => p.status === 'explored').map(p => p.filePath)
  ), [progress]);

  // ─── Data fetch & layout ────────────────────────────────────────────────

  useEffect(() => {
    if (!project) return;
    setLoading(true);

    const promises: Promise<any>[] = [
      onboardingApi.getGraph(project),
      onboardingApi.getDirectories(project),
    ];
    if (mode === 'onboard' && currentUser) {
      promises.push(onboardingApi.getProgress(project, currentUser.id));
    }

    Promise.all(promises).then(([graphData, dirs, prog]) => {
      setDirectories(dirs);
      if (prog) setProgress(prog);

      const colorMap = new Map<string, string>();
      (dirs as Directory[]).forEach((d, i) => {
        colorMap.set(d.name, CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
      });

      const explored = prog
        ? new Set((prog as ProgressEntry[]).filter(p => p.status === 'explored').map(p => p.filePath))
        : new Set<string>();

      const { nodes: layoutNodes, edges: layoutEdges } = forceLayout(
        graphData.nodes,
        graphData.edges,
        colorMap,
        explored,
        mode === 'onboard',
      );

      setNodes(layoutNodes);
      setEdges(layoutEdges);
    }).finally(() => setLoading(false));
  }, [project, mode, currentUser, setNodes, setEdges]);

  // ─── Node click ─────────────────────────────────────────────────────────

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    navigate(`/onboarding/topic/${node.id}`);
  }, [navigate]);

  // ─── Directory filter ────────────────────────────────────────────────────

  const toggleDirectory = useCallback((dir: string) => {
    setSelectedDirectories(prev => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });
  }, []);

  // Apply directory visibility
  const visibleNodes = useMemo(() => {
    if (selectedDirectories.size === 0) return nodes;
    const dirNodes = new Set<string>();
    nodes.forEach(n => {
      const color = n.data.color;
      const dirIndex = CATEGORY_COLORS.indexOf(color);
      if (dirIndex >= 0 && dirIndex < directories.length && selectedDirectories.has(directories[dirIndex].name)) {
        dirNodes.add(n.id);
      }
    });
    return nodes.map(n => ({
      ...n,
      hidden: !dirNodes.has(n.id),
    }));
  }, [nodes, selectedDirectories, directories]);

  const visibleEdges = useMemo(() => {
    if (selectedDirectories.size === 0) return edges;
    const visibleIds = new Set(visibleNodes.filter(n => !n.hidden).map(n => n.id));
    return edges.map(e => ({
      ...e,
      hidden: !visibleIds.has(e.source) || !visibleIds.has(e.target),
    }));
  }, [edges, visibleNodes, selectedDirectories]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading graph...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">File Graph</h2>
      </div>

      {/* Directory filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        {directories.map((dir, i) => {
          const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          const active = selectedDirectories.size === 0 || selectedDirectories.has(dir.name);
          return (
            <button
              key={dir.name}
              onClick={() => toggleDirectory(dir.name)}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg border transition-opacity ${active ? 'opacity-100' : 'opacity-40'}`}
              style={{ borderColor: color }}
            >
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="capitalize text-gray-700 dark:text-gray-300">{dir.name}</span>
            </button>
          );
        })}
      </div>

      {/* Graph */}
      <div className="flex-1 min-h-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'default' }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => {
              const data = n.data as TopicNodeData;
              return data?.color || '#9ca3af';
            }}
            maskColor="rgba(0,0,0,0.1)"
          />
        </ReactFlow>
      </div>

      <p className="text-xs text-gray-400 mt-2">Scroll to zoom, drag to pan, click a node to view file</p>
    </div>
  );
};
