import React from 'react';
import { SectionBranchRow } from '../TreeBranchRow';
import FolderTreeRow from '../FolderTreeRow';
import ArtifactTreeNode from '../ArtifactTreeNode';
import {
  buildFolderTree,
  hasVisibleLeaf,
  FolderTree,
  FolderNode,
} from '../folderTree';
import type { TreeNode } from '../getActionsForNode';

export interface DesignsSectionProps {
  nodes: TreeNode[];
  collapsed: boolean;
  forceExpanded: boolean;
  onToggle: () => void;
  showDeprecated: boolean;
  searchQuery: string;
  visibleNodes: Set<string>;
  collapsedFolderPaths: Set<string>;
  toggleFolderPath: (key: string) => void;
  multiSelection: { ids: Set<string> };
  isSelected: (node: TreeNode) => boolean;
  handleNodeClick: (node: TreeNode, e: React.MouseEvent) => void;
  openNode: (node: TreeNode) => void;
  openPermanent: (d: any) => void;
  handleNodeContextMenu: (node: TreeNode, e: React.MouseEvent) => void;
  toTabDescriptor: (node: TreeNode) => any | null;
}

function countVisibleLeaves(items: FolderTree, searchActive: boolean, visibleNodes: Set<string>, showDeprecated: boolean): number {
  let count = 0;
  for (const item of items) {
    if (item.type === 'folder') {
      count += countVisibleLeaves(item.children, searchActive, visibleNodes, showDeprecated);
    } else {
      if (searchActive && !visibleNodes.has(item.node.id)) continue;
      if (!showDeprecated && item.node.deprecated) continue;
      count += 1;
    }
  }
  return count;
}

function collectLeafNodes(folder: FolderNode): TreeNode[] {
  const result: TreeNode[] = [];
  for (const child of folder.children) {
    if (child.type === 'leaf') {
      result.push(child.node);
    } else {
      result.push(...collectLeafNodes(child));
    }
  }
  return result;
}

export function DesignsSection({
  nodes,
  collapsed,
  forceExpanded,
  onToggle,
  showDeprecated,
  searchQuery,
  visibleNodes,
  collapsedFolderPaths,
  toggleFolderPath,
  multiSelection,
  isSelected,
  handleNodeClick,
  openNode,
  openPermanent,
  handleNodeContextMenu,
  toTabDescriptor,
}: DesignsSectionProps): React.ReactElement | null {
  const searchActive = searchQuery.trim() !== '';

  const filtered = nodes
    .filter((n) => {
      if (!showDeprecated && n.deprecated) return false;
      if (searchActive && !visibleNodes.has(n.id)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));

  if (filtered.length === 0) return null;

  const folderTree = buildFolderTree(filtered);
  const sectionCount = countVisibleLeaves(folderTree, searchActive, visibleNodes, showDeprecated);
  const showChildren = !collapsed || forceExpanded;

  const renderFolderTree = (
    sectionId: string,
    items: FolderTree,
    level: number,
    isSearchActive: boolean,
  ): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
    for (const item of items) {
      if (item.type === 'folder') {
        if (isSearchActive && !hasVisibleLeaf(item, visibleNodes)) continue;
        const collapseKey = `${sectionId}:${item.path}`;
        const isCollapsed = collapsedFolderPaths.has(collapseKey);
        const leafCount = countVisibleLeaves(item.children, isSearchActive, visibleNodes, showDeprecated);
        elements.push(
          <div key={collapseKey} style={{ paddingLeft: `${(level + 1) * 16}px` }}>
            <FolderTreeRow
              name={item.name}
              count={leafCount}
              collapsed={isCollapsed}
              level={0}
              onToggle={() => toggleFolderPath(collapseKey)}
              onDeprecateAll={undefined}
            />
          </div>,
        );
        if (!isCollapsed) {
          elements.push(...renderFolderTree(sectionId, item.children, level + 1, isSearchActive));
        }
      } else {
        if (isSearchActive && !visibleNodes.has(item.node.id)) continue;
        if (!showDeprecated && item.node.deprecated) continue;
        const node = item.node;
        elements.push(
          <div key={node.id} style={{ paddingLeft: `${(level + 1) * 16}px` }}>
            <ArtifactTreeNode
              node={node}
              displayName={item.displayName}
              selected={isSelected(node)}
              isInMultiSelection={multiSelection.ids.has(node.id)}
              onClick={(e) => handleNodeClick(node, e)}
              onDoubleClick={() => {
                openNode(node);
                const d = toTabDescriptor(node);
                if (d) openPermanent(d);
              }}
              onContextMenu={(e) => handleNodeContextMenu(node, e)}
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
        id="designs"
        title="Designs"
        count={sectionCount}
        collapsed={collapsed && !forceExpanded}
        onToggle={onToggle}
        level={0}
      />
      {showChildren && renderFolderTree('designs', folderTree, 0, searchActive)}
    </React.Fragment>
  );
}

export default DesignsSection;
