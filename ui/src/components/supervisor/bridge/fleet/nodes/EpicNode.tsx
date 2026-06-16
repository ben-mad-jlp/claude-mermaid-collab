/**
 * EpicNode — a parent (parentId == null) work-graph epic in the FleetGraph
 * (BR-3). Shows a label + a rollup bar of its children's funnel buckets.
 * Collapsed by default (children hidden); the FleetGraph owns the collapse
 * topology, this node just paints the summary and a toggle affordance.
 */

import React from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { EdgeHandle } from './EdgeHandle';
import { STATUS_STYLE, type FunnelKey } from '../../funnel';
import type { EpicNodeData } from '../types';
import { useDeckStore } from '@/stores/deckStore';
import { useWorkerFabricStore } from '@/stores/workerFabricStore';

const ORDER: FunnelKey[] = ['backlog', 'ready', 'inflight', 'blocked', 'done'];

/** Live run-cost rolled up across this epic's worker lanes (design-worker-fabric-ui §6.6). */
const EpicCost: React.FC<{ epicId: string }> = ({ epicId }) => {
  const cost = useWorkerFabricStore((s) => {
    let c = 0;
    for (const l of Object.values(s.lanes)) if (l.epicId === epicId) c += l.runCostUsd;
    return c;
  });
  const live = useWorkerFabricStore((s) => {
    let n = 0;
    for (const l of Object.values(s.lanes)) if (l.epicId === epicId && l.alive) n += 1;
    return n;
  });
  if (cost <= 0 && live <= 0) return null;
  return (
    <span className="ml-1 flex items-center gap-1 text-3xs tabular-nums" title="epic run cost / live lanes">
      {live > 0 && <span className="font-semibold text-accent-600 dark:text-accent-400">{live}λ</span>}
      {cost > 0 && <span className="text-gray-500 dark:text-gray-400">${cost.toFixed(2)}</span>}
    </span>
  );
};

const StatusBar: React.FC<{ counts: EpicNodeData['counts'] }> = ({ counts }) => (
  <div className="mt-1.5 flex h-2 rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
    {ORDER.map((k) =>
      counts[k] > 0 ? (
        <span
          key={k}
          className={STATUS_STYLE[k].dot}
          style={{ flexGrow: counts[k], flexBasis: 0 }}
          title={`${k}: ${counts[k]}`}
        />
      ) : null,
    )}
  </div>
);

const EpicNodeImpl: React.FC<NodeProps> = ({ id, data }) => {
  const d = data as EpicNodeData;
  const selectedNodeId = useDeckStore((s) => s.selectedNodeId);
  const selected = selectedNodeId === id;
  const ring = selected ? 'ring-2 ring-accent-500 border-accent-300' : 'border-gray-300 dark:border-gray-600';

  // Expanded → a framed container: the header band (label + status bar) sits at
  // the top; the body is transparent so the nested child nodes show through.
  if (d.expanded) {
    return (
      <div
        className={`rounded-lg border bg-gray-100 dark:bg-gray-800 ${ring}`}
        style={{ width: d.width, height: d.height }}
      >
        <EdgeHandle type="target" position={Position.Left} />
        <div className="px-3 pt-2 pb-1.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-t-lg">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">epic</span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{d.label}</span>
            <span className="ml-auto text-xs text-gray-400">{d.total}</span>
            <EpicCost epicId={id} />
          </div>
          <StatusBar counts={d.counts} />
        </div>
        <EdgeHandle type="source" position={Position.Right} />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg bg-white dark:bg-gray-900 border px-3 py-2 ${ring}`}
      style={{ width: 200 }}
    >
      <EdgeHandle type="target" position={Position.Left} />
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{d.label}</span>
        <span className="ml-auto text-xs text-gray-400">{d.total}</span>
        <EpicCost epicId={id} />
      </div>
      <StatusBar counts={d.counts} />
      <EdgeHandle type="source" position={Position.Right} />
    </div>
  );
};

export const EpicNode = React.memo(EpicNodeImpl);
export default EpicNode;
