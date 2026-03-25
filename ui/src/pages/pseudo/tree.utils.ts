/**
 * Tree utilities for PseudoFileTree
 */

export type TreeNode = {
  name: string;
  path: string; // Full stem path
  children: TreeNode[];
  isDir: boolean;
};

/**
 * Convert _childrenMap to children array recursively
 */
function convertChildrenMap(
  node: TreeNode & { _childrenMap?: Record<string, TreeNode & { _childrenMap?: unknown }> }
): TreeNode {
  if (node._childrenMap) {
    node.children = Object.values(node._childrenMap).map(convertChildrenMap);
    delete node._childrenMap;
  }
  return node;
}

/**
 * Build a nested tree structure from a flat list of file paths
 */
export function buildTree(fileList: string[]): TreeNode[] {
  const roots: Record<string, TreeNode & { _childrenMap?: Record<string, TreeNode> }> = {};

  for (const filePath of fileList) {
    const parts = filePath.split('/');
    let currentLevel = roots;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      const isDir = i < parts.length - 1;

      if (!currentLevel[name]) {
        currentLevel[name] = {
          name,
          path,
          children: [],
          isDir,
        };
      }

      const node = currentLevel[name];

      // Ensure children is an array
      if (!node.children) {
        node.children = [];
      }

      // Move to next level if this is a directory
      if (isDir) {
        // Convert children array to object for easier access
        if (!node._childrenMap) {
          node._childrenMap = {};
        }
        currentLevel = node._childrenMap;
      }
    }
  }

  // Convert root object to array and recursively convert all _childrenMap
  return Object.values(roots).map(convertChildrenMap);
}

/**
 * Recursively sort tree nodes: directories first, then files, all alphabetically
 */
function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1; // Directories first
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Recursively apply sorting to all levels
 */
export function deepSortTree(nodes: TreeNode[]): TreeNode[] {
  const sorted = sortTreeNodes(nodes);
  return sorted.map((node) => ({
    ...node,
    children: node.children.length > 0 ? deepSortTree(node.children) : [],
  }));
}

/**
 * Filter tree nodes based on query, returning matching nodes and their ancestors
 * Auto-expands directories containing matches
 */
export function filterTree(
  nodes: TreeNode[],
  query: string,
  ancestorMatched: boolean = false
): { nodes: TreeNode[]; expandedPaths: Set<string> } {
  const expandedPaths = new Set<string>();

  const filtered = nodes
    .map((node) => {
      const nameMatches = node.name.toLowerCase().includes(query.toLowerCase());
      const { nodes: filteredChildren, expandedPaths: childExpanded } = node.children.length > 0
        ? filterTree(node.children, query, nameMatches || ancestorMatched)
        : { nodes: [], expandedPaths: new Set<string>() };

      // Include node if:
      // 1. Name matches the query
      // 2. An ancestor matched
      // 3. Children were matched (directory containing matches)
      const shouldInclude = nameMatches || ancestorMatched || filteredChildren.length > 0;

      if (shouldInclude) {
        if (filteredChildren.length > 0) {
          expandedPaths.add(node.path);
        }
        childExpanded.forEach((path) => expandedPaths.add(path));

        return {
          ...node,
          children: filteredChildren,
        };
      }

      return null;
    })
    .filter((node): node is TreeNode => node !== null);

  return { nodes: filtered, expandedPaths };
}
