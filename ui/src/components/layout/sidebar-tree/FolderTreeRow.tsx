import React from 'react';
import { ChevronIcon } from './TreeBranchRow';

interface FolderTreeRowProps {
  name: string;
  count?: number;
  collapsed: boolean;
  level: number;
  onToggle: () => void;
  onDeprecateAll?: () => void;
}

export function FolderTreeRow({ name, count, collapsed, level, onToggle, onDeprecateAll }: FolderTreeRowProps) {
  return (
    <div
      style={{ paddingLeft: `${level * 16}px` }}
      className="group flex items-center gap-1.5 py-0.5 px-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none"
      onClick={onToggle}
      role="treeitem"
      aria-expanded={!collapsed}
    >
      <ChevronIcon isDown={!collapsed} />
      <span className="truncate">{name}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-gray-400 dark:text-gray-500 ml-0.5">({count})</span>
      )}
      {onDeprecateAll && (
        <button
          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onDeprecateAll(); }}
          title="Deprecate all in folder"
          aria-label="Deprecate all in folder"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
            <line x1="12" y1="10" x2="12" y2="16" />
            <polyline points="10 14 12 16 14 14" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default FolderTreeRow;
