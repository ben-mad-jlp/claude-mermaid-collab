/**
 * BlueprintGraph — renders the daemon's per-todo leaf blueprint as a React Flow DAG
 * (the nicer graph, not mermaid). Columns: the leaf (root) → its tasks → the files each
 * task touches. Create vs edit files are color-coded; files not claimed by a task hang
 * off the leaf so nothing is orphaned. Read-only viz. Reuses the FleetGraph dagre layout
 * (layoutFleet) and @xyflow/react. Source data: GET /api/leaf-executor/blueprint/:leafId.
 */
import React, { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutFleet, type LayoutNode, type LayoutEdge } from '@/components/supervisor/bridge/fleet/layout';

export interface BlueprintManifest {
  estimatedFiles: number;
  estimatedTasks: number;
  nonEnumerableFanout: boolean;
  filesToCreate: string[];
  filesToEdit: string[];
  tasks: Array<{ id: string; files: string[]; description: string }>;
}

export interface BlueprintGraphProps {
  title: string;
  manifest: BlueprintManifest;
}

const SIZES = {
  leaf: { w: 240, h: 56 },
  task: { w: 220, h: 54 },
  file: { w: 240, h: 34 },
};

const NODE_STYLE: Record<string, React.CSSProperties> = {
  leaf: { background: 'rgb(79 70 229)', color: '#fff', border: 'none', fontWeight: 600 },
  task: { background: 'rgb(219 234 254)', color: 'rgb(30 64 175)', border: '1px solid rgb(147 197 253)' },
  'file-new': { background: 'rgb(220 252 231)', color: 'rgb(21 128 61)', border: '1px solid rgb(134 239 172)' },
  'file-edit': { background: 'rgb(243 244 246)', color: 'rgb(75 85 99)', border: '1px solid rgb(209 213 219)' },
};

const ROOT = '__leaf__';
const fileId = (f: string) => `file:${f}`;
const taskId = (t: { id: string }, i: number) => `task:${t.id || i}`;

export const BlueprintGraph: React.FC<BlueprintGraphProps> = ({ title, manifest }) => {
  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const createSet = new Set(manifest.filesToCreate);
    const lnodes: LayoutNode[] = [{ id: ROOT, ...({ width: SIZES.leaf.w, height: SIZES.leaf.h }) }];
    const ledges: LayoutEdge[] = [];
    const rank = new Map<string, number>([[ROOT, 0]]);
    const seenFile = new Set<string>();
    const addFile = (f: string) => {
      const id = fileId(f);
      if (!seenFile.has(f)) { seenFile.add(f); lnodes.push({ id, width: SIZES.file.w, height: SIZES.file.h }); rank.set(id, 2); }
      return id;
    };

    manifest.tasks.forEach((t, i) => {
      const tid = taskId(t, i);
      lnodes.push({ id: tid, width: SIZES.task.w, height: SIZES.task.h });
      rank.set(tid, 1);
      ledges.push({ source: ROOT, target: tid });
      for (const f of t.files) ledges.push({ source: tid, target: addFile(f) });
    });
    for (const f of [...manifest.filesToCreate, ...manifest.filesToEdit]) {
      if (!seenFile.has(f)) ledges.push({ source: ROOT, target: addFile(f) });
    }

    const pos = layoutFleet(lnodes, ledges, (id) => rank.get(id), 'LR');
    const kindOf = (id: string): keyof typeof NODE_STYLE => {
      if (id === ROOT) return 'leaf';
      if (id.startsWith('task:')) return 'task';
      const f = id.slice('file:'.length);
      return createSet.has(f) ? 'file-new' : 'file-edit';
    };
    const labelOf = (id: string): string => {
      if (id === ROOT) return title;
      if (id.startsWith('task:')) {
        const idx = lnodes.findIndex((n) => n.id === id);
        const t = manifest.tasks.find((x, i) => taskId(x, i) === id);
        return t?.description?.slice(0, 80) || t?.id || `task ${idx}`;
      }
      return id.slice('file:'.length);
    };

    const rfNodes: Node[] = lnodes.map((n) => {
      const kind = kindOf(n.id);
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: { label: labelOf(n.id) },
        draggable: false,
        style: { ...NODE_STYLE[kind], width: n.width, fontSize: 11, borderRadius: 8, padding: 6 },
      };
    });
    const rfEdges: Edge[] = ledges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, style: { stroke: 'rgb(156 163 175)' } }));
    return { nodes: rfNodes, edges: rfEdges };
  }, [title, manifest]);

  if (manifest.tasks.length === 0 && manifest.filesToCreate.length === 0 && manifest.filesToEdit.length === 0) {
    return <div className="p-3 text-xs text-gray-400 dark:text-gray-500">Blueprint has no enumerated tasks/files{manifest.nonEnumerableFanout ? ' (non-enumerable fanout)' : ''}.</div>;
  }

  return (
    <div style={{ height: 320 }} className="rounded border border-gray-200 dark:border-gray-700">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export default BlueprintGraph;
