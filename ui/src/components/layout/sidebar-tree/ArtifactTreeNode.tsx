import React from 'react';
import type { TreeNode } from './getActionsForNode';

interface ArtifactTreeNodeProps {
  node: TreeNode;
  displayName?: string;
  selected?: boolean;
  isInMultiSelection?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onTogglePin?: (e: React.MouseEvent) => void;
}

function iconFor(_node: TreeNode): React.ReactElement {
  return (
    <span className="w-4 h-4 shrink-0 flex items-center justify-center text-gray-400 dark:text-gray-500">
      <span className="w-1.5 h-1.5 rounded-full border border-current" />
    </span>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

function ArtifactTreeNodeImpl({
  node,
  displayName,
  selected,
  isInMultiSelection,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  onTogglePin,
}: ArtifactTreeNodeProps) {
  const highlighted = selected || isInMultiSelection;
  const className =
    'w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 cursor-pointer group ' +
    (highlighted
      ? 'bg-accent-100 dark:bg-accent-900 text-accent-700 dark:text-accent-300 hover:bg-accent-200 dark:hover:bg-accent-800'
      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800') +
    (node.deprecated ? ' opacity-60 line-through' : '');

  return (
    <div
      role="treeitem"
      aria-selected={!!selected}
      tabIndex={0}
      data-node-id={node.id}
      data-node-kind={node.kind}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className={className}
    >
      {iconFor(node)}
      <span className="truncate flex-1">{displayName ?? node.name}</span>
      {typeof node.lastModified === 'number' && (
        <span
          className="ml-auto text-[10px] tabular-nums text-gray-400 dark:text-gray-500 flex-shrink-0"
          title={new Date(node.lastModified).toLocaleString()}
        >
          {formatAgo(node.lastModified)}
        </span>
      )}
      {(node.pinned || onTogglePin) && (
        <button
          type="button"
          data-testid="pin-indicator"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin?.(e);
          }}
          title={node.pinned ? 'Unpin' : 'Pin to top'}
          aria-label={node.pinned ? `Unpin ${displayName ?? node.name}` : `Pin ${displayName ?? node.name}`}
          className={`p-0.5 rounded transition-all ${
            node.pinned
              ? 'opacity-100 text-accent-500 dark:text-accent-400 hover:text-accent-600'
              : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-accent-500 dark:text-gray-500 dark:hover:text-accent-400'
          }`}
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill={node.pinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="17" x2="12" y2="22" />
            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const ArtifactTreeNode = React.memo(ArtifactTreeNodeImpl);
export default ArtifactTreeNode;
