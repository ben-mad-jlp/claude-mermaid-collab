/**
 * TodoNode — a leaf work-graph todo in the FleetGraph (BR-3).
 *
 * Status pill via the funnel bucket, a retry badge, and a DANGER RING when a
 * worker on this todo has an open escalation. Semantic zoom: L0 dot → L1 pill →
 * L2 full card. React.memo on data so unrelated store churn never re-renders it.
 */

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FUNNEL_LABELS, STATUS_STYLE } from '../../funnel';
import type { TodoNodeData } from '../types';
import { useLod } from '../useLod';
import { useDeckStore } from '@/stores/deckStore';

const TodoNodeImpl: React.FC<NodeProps> = ({ id, data }) => {
  const d = data as TodoNodeData;
  const lod = useLod();
  const selectedNodeId = useDeckStore((s) => s.selectedNodeId);
  const focusNodeId = useDeckStore((s) => s.focusNodeId);
  const selected = selectedNodeId === id;
  const focused = focusNodeId === id;
  const style = STATUS_STYLE[d.bucket];

  const ring = d.danger
    ? `ring-2 ring-danger-500${focused ? ' animate-pulse' : ''}`
    : selected
      ? 'ring-2 ring-accent-500'
      : 'ring-1 ring-gray-200 dark:ring-gray-700';

  return (
    <div
      className={`relative rounded-md bg-white dark:bg-gray-900 ${ring}`}
      style={{ width: lod === 0 ? 16 : 180 }}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      {lod === 0 ? (
        <div className={`h-4 w-4 rounded-full ${style.dot}`} title={d.title} />
      ) : (
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${style.pill}`}>{FUNNEL_LABELS[d.bucket]}</span>
            {d.retryCount > 0 && (
              <span className="px-1 rounded text-xs font-semibold bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300">
                ↺{d.retryCount}
              </span>
            )}
            {d.danger && <span className="text-danger-500 text-xs" aria-hidden="true">⚠</span>}
          </div>
          {lod === 2 && (
            <div className="mt-1 text-xs text-gray-800 dark:text-gray-200 line-clamp-2">{d.title}</div>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  );
};

export const TodoNode = React.memo(TodoNodeImpl);
export default TodoNode;
