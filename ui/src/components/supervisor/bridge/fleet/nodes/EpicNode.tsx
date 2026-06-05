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

const StatusBar: React.FC<{ counts: EpicNodeData['counts'] }> = ({ counts }) => (
  <div className="mt-1.5 flex h-2 rounded overflow-hidden bg-gray-100 dark:bg-gray-800">
    {ORDER.map((k) =>
      counts[k] > 0 ? (
        <span
          key={k}
          className={ROLLUP_COLOR[k]}
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
        className={`rounded-lg border bg-gray-50/60 dark:bg-gray-900/40 ${ring}`}
        style={{ width: d.width, height: d.height }}
      >
        <Handle type="target" position={Position.Left} className="!bg-gray-400" />
        <div className="px-3 pt-2 pb-1.5 border-b border-gray-200/70 dark:border-gray-700/70 bg-white/70 dark:bg-gray-900/70 rounded-t-lg">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">epic</span>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{d.label}</span>
            <span className="ml-auto text-xs text-gray-400">{d.total}</span>
          </div>
          <StatusBar counts={d.counts} />
        </div>
        <Handle type="source" position={Position.Right} className="!bg-gray-400" />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg bg-white dark:bg-gray-900 border px-3 py-2 ${ring}`}
      style={{ width: 200 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-100 truncate">{d.label}</span>
        <span className="ml-auto text-xs text-gray-400">{d.total}</span>
      </div>
      <StatusBar counts={d.counts} />
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  );
};

export const EpicNode = React.memo(EpicNodeImpl);
export default EpicNode;
