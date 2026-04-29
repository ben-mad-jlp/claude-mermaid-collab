import * as vscode from 'vscode';
import { ArtifactType, CollabApi } from './api';
import * as DiagramPanel from './DiagramPanel';
import * as DocumentPanel from './DocumentPanel';
import * as DesignPanel from './DesignPanel';
import { openSnippet } from './SnippetProvider';

export class ArtifactPanelManager {
  private panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private context: vscode.ExtensionContext,
    private api: CollabApi,
    private session: string
  ) {}

  open(id: string, type: ArtifactType): void {
    if (this.panels.has(id)) {
      this.panels.get(id)!.reveal();
      return;
    }

    switch (type) {
      case 'diagrams': {
        this.panels.set(id, undefined as any);
        void this.api.getDiagram(id).then(diagram => {
          if (!diagram) { this.panels.delete(id); return; }
          const panel = DiagramPanel.create(this.context, id, diagram);
          panel.onDidDispose(() => { this.panels.delete(id); });
          this.panels.set(id, panel);
        });
        return;
      }
      case 'documents': {
        this.panels.set(id, undefined as any);
        void this.api.getDocument(id).then(doc => {
          if (!doc) { this.panels.delete(id); return; }
          const panel = DocumentPanel.create(this.context, id, doc, this.api);
          panel.onDidDispose(() => { this.panels.delete(id); });
          this.panels.set(id, panel);
        });
        return;
      }
      case 'designs': {
        const panel = DesignPanel.create(this.context, id, id);
        panel.onDidDispose(() => { this.panels.delete(id); });
        this.panels.set(id, panel);
        return;
      }
      case 'snippets': {
        this.panels.set(id, undefined as any);
        void this.api.getSnippet(id).then(snippet => {
          this.panels.delete(id);
          if (!snippet) return;
          void openSnippet(this.session, id, snippet);
        });
        return;
      }
      default: {
        const titleMap: Record<string, string> = {
          images: `Image: ${id}`,
        };
        const title = titleMap[type] ?? `${type}: ${id}`;
        const panel = vscode.window.createWebviewPanel(
          'mermaidCollab.artifact',
          title,
          vscode.ViewColumn.One,
          { enableScripts: false }
        );
        panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<body>
  <p>Loading ${type}...</p>
</body>
</html>`;
        panel.onDidDispose(() => { this.panels.delete(id); });
        this.panels.set(id, panel);
        break;
      }
    }
  }

  pushUpdate(id: string, content: string): void {
    if (this.panels.has(id)) {
      this.panels.get(id)!.webview.postMessage({ type: 'update', content });
      const autoReveal = vscode.workspace.getConfiguration('mermaidCollab').get<boolean>('autoRevealOnUpdate', true);
      if (autoReveal) {
        this.panels.get(id)!.reveal();
      }
    }
  }
}
