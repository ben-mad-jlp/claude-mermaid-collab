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
    private session: string,
    private project: string
  ) {}

  open(id: string, type: ArtifactType | string): void {
    if (this.panels.has(id)) {
      this.panels.get(id)!.reveal();
      return;
    }

    // React sidebar sends singular types ('diagram', 'document', etc.) — normalize to plural
    const normalizedType = type.endsWith('s') ? type : `${type}s`;

    switch (normalizedType) {
      case 'diagrams': {
        this.panels.set(id, undefined as any);
        void this.api.getDiagram(id, this.project, this.session).then(diagram => {
          if (!diagram) { this.panels.delete(id); return; }
          const panel = DiagramPanel.create(this.context, id, diagram);
          panel.onDidDispose(() => { this.panels.delete(id); });
          this.panels.set(id, panel);
        });
        return;
      }
      case 'documents': {
        this.panels.set(id, undefined as any);
        void this.api.getDocument(id, this.project, this.session).then(doc => {
          if (!doc) { this.panels.delete(id); return; }
          const boundApi = {
            getDocument: (docId: string) => this.api.getDocument(docId, this.project, this.session),
            updateDocument: (docId: string, content: string) => this.api.updateDocument(docId, content, this.project, this.session),
          };
          const panel = DocumentPanel.create(this.context, id, doc, boundApi);
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
        void this.api.getSnippet(id, this.project, this.session).then(snippet => {
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
