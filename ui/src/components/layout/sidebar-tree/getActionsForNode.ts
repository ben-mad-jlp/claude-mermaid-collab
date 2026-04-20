/**
 * Pure module: maps a TreeNode to its context-menu actions.
 * No side effects, no imports.
 */

export type NodeKind =
  | 'artifact'
  | 'task-graph'
  | 'task-details'
  | 'blueprint'
  | 'embed'
  | 'code-file'
  | 'todo';

export type ArtifactType =
  | 'diagram'
  | 'document'
  | 'design'
  | 'spreadsheet'
  | 'snippet'
  | 'image';

export interface TreeNode {
  kind: NodeKind;
  id: string;
  name: string;
  artifactType?: ArtifactType;
  pinned?: boolean;
  deprecated?: boolean;
  completed?: boolean;
  lastModified?: number;
}

export interface MenuAction {
  id: string;
  label: string;
  disabled?: boolean;
  tooltip?: string;
  destructive?: boolean;
  separator?: boolean;
}

// Reserved for future context (e.g., permissions, feature flags).
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface NodeActionsCtx {}

export function getActionsForNode(
  node: TreeNode,
  _ctx?: NodeActionsCtx,
): MenuAction[] {
  switch (node.kind) {
    case 'artifact': {
      if (node.artifactType === 'image') {
        return [
          {
            id: 'pin-artifact',
            label: node.pinned ? 'Unpin Artifact' : 'Pin Artifact',
          },
            {
            id: 'rename',
            label: 'Rename',
            disabled: true,
            tooltip: 'Not yet supported',
          },
          { id: 'download', label: 'Download' },
          {
            id: 'delete',
            label: 'Delete',
            destructive: true,
            separator: true,
          },
        ];
      }
      return [
        {
          id: 'pin-artifact',
          label: node.pinned ? 'Unpin Artifact' : 'Pin Artifact',
        },
        {
          id: 'rename',
          label: 'Rename',
          disabled: true,
          tooltip: 'Not yet supported',
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          disabled: true,
          tooltip: 'Not yet supported',
        },
        { id: 'download', label: 'Download' },
        { id: 'email', label: 'Email' },
        {
          id: 'deprecate',
          label: node.deprecated ? 'Undeprecate' : 'Deprecate',
        },
        {
          id: 'delete',
          label: 'Delete',
          destructive: true,
          separator: true,
        },
      ];
    }

    case 'blueprint':
      return [
        {
          id: 'deprecate',
          label: node.deprecated ? 'Undeprecate' : 'Deprecate',
          destructive: true,
          separator: true,
        },
      ];

    case 'embed':
      return [
        {
          id: 'rename',
          label: 'Rename',
          disabled: true,
          tooltip: 'Not yet supported',
        },
        {
          id: 'delete',
          label: 'Delete',
          destructive: true,
          separator: true,
        },
      ];

    case 'code-file':
      return [
        { id: 'reveal-in-file-browser', label: 'Reveal in File Browser' },
        { id: 'sync-from-disk', label: 'Sync from Disk' },
        { id: 'push-to-disk', label: 'Push to Disk' },
        {
          id: 'unlink',
          label: 'Unlink',
          destructive: true,
          separator: true,
        },
      ];

    case 'task-graph':
    case 'task-details':
      return [];

    case 'todo':
      return [
        { id: 'edit', label: 'Edit' },
        {
          id: 'mark-complete',
          label: node.completed ? 'Mark Incomplete' : 'Mark Complete',
        },
        {
          id: 'delete',
          label: 'Delete',
          destructive: true,
          separator: true,
        },
      ];

    default:
      return [];
  }
}

export function getActionsForSelection(nodes: TreeNode[], ctx?: NodeActionsCtx): MenuAction[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return getActionsForNode(nodes[0], ctx);
  const perNode = nodes.map((n) => getActionsForNode(n, ctx));
  let surviving = new Set(perNode[0].map((a) => a.id));
  for (let i = 1; i < perNode.length; i++) {
    const next = new Set<string>();
    for (const a of perNode[i]) if (surviving.has(a.id)) next.add(a.id);
    surviving = next;
  }
  const filtered = perNode[0].filter((a) => surviving.has(a.id));
  if (filtered.length === 0) {
    return [{ id: 'noop', label: 'No shared actions', disabled: true }];
  }
  return filtered;
}
