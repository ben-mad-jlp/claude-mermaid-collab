import type { TreeNode } from './getActionsForNode';

export interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: Array<FolderNode | LeafNode>;
}

export interface LeafNode {
  type: 'leaf';
  node: TreeNode;
  displayName: string;
}

export type FolderTree = Array<FolderNode | LeafNode>;

function sortFolderTree(items: FolderTree): FolderTree {
  const folders = items
    .filter((i): i is FolderNode => i.type === 'folder')
    .sort((a, b) => a.name.localeCompare(b.name));
  const leaves = items
    .filter((i): i is LeafNode => i.type === 'leaf')
    .sort((a, b) => {
      const aTs = (a.node as any).lastModified ?? 0;
      const bTs = (b.node as any).lastModified ?? 0;
      return bTs - aTs || a.displayName.localeCompare(b.displayName);
    });
  for (const folder of folders) {
    folder.children = sortFolderTree(folder.children);
  }
  return [...folders, ...leaves];
}

export function buildFolderTree(nodes: TreeNode[]): FolderTree {
  const root: FolderTree = [];
  const folderMap = new Map<string, FolderNode>();

  const getOrCreateFolder = (
    parent: FolderTree,
    segments: string[],
    depth: number,
  ): FolderNode => {
    const path = segments.slice(0, depth + 1).join('/');
    const existing = folderMap.get(path);
    if (existing) return existing;
    const folder: FolderNode = { type: 'folder', name: segments[depth], path, children: [] };
    parent.push(folder);
    folderMap.set(path, folder);
    return folder;
  };

  for (const node of nodes) {
    const raw = node.name;
    const segments = raw.split('/');
    if (
      segments.length === 1 ||
      raw.startsWith('/') ||
      raw.endsWith('/') ||
      raw === '/' ||
      segments.some((s) => s === '')
    ) {
      root.push({ type: 'leaf', node, displayName: raw });
    } else {
      const displayName = segments[segments.length - 1];
      let currentChildren = root;
      for (let i = 0; i < segments.length - 1; i++) {
        const folder = getOrCreateFolder(currentChildren, segments, i);
        currentChildren = folder.children;
      }
      currentChildren.push({ type: 'leaf', node, displayName });
    }
  }

  return sortFolderTree(root);
}

export function hasVisibleLeaf(node: FolderNode, visibleNodes: Set<string>): boolean {
  for (const child of node.children) {
    if (child.type === 'leaf' && visibleNodes.has(child.node.id)) return true;
    if (child.type === 'folder' && hasVisibleLeaf(child, visibleNodes)) return true;
  }
  return false;
}
