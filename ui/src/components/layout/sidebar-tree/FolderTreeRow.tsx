import React from 'react';
import { ChevronIcon } from './TreeBranchRow';

interface FolderTreeRowProps {
  name: string;
  count?: number;
  collapsed: boolean;
  level: number;
  onToggle: () => void;
}

export function FolderTreeRow({ name, count, collapsed, level, onToggle }: FolderTreeRowProps) {
  return (
    <div
      style={{ paddingLeft: `${level * 16}px` }}
      className="flex items-center gap-1.5 py-0.5 px-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer select-none"
      onClick={onToggle}
      role="treeitem"
      aria-expanded={!collapsed}
    >
      <ChevronIcon isDown={!collapsed} />
      <span className="truncate">{name}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="text-gray-400 dark:text-gray-500 ml-0.5">({count})</span>
      )}
    </div>
  );
}

export default FolderTreeRow;
