/**
 * SnippetsSection — folder-tree rendering for the Snippets sidebar section.
 *
 * Snippets support folder paths via '/' separators in their names.
 * This component adds folder-tree rendering (same pattern as Documents/Diagrams)
 * whereas the previous flat renderSection call did not pass { foldered: true }.
 */

import React from 'react';
import { SectionBranchRow } from '../TreeBranchRow';
import { FolderTreeRow } from '../FolderTreeRow';
import ArtifactTreeNode from '../ArtifactTreeNode';
import { buildFolderTree, hasVisibleLeaf } from '../folderTree';
import type { FolderTree, FolderNode, LeafNode } from '../folderTree';
import type { TreeNode } from '../getActionsForNode';

export interface SnippetsSectionProps {
  /** All snippet TreeNodes (pre-filtered for deprecated if needed). */
  nodes: TreeNode[];
  /** Whether the section header is collapsed. */
  collapsed: boolean;
  /** Whether the section is force-expanded (e.g. due to an active search match). */
  forceExpanded?: boolean;
  /** Toggle collapse state of the section header. */
  onToggle: () => void;
  /** IDs of nodes that match the current search query (empty set = no search active). */
  visibleNodes: Set<string>;
  /** IDs of folder paths currently collapsed (key format: `snippets:${folder.path}`). */
  collapsedFolderPaths: Set<string>;
  /** Toggle a folder path's collapsed state. */
  onToggleFolderPath: (key: string) => void;
  /** Whether deprecated nodes should be shown. */
  showDeprecated: boolean;
  /** Current search query string (used to detect search-active state). */
  searchQuery: string;
  /** Which node is currently selected (used to apply highlight). */
  isSelected: (node: TreeNode) => boolean;
  /** IDs currently in the multi-selection set. */
  multiSelectionIds: Set<string>;
  /** Called when a node is clicked. */
  onNodeClick: (node: TreeNode, e: React.MouseEvent) => void;
  /** Called when a node is double-clicked. */
  onNodeDoubleClick: (node: TreeNode) => void;
  /** Called when a node's context menu is requested. */
  onNodeContextMenu: (node: TreeNode, e: React.MouseEvent) => void;
}

const SECTION_ID = 'snippets';

function countVisibleLeaves(
  items: FolderTree,
  searchActive: boolean,
  visibleNodes: Set<string>,
  showDeprecated: boolean,
): number {
  let count = 0;
  for (const item of items) {
    if (item.type === 'leaf') {
      if (item.node.deprecated && !showDeprecated) continue;
      if (!searchActive || visibleNodes.has(item.node.id)) count++;
    } else {
      count += countVisibleLeaves(item.children, searchActive, visibleNodes, showDeprecated);
    }
  }
  return count;
}

export function SnippetsSection({
  nodes,
  collapsed,
  forceExpanded = false,
  onToggle,
  visibleNodes,
  collapsedFolderPaths,
  onToggleFolderPath,
  showDeprecated,
  searchQuery,
  isSelected,
  multiSelectionIds,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
}: SnippetsSectionProps): React.ReactElement | null {
  const searchActive = searchQuery.trim() !== '';

  // Apply deprecated + search filters, then sort by lastModified desc.
  const filtered = nodes
    .filter((n) => {
      if (!showDeprecated && n.deprecated) return false;
      if (searchActive && !visibleNodes.has(n.id)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));

  if (filtered.length === 0) return null;

  const effectiveCollapsed = collapsed && !forceExpanded;
  const folderTree: FolderTree = buildFolderTree(filtered);
  const sectionCount = countVisibleLeaves(folderTree, searchActive, visibleNodes, showDeprecated);

  const renderFolderTree = (
    items: FolderTree,
    level: number,
  ): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
    for (const item of items) {
      if (item.type === 'folder') {
        if (searchActive && !hasVisibleLeaf(item, visibleNodes)) continue;
        const collapseKey = `${SECTION_ID}:${item.path}`;
        const isFolderCollapsed = collapsedFolderPaths.has(collapseKey);
        const leafCount = countVisibleLeaves(item.children, searchActive, visibleNodes, showDeprecated);
        elements.push(
          <div key={collapseKey} style={{ paddingLeft: `${(level + 1) * 16}px` }}>
            <FolderTreeRow
              name={item.name}
              count={leafCount}
              collapsed={isFolderCollapsed}
              level={0}
              onToggle={() => onToggleFolderPath(collapseKey)}
            />
          </div>,
        );
        if (!isFolderCollapsed) {
          elements.push(...renderFolderTree(item.children, level + 1));
        }
      } else {
        const leaf = item as LeafNode;
        if (searchActive && !visibleNodes.has(leaf.node.id)) continue;
        if (!showDeprecated && leaf.node.deprecated) continue;
        const node = leaf.node;
        elements.push(
          <div key={node.id} style={{ paddingLeft: `${(level + 1) * 16}px` }}>
            <ArtifactTreeNode
              node={node}
              displayName={leaf.displayName}
              selected={isSelected(node)}
              isInMultiSelection={multiSelectionIds.has(node.id)}
              onClick={(e) => onNodeClick(node, e)}
              onDoubleClick={() => onNodeDoubleClick(node)}
              onContextMenu={(e) => onNodeContextMenu(node, e)}
            />
          </div>,
        );
      }
    }
    return elements;
  };

  return (
    <React.Fragment>
      <SectionBranchRow
        id={SECTION_ID}
        title="Snippets"
        count={sectionCount}
        collapsed={effectiveCollapsed}
        onToggle={onToggle}
        level={0}
      />
      {!effectiveCollapsed && renderFolderTree(folderTree, 0)}
    </React.Fragment>
  );
}

export default SnippetsSection;
