/**
 * PseudoTreeBody
 *
 * Sidebar-embedded variant of PseudoFileTree. Reads collapse state and
 * searchQuery from useSidebarTreeStore (instead of local useState) so the
 * sidebar header can drive filter + collapse-all / expand-all actions.
 *
 * The tree rendering itself reuses TreeNodeRenderer exported from
 * ui/src/pages/pseudo/PseudoFileTree.tsx.
 */

import { useCallback, useMemo } from 'react';
import {
  buildTree,
  deepSortTree,
  filterTree,
  type TreeNode,
} from '@/pages/pseudo/tree.utils';
import { TreeNodeRenderer } from '@/pages/pseudo/PseudoFileTree';
import { useSidebarTreeStore } from '@/stores/sidebarTreeStore';
import { prefetchPseudoFile, type PseudoFileSummary } from '@/lib/pseudo-api';

export type PseudoTreeBodyProps = {
  fileList: PseudoFileSummary[];
  currentPath: string;
  onNavigate: (stem: string) => void;
  project: string;
  onProjectChange?: (project: string) => void;
};

/**
 * Returns every directory path that appears in the given file list.
 */
export function getAllDirPaths(fileList: PseudoFileSummary[]): string[] {
  const dirs = new Set<string>();
  for (const f of fileList) {
    const parts = f.filePath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      if (prefix) dirs.add(prefix);
    }
  }
  return Array.from(dirs);
}

export function PseudoTreeBody({
  fileList,
  currentPath,
  onNavigate,
  project,
}: PseudoTreeBodyProps) {
  const pseudoCollapsedPaths = useSidebarTreeStore((s) => s.pseudoCollapsedPaths);
  const searchQuery = useSidebarTreeStore((s) => s.searchQuery);
  const togglePseudoPath = useSidebarTreeStore((s) => s.togglePseudoPath);

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

  const filePaths = useMemo(
    () => fileList.map((f) => toRelative(f.filePath)),
    [fileList, toRelative]
  );

  const relativeToAbsolute = useMemo(() => {
    const map = new Map<string, string>();
    fileList.forEach((f) => map.set(toRelative(f.filePath), f.filePath));
    return map;
  }, [fileList, toRelative]);

  const fileMeta = useMemo(() => {
    const map = new Map<string, PseudoFileSummary>();
    fileList.forEach((f) => map.set(toRelative(f.filePath), f));
    return map;
  }, [fileList, toRelative]);

  const currentRelativePath = useMemo(
    () => (currentPath ? toRelative(currentPath) : ''),
    [currentPath, toRelative]
  );

  const handleTreeNavigate = useCallback(
    (relPath: string) => {
      onNavigate(relativeToAbsolute.get(relPath) ?? relPath);
    },
    [onNavigate, relativeToAbsolute]
  );

  const handleTreePrefetch = useCallback(
    (relPath: string) => {
      if (!project) return;
      const meta = fileList.find((f) => toRelative(f.filePath) === relPath);
      if (!meta || (meta.methodCount === 0 && meta.exportCount === 0)) return;
      const abs = relativeToAbsolute.get(relPath) ?? relPath;
      prefetchPseudoFile(project, abs);
    },
    [project, relativeToAbsolute, fileList, toRelative]
  );

  const tree = useMemo(() => {
    const built = buildTree(filePaths);
    return deepSortTree(built);
  }, [filePaths]);

  const { nodes: filteredTree, expandedPaths: filterExpanded } = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return { nodes: tree, expandedPaths: new Set<string>() } as {
        nodes: TreeNode[];
        expandedPaths: Set<string>;
      };
    }
    return filterTree(tree, trimmed);
  }, [tree, searchQuery]);

  if (fileList.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-gray-500">
        No source files found
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {filteredTree.length === 0 && searchQuery.trim() ? (
        <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
      ) : (
        filteredTree.map((node) => (
          <TreeNodeRenderer
            key={node.path}
            node={node}
            level={0}
            currentPath={currentRelativePath}
            collapsedDirs={pseudoCollapsedPaths}
            onToggleCollapse={togglePseudoPath}
            onNavigate={handleTreeNavigate}
            filterExpanded={filterExpanded}
            fileMeta={fileMeta}
            onPrefetch={handleTreePrefetch}
          />
        ))
      )}
    </div>
  );
}
