/**
 * Pure utility for flattening a visible tree into an ordered list of node ids.
 *
 * Performs a depth-first traversal in array order. Each node contributes its
 * own id to the output. If the node is not collapsed and has a non-empty
 * `children` array, its descendants are traversed recursively. A collapsed
 * node still emits its own id but its descendants are skipped.
 */

export interface VisibleTreeNode {
  id: string;
  children?: VisibleTreeNode[];
}

export function orderVisibleNodes(
  roots: VisibleTreeNode[],
  collapsedIds: ReadonlySet<string>,
): string[] {
  const result: string[] = [];

  const visit = (node: VisibleTreeNode): void => {
    result.push(node.id);
    if (
      !collapsedIds.has(node.id) &&
      Array.isArray(node.children) &&
      node.children.length > 0
    ) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return result;
}
