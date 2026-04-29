import React from 'react';
import { SectionBranchRow } from '../TreeBranchRow';
import ArtifactTreeNode from '../ArtifactTreeNode';
import type { TreeNode } from '../getActionsForNode';

export interface SpreadsheetSectionProps {
  nodes: TreeNode[];
  collapsed: boolean;
  forceExpanded: boolean;
  onToggle: () => void;
  showDeprecated: boolean;
  searchQuery: string;
  visibleNodes: Set<string>;
  multiSelection: { ids: Set<string> };
  isSelected: (node: TreeNode) => boolean;
  handleNodeClick: (node: TreeNode, e: React.MouseEvent) => void;
  openNode: (node: TreeNode) => void;
  openPermanent: (d: any) => void;
  openPreview: (d: any) => void;
  handleNodeContextMenu: (node: TreeNode, e: React.MouseEvent) => void;
  setSelection: (ids: string[], anchor: string) => void;
  toTabDescriptor: (node: TreeNode) => any | null;
}

export function SpreadsheetSection({
  nodes,
  collapsed,
  forceExpanded,
  onToggle,
  showDeprecated,
  searchQuery,
  visibleNodes,
  multiSelection,
  isSelected,
  handleNodeClick,
  openNode,
  openPermanent,
  openPreview,
  handleNodeContextMenu,
  setSelection,
  toTabDescriptor,
}: SpreadsheetSectionProps): React.ReactElement | null {
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

  const showChildren = !collapsed || forceExpanded;

  return (
    <React.Fragment>
      <SectionBranchRow
        id="spreadsheets"
        title="Spreadsheets"
        count={filtered.length}
        collapsed={collapsed && !forceExpanded}
        onToggle={onToggle}
        level={0}
      />
      {showChildren &&
        filtered.map((node) => (
          <div key={node.id} style={{ paddingLeft: '16px' }}>
            <ArtifactTreeNode
              node={node}
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
          </div>
        ))}
    </React.Fragment>
  );
}

export default SpreadsheetSection;
