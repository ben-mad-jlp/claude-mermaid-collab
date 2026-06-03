/**
 * EpicNode — a parent (parentId == null) work-graph epic in the FleetGraph
 * (BR-3). Shows a label + a rollup bar of its children's funnel buckets.
 * Collapsed by default (children hidden); the FleetGraph owns the collapse
 * topology, this node just paints the summary and a toggle affordance.
 */

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FunnelKey } from '../../funnel';
import type { EpicNodeData } from '../types';
import { useDeckStore } from '@/stores/deckStore';

const ROLLUP_COLOR: Record<FunnelKey, string> = {
  backlog: 'bg-gray-400',
  ready: 'bg-gray-500',
  inflight: 'bg-info-500',
  blocked: 'bg-danger-500',
  done: 'bg-success-500',
};

const ORDER: FunnelKey[] = ['backlog', 'ready', 'inflight', 'blocked', 'done'];

const EpicNodeImpl: React.FC<NodeProps> = ({ id, data }) => {
  const d = data as EpicNodeData;
  const selectedNodeId = useDeckStore((s) => s.selectedNodeId);
  const selected = selectedNodeId === id;

  return (
    <div
      className={`rounded-lg bg-white dark:bg-gray-900 border px-3 py-2 ${
        selected ? 'ring-2 ring-accent-500 border-accent-300' : 'border-gray-300 dark:border-gray-600'
      }`}
      style={{ width: 200 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{d.label}</span>
        <span className="ml-auto text-xs text-gray-400">{d.total}</span>
      </div>
      <div className="mt-1.5 flex h-2 rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
        {ORDER.map((k) =>
          d.counts[k] > 0 ? (
            <span
              key={k}
              className={ROLLUP_COLOR[k]}
              style={{ flexGrow: d.counts[k], flexBasis: 0 }}
              title={`${k}: ${d.counts[k]}`}
            />
          ) : null,
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  );
};

export const EpicNode = React.memo(EpicNodeImpl);
export default EpicNode;
