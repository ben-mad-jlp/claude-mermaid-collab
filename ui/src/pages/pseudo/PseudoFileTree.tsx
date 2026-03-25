/**
 * PseudoFileTree Component
 *
 * Left sidebar component for pseudo-file navigation.
 * Features:
 * - Nested tree display from flat file list
 * - Filter with case-insensitive substring matching
 * - Collapse/expand state persistence to localStorage
 * - Active file highlighting
 * - Project dropdown selector
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { buildTree, deepSortTree, filterTree, type TreeNode } from './tree.utils';

// Re-export TreeNode for public API
export type { TreeNode };

export type PseudoFileTreeProps = {
  fileList: string[];
  currentPath: string;
  onNavigate: (stem: string) => void;
  project: string;
  onProjectChange: (project: string) => void;
};

/**
 * Chevron icon component using CSS
 */
function ChevronIcon({ isDown }: { isDown: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isDown ? 'rotate(0deg)' : 'rotate(-90deg)',
        transition: 'transform 0.2s',
      }}
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );
}

/**
 * TreeNode renderer component
 */
function TreeNodeRenderer({
  node,
  level,
  currentPath,
  collapsedDirs,
  onToggleCollapse,
  onNavigate,
  filterExpanded,
}: {
  node: TreeNode;
  level: number;
  currentPath: string;
  collapsedDirs: Set<string>;
  onToggleCollapse: (path: string) => void;
  onNavigate: (path: string) => void;
  filterExpanded: Set<string>;
}) {
  const isCollapsed = collapsedDirs.has(node.path);
  const isActive = !node.isDir && node.path === currentPath;
  const hasChildren = node.children.length > 0;
  const shouldShowChildren = !isCollapsed || filterExpanded.has(node.path);
  const fileCount = node.children.length;

  return (
    <div key={node.path}>
      <div
        data-testid="tree-node"
        style={{ paddingLeft: `${level * 16}px` }}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded ${
          isActive ? 'bg-purple-50 text-purple-700' : 'hover:bg-gray-100'
        }`}
      >
        {node.isDir && hasChildren && (
          <button
            className="p-0 flex-shrink-0 inline-flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(node.path);
            }}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronIcon isDown={!isCollapsed} />
          </button>
        )}
        {(!node.isDir || !hasChildren) && (
          <div className="w-4 flex-shrink-0" />
        )}

        <div
          className="flex-1 text-sm"
          onClick={() => !node.isDir && onNavigate(node.path)}
        >
          {node.name}
          {node.isDir && isCollapsed && fileCount > 0 && (
            <span className="text-gray-500 ml-1">({fileCount})</span>
          )}
        </div>
      </div>

      {shouldShowChildren && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRenderer
              key={child.path}
              node={child}
              level={level + 1}
              currentPath={currentPath}
              collapsedDirs={collapsedDirs}
              onToggleCollapse={onToggleCollapse}
              onNavigate={onNavigate}
              filterExpanded={filterExpanded}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * PseudoFileTree Component
 */
export function PseudoFileTree({
  fileList,
  currentPath,
  onNavigate,
  project,
  onProjectChange,
}: PseudoFileTreeProps) {
  const sessions = useSessionStore((s) => s.sessions);

  // Derive unique project paths from sessions
  const projects = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of sessions) {
      if (s.project && !seen.has(s.project)) {
        seen.add(s.project);
        result.push(s.project);
      }
    }
    return result;
  }, [sessions]);

  const [filter, setFilter] = useState('');
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const key = `pseudo-tree-collapsed-${project}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const collapsed = JSON.parse(stored);
        setCollapsedDirs(new Set(collapsed));
      } catch {
        // Ignore parse errors
      }
    }
  }, [project]);

  // Build and sort the tree
  const tree = useMemo(() => {
    const builtTree = buildTree(fileList);
    return deepSortTree(builtTree);
  }, [fileList]);

  // Filter tree and get auto-expand paths
  const { nodes: filteredTree, expandedPaths: filterExpanded } = useMemo(() => {
    const trimmedFilter = filter.trim();
    if (!trimmedFilter) {
      return { nodes: tree, expandedPaths: new Set<string>() };
    }
    return filterTree(tree, trimmedFilter);
  }, [tree, filter]);

  // Handle collapse/expand with localStorage persistence
  const handleToggleCollapse = useCallback(
    (path: string) => {
      setCollapsedDirs((prev) => {
        const updated = new Set(prev);
        if (updated.has(path)) {
          updated.delete(path);
        } else {
          updated.add(path);
        }

        // Persist to localStorage
        const key = `pseudo-tree-collapsed-${project}`;
        localStorage.setItem(key, JSON.stringify(Array.from(updated)));

        return updated;
      });
    },
    [project]
  );

  // Render empty state
  if (fileList.length === 0) {
    return (
      <div className="w-64 border-r border-gray-200 p-4 flex flex-col">
        <div className="text-sm font-semibold text-gray-700 mb-4">Files</div>
        <p className="text-sm text-gray-500">No files</p>
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-gray-200 p-4 flex flex-col h-full overflow-hidden">
      {/* Header with project dropdown */}
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">Files</div>
        {projects.length > 1 && (
          <select
            value={project}
            onChange={(e) => onProjectChange(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 mb-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {projects.map((p) => (
              <option key={p} value={p}>
                {p.split('/').pop() || p}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Filter Input */}
      <input
        type="text"
        placeholder="Filter files..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {filteredTree.length === 0 && filter ? (
          <p className="text-sm text-gray-500">No matches</p>
        ) : (
          filteredTree.map((node) => (
            <TreeNodeRenderer
              key={node.path}
              node={node}
              level={0}
              currentPath={currentPath}
              collapsedDirs={collapsedDirs}
              onToggleCollapse={handleToggleCollapse}
              onNavigate={onNavigate}
              filterExpanded={filterExpanded}
            />
          ))
        )}
      </div>
    </div>
  );
}
