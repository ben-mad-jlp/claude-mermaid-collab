/**
 * WorkerNode — a live worker (supervised ⋈ subscription) in the FleetGraph
 * (BR-3). Live dot + context gauge + claimed-todo title. Liveness comes from the
 * shared lib/liveness deriveLiveness (via the hook), so the node and the roster
 * never disagree. React.memo on data.
 */

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { WorkerNodeData } from '../types';
import type { Liveness } from '@/lib/liveness';
import { useLod } from '../useLod';
import { useDeckStore } from '@/stores/deckStore';

function dotColor(liveness: Liveness): string {
  switch (liveness) {
    case 'crashed':
      return 'bg-danger-500';
    case 'active':
      return 'bg-success-500';
    default:
      return 'bg-gray-300 dark:bg-gray-600';
  }
}

const WorkerNodeImpl: React.FC<NodeProps> = ({ id, data }) => {
  const d = data as WorkerNodeData;
  const lod = useLod();
  const selectedNodeId = useDeckStore((s) => s.selectedNodeId);
  const selected = selectedNodeId === id;
  const ctxHot = typeof d.contextPercent === 'number' && d.contextPercent >= 80;

  return (
    <div
      className={`relative rounded-md bg-white dark:bg-gray-900 border ${
        selected ? 'ring-2 ring-accent-500 border-accent-300' : 'border-gray-300 dark:border-gray-600'
      }`}
      style={{ width: lod === 0 ? 18 : 170 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent-400" />
      {lod === 0 ? (
        <div className="flex items-center justify-center h-[18px]">
          <span className={`h-2.5 w-2.5 rounded-full ${dotColor(d.liveness)}`} title={d.session} />
        </div>
      ) : (
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 h-2 w-2 rounded-full ${dotColor(d.liveness)}`} aria-hidden="true" />
            <span aria-hidden="true">{d.glyph}</span>
            <span className="flex-1 min-w-0 truncate text-xs font-medium text-gray-800 dark:text-gray-100">
              {d.session}
            </span>
          </div>
          {lod === 2 && (
            <>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                {d.todoTitle ?? 'idle'}
              </div>
              {typeof d.contextPercent === 'number' && (
                <div className="mt-1 flex items-center gap-1">
                  <span className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <span
                      className={`block h-full ${ctxHot ? 'bg-danger-500' : 'bg-gray-400 dark:bg-gray-500'}`}
                      style={{ width: `${Math.min(100, Math.max(0, d.contextPercent))}%` }}
                    />
                  </span>
                  <span className={`text-xs tabular-nums ${ctxHot ? 'text-danger-600 dark:text-danger-400' : 'text-gray-400'}`}>
                    {Math.round(d.contextPercent)}%
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-accent-400" />
    </div>
  );
};

export const WorkerNode = React.memo(WorkerNodeImpl);
export default WorkerNode;
