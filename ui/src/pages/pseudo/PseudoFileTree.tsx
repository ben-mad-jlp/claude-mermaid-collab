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
import { buildTree, deepSortTree, filterTree, type TreeNode } from './tree.utils';
import type { PseudoFileSummary } from '@/lib/pseudo-api';

// Re-export TreeNode for public API
export type { TreeNode };

export type PseudoFileTreeProps = {
  fileList: PseudoFileSummary[];
  currentPath: string;
  onNavigate: (stem: string) => void;
  project: string;
  onProjectChange?: (project: string) => void;
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
  fileMeta,
}: {
  node: TreeNode;
  level: number;
  currentPath: string;
  collapsedDirs: Set<string>;
  onToggleCollapse: (path: string) => void;
  onNavigate: (path: string) => void;
  filterExpanded: Set<string>;
  fileMeta: Map<string, PseudoFileSummary>;
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
          className="flex-1 text-sm flex items-center gap-1"
          onClick={() => !node.isDir && onNavigate(node.path)}
        >
          <span className="truncate">{node.name}</span>
          {node.isDir && isCollapsed && fileCount > 0 && (
            <span className="text-gray-500 ml-1">({fileCount})</span>
          )}
          {!node.isDir && (() => {
            const meta = fileMeta.get(node.path);
            if (!meta) return null;
            const parts: string[] = [];
            if (meta.methodCount > 0) parts.push(`${meta.methodCount}fn`);
            if (meta.exportCount > 0) parts.push(`${meta.exportCount}exp`);
            if (parts.length === 0) return null;
            return (
              <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                ({parts.join(', ')})
              </span>
            );
          })()}
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
              fileMeta={fileMeta}
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
}: PseudoFileTreeProps) {

  const [filter, setFilter] = useState('');
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  // Strip the project prefix so the tree starts at the project root instead
  // of the filesystem root. Keep a map back to the absolute path for navigation
  // and metadata lookups.
  const projectPrefix = useMemo(
    () => (project ? (project.endsWith('/') ? project : project + '/') : ''),
    [project]
  );

  const toRelative = useCallback(
    (absPath: string): string => {
      if (projectPrefix && absPath.startsWith(projectPrefix)) {
        return absPath.slice(projectPrefix.length);
      }
      return absPath;
    },
    [projectPrefix]
  );

  // File paths for tree building (relative to project root)
  const filePaths = useMemo(
    () => fileList.map(f => toRelative(f.filePath)),
    [fileList, toRelative]
  );

  // Relative path → absolute path, used when navigating
  const relativeToAbsolute = useMemo(() => {
    const map = new Map<string, string>();
    fileList.forEach(f => map.set(toRelative(f.filePath), f.filePath));
    return map;
  }, [fileList, toRelative]);

  // Build lookup map for metadata, keyed by relative path to match tree nodes
  const fileMeta = useMemo(() => {
    const map = new Map<string, PseudoFileSummary>();
    fileList.forEach(f => map.set(toRelative(f.filePath), f));
    return map;
  }, [fileList, toRelative]);

  // currentPath arrives as an absolute path from the URL — relativize it for
  // the isActive comparison against tree node paths.
  const currentRelativePath = useMemo(
    () => (currentPath ? toRelative(currentPath) : ''),
    [currentPath, toRelative]
  );

  // Wrap onNavigate to convert the tree node's relative path back to absolute.
  const handleTreeNavigate = useCallback(
    (relPath: string) => {
      onNavigate(relativeToAbsolute.get(relPath) ?? relPath);
    },
    [onNavigate, relativeToAbsolute]
  );

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
    const builtTree = buildTree(filePaths);
    return deepSortTree(builtTree);
  }, [filePaths]);

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
      <div className="w-full h-full p-4 flex flex-col">
        <div className="text-sm font-semibold text-gray-700 mb-4">Files</div>
        <p className="text-sm text-gray-500">No files</p>
      </div>
    );
  }

  return (
    <div className="w-full p-4 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-700">Files</div>
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
              currentPath={currentRelativePath}
              collapsedDirs={collapsedDirs}
              onToggleCollapse={handleToggleCollapse}
              onNavigate={handleTreeNavigate}
              filterExpanded={filterExpanded}
              fileMeta={fileMeta}
            />
          ))
        )}
      </div>
    </div>
  );
}
