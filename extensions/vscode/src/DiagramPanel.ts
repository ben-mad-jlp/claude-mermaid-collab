import * as vscode from 'vscode';
import { CollabDiagram } from './api';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function create(
  context: vscode.ExtensionContext,
  id: string,
  diagram: CollabDiagram
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'mermaidCollabDiagram',
    diagram.name,
    vscode.ViewColumn.One,
    {
      retainContextWhenHidden: true,
      enableScripts: true,
    }
  );

  const mermaidUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'mermaid.esm.min.mjs')
  );

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(diagram.name)}</title>
</head>
<body>
  <div class="mermaid" id="diagram">${escapeHtml(diagram.content)}</div>
  <script type="module">
    import mermaid from '${mermaidUri}';
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    mermaid.run({ querySelector: '#diagram' });
    window.addEventListener('message', async e => {
      if (e.data.type === 'update') {
        document.getElementById('diagram').textContent = e.data.content;
        await mermaid.run({ querySelector: '#diagram' });
      }
    });
  </script>
</body>
</html>`;

  return panel;
}
