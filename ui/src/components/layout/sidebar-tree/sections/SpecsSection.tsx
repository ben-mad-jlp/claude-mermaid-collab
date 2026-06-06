import React from 'react';
import { SectionBranchRow } from '../TreeBranchRow';
import ArtifactTreeNode from '../ArtifactTreeNode';
import type { TreeNode } from '../getActionsForNode';

/**
 * SpecsSection — the Studio ArtifactTree entry point for the Spec Sheet
 * (reachability fix fc4e9a7d). P1 wired kind:'spec' → SpecSheetPane in
 * PaneContent, but nothing in the tree opened such a tab, so the Spec Sheet was
 * unreachable in the real app. This flat section lists the per-project Spec Sheet
 * singleton node; clicking it opens the SpecSheetPane tab (via toTabDescriptor →
 * openPreview/openPermanent). Mirrors EmbedsSection (flat, no folders).
 */
export interface SpecsSectionProps {
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

export function SpecsSection({
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
  handleNodeContextMenu,
  toTabDescriptor,
}: SpecsSectionProps): React.ReactElement | null {
  const searchActive = searchQuery.trim() !== '';

  const filtered = nodes.filter((n) => {
    if (!showDeprecated && n.deprecated) return false;
    if (searchActive && !visibleNodes.has(n.id)) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  const showChildren = !collapsed || forceExpanded;

  return (
    <React.Fragment>
      <SectionBranchRow
        id="specs"
        title="Spec Sheets"
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

export default SpecsSection;
