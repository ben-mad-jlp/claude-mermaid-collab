/**
 * PseudoFileTree Component
 *
 * Page-level wrapper around PseudoTreeBody. Owns the search input and
 * delegates rendering to the shared body component which reads collapse
 * state from useSidebarTreeStore. Also exports TreeNodeRenderer for reuse
 * by the sidebar-embedded body.
 */

import { memo, useEffect } from 'react';
import { PseudoTreeBody } from '@/components/layout/sidebar-tree/PseudoTreeBody';
import { useSidebarTreeStore } from '@/stores/sidebarTreeStore';
import { mark } from '@/lib/perf-bus';
import type { TreeNode } from './tree.utils';
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

type TreeNodeRendererProps = {
  node: TreeNode;
  level: number;
  currentPath: string;
  collapsedDirs: Set<string>;
  onToggleCollapse: (path: string) => void;
  onNavigate: (path: string) => void;
  onPermanent?: (path: string) => void;
  filterExpanded: Set<string>;
  fileMeta: Map<string, PseudoFileSummary>;
  onPrefetch?: (path: string) => void;
  linkedPaths?: Set<string>;
};

/**
 * TreeNode renderer component.
 *
 * Memoized so unrelated parent re-renders (and sibling activations) don't
 * cascade through hundreds of nodes. Relies on stable prop references from
 * PseudoTreeBody (memoized fileMeta/filterExpanded, store-derived
 * collapsedDirs, useCallback'd handlers).
 */
function TreeNodeRendererImpl({
  node,
  level,
  currentPath,
  collapsedDirs,
  onToggleCollapse,
  onNavigate,
  onPermanent,
  filterExpanded,
  fileMeta,
  onPrefetch,
  linkedPaths,
}: TreeNodeRendererProps) {
  const isCollapsed = collapsedDirs.has(node.path);
  const isActive = !node.isDir && node.path === currentPath;
  const hasChildren = node.children.length > 0;
  const shouldShowChildren = !isCollapsed;
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
          className="flex-1 text-xs flex items-center gap-1"
          onClick={() => { if (!node.isDir) { mark('code-click'); onNavigate(node.path); } }}
          onDoubleClick={() => { if (!node.isDir) onPermanent?.(node.path); }}
          onMouseEnter={() => {
            if (!node.isDir) onPrefetch?.(node.path);
          }}
        >
          <span className="truncate">{node.name}</span>
          {!node.isDir && linkedPaths?.has(node.path) && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-teal-500 inline-block ml-1 flex-shrink-0"
              title="Code artifact linked"
            />
          )}
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
              onPermanent={onPermanent}
              filterExpanded={filterExpanded}
              fileMeta={fileMeta}
              onPrefetch={onPrefetch}
              linkedPaths={linkedPaths}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const TreeNodeRenderer = memo(TreeNodeRendererImpl);

/**
 * PseudoFileTree Component
 */
export function PseudoFileTree({
  fileList,
  currentPath,
  onNavigate,
  project,
}: PseudoFileTreeProps) {
  const searchQuery = useSidebarTreeStore((s) => s.searchQuery);
  const setSearchQuery = useSidebarTreeStore((s) => s.setSearchQuery);

  // One-time migration of the legacy per-project collapsed set into the
  // shared store, so existing users don't lose their folded state.
  useEffect(() => {
    if (!project) return;
    const legacyKey = `pseudo-tree-collapsed-${project}`;
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const legacyPaths = parsed.filter((x): x is string => typeof x === 'string');
      const current = useSidebarTreeStore.getState().pseudoCollapsedPaths;
      const merged = new Set(current);
      for (const p of legacyPaths) merged.add(p);
      useSidebarTreeStore.setState({ pseudoCollapsedPaths: merged });
      localStorage.removeItem(legacyKey);
    } catch {
      // ignore malformed legacy data
    }
  }, [project]);

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
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-700">Files</div>
      </div>

      <input
        type="text"
        placeholder="Filter files..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />

      <div className="flex-1 overflow-y-auto">
        <PseudoTreeBody
          fileList={fileList}
          currentPath={currentPath}
          onNavigate={onNavigate}
          project={project}
        />
      </div>
    </div>
  );
}
