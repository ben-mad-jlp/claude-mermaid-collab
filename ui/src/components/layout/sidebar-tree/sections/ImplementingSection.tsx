import React from 'react';
import { SectionBranchRow } from '../TreeBranchRow';
import { FolderTreeRow } from '../FolderTreeRow';
import ArtifactTreeNode from '../ArtifactTreeNode';
import { buildFolderTree, hasVisibleLeaf } from '../folderTree';
import type { FolderTree, FolderNode, LeafNode } from '../folderTree';
import type { TreeNode } from '../getActionsForNode';

// Pure strip: removes only the "Implementing/" prefix, no Go/ injection
const strip = (name: string) => name.replace(/^Implementing\//, '');

function collectLeafNodes(folder: FolderNode): TreeNode[] {
  const results: TreeNode[] = [];
  for (const child of folder.children) {
    if (child.type === 'leaf') {
      results.push(child.node);
    } else {
      results.push(...collectLeafNodes(child));
    }
  }
  return results;
}

function countVisibleLeaves(
  items: FolderTree,
  searchActive: boolean,
  visibleNodes: Set<string>,
  showDeprecated: boolean,
): number {
  let count = 0;
  for (const item of items) {
    if (item.type === 'folder') {
      count += countVisibleLeaves(item.children, searchActive, visibleNodes, showDeprecated);
    } else {
      if (searchActive && !visibleNodes.has(item.node.id)) continue;
      if (!showDeprecated && item.node.deprecated) continue;
      count++;
    }
  }
  return count;
}

export interface ImplementingSectionProps {
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
  runBatch: (actionId: string, nodes: TreeNode[]) => void;
  toTabDescriptor: (node: TreeNode) => any | null;
}

export function ImplementingSection({
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
  runBatch,
  toTabDescriptor,
}: ImplementingSectionProps): React.ReactElement | null {
  const searchActive = searchQuery.trim() !== '';

  // Filter nodes: exclude deprecated if !showDeprecated, exclude by search
  const filtered = nodes.filter((n) => {
    if (!showDeprecated && n.deprecated) return false;
    if (searchActive && !visibleNodes.has(n.id)) return false;
    return true;
  });

  if (filtered.length === 0 && !searchActive) return null;

  // Build folder tree using stripped names but original ids
  const strippedNodes: TreeNode[] = filtered.map((n) => ({
    ...n,
    name: strip(n.name),
  }));

  const folderTree = buildFolderTree(strippedNodes);

  // After building the folder tree, we need to map back to original nodes for callbacks.
  // Since we copy the node object and only change name, callbacks using node.id still work.

  const sectionCount = countVisibleLeaves(folderTree, searchActive, visibleNodes, showDeprecated);
  const showChildren = !collapsed || forceExpanded;

  const renderFolderTree = (
    items: FolderTree,
    level: number,
  ): React.ReactNode[] => {
    const elements: React.ReactNode[] = [];
    for (const item of items) {
      if (item.type === 'folder') {
        if (searchActive && !hasVisibleLeaf(item, visibleNodes)) continue;
        const collapseKey = `blueprints:${item.path}`;
        const isCollapsed = collapsedFolderPaths.has(collapseKey);
        const leafCount = countVisibleLeaves(item.children, searchActive, visibleNodes, showDeprecated);
        elements.push(
          <div key={collapseKey} style={{ paddingLeft: `${(level + 1) * 16}px` }}>
            <FolderTreeRow
              name={item.name}
              count={leafCount}
              collapsed={isCollapsed}
              level={0}
              onToggle={() => toggleFolderPath(collapseKey)}
              onDeprecateAll={
                item.path === 'Go' ||
                (item.path.startsWith('Ad-hoc/') && item.path.split('/').length === 2)
                  ? () => {
                      const leaves = collectLeafNodes(item).filter((n) => !n.deprecated);
                      if (leaves.length > 0) runBatch('deprecate', leaves);
                    }
                  : undefined
              }
            />
          </div>,
        );
        if (!isCollapsed) {
          elements.push(...renderFolderTree(item.children, level + 1));
        }
      } else {
        if (searchActive && !visibleNodes.has(item.node.id)) continue;
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
    <>
      <SectionBranchRow
        id="blueprints"
        title="Implementing"
        count={sectionCount}
        collapsed={collapsed && !forceExpanded}
        onToggle={onToggle}
        level={0}
      />
      {showChildren && renderFolderTree(folderTree, 0)}
    </>
  );
}

export default ImplementingSection;
