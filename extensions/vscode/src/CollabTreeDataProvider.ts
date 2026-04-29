import * as vscode from 'vscode';
import { ArtifactType, ArtifactMeta } from './api';
import { SessionStore } from './SessionStore';

export type CollabTreeNodeKind = 'session-header' | 'section' | 'artifact';

export interface CollabTreeNode {
  kind: CollabTreeNodeKind;
  /** For session-header: session id. For section: ArtifactType. For artifact: artifact id. */
  id: string;
  /** Set for section and artifact nodes */
  artifactType?: ArtifactType;
  /** Set for artifact nodes */
  artifact?: ArtifactMeta;
}

const ARTIFACT_TYPES: ArtifactType[] = ['documents', 'diagrams', 'snippets', 'designs', 'images'];

const SECTION_ICONS: Record<ArtifactType, string> = {
  documents: 'file-text',
  diagrams: 'graph',
  snippets: 'code',
  designs: 'layout',
  images: 'file-media',
};

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (isNaN(diffMs)) {
    return isoString;
  }
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return 'just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) {
    return `${diffDay}d ago`;
  }
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) {
    return `${diffMonth}mo ago`;
  }
  const diffYear = Math.floor(diffMonth / 12);
  return `${diffYear}y ago`;
}

export class CollabTreeDataProvider implements vscode.TreeDataProvider<CollabTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CollabTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private store: SessionStore,
    private activeSession: string
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getChildren(node?: CollabTreeNode): CollabTreeNode[] {
    if (!node) {
      // Root level: session-header + non-empty sections
      const rootNodes: CollabTreeNode[] = [
        { kind: 'session-header', id: this.activeSession },
      ];
      for (const type of ARTIFACT_TYPES) {
        if (this.store.getItemsForSection(type).length > 0) {
          rootNodes.push({ kind: 'section', id: type, artifactType: type });
        }
      }
      return rootNodes;
    }

    if (node.kind === 'session-header' || node.kind === 'artifact') {
      return [];
    }

    // Section node: return artifact children
    if (node.kind === 'section' && node.artifactType) {
      const items = this.store.getItemsForSection(node.artifactType);
      return items.map((artifact) => ({
        kind: 'artifact' as CollabTreeNodeKind,
        id: artifact.id,
        artifactType: node.artifactType,
        artifact,
      }));
    }

    return [];
  }

  getTreeItem(node: CollabTreeNode): vscode.TreeItem {
    if (node.kind === 'session-header') {
      const item = new vscode.TreeItem(
        node.id,
        vscode.TreeItemCollapsibleState.None
      );
      item.iconPath = new vscode.ThemeIcon('account');
      item.command = {
        command: 'mermaidCollab.switchSession',
        title: 'Switch Session',
        arguments: [],
      };
      return item;
    }

    if (node.kind === 'section' && node.artifactType) {
      const type = node.artifactType;
      const count = this.store.getItemsForSection(type).length;
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      const item = new vscode.TreeItem(
        label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.iconPath = new vscode.ThemeIcon(SECTION_ICONS[type]);
      item.description = String(count);
      return item;
    }

    // Artifact node
    if (node.kind === 'artifact' && node.artifact && node.artifactType) {
      const artifact = node.artifact;
      const labelValue: string = artifact.name;

      const item = new vscode.TreeItem(
        labelValue,
        vscode.TreeItemCollapsibleState.None
      );
      item.description = relativeTime(artifact.lastModified);
      item.command = {
        command: 'mermaidCollab.openArtifact',
        title: 'Open Artifact',
        arguments: [artifact.id, node.artifactType],
      };
      item.contextValue = 'artifact';
      return item;
    }

    return new vscode.TreeItem(node.id);
  }
}
