import * as vscode from 'vscode';
import { CollabDocument, CollabApi } from './api';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function create(
  context: vscode.ExtensionContext,
  id: string,
  doc: CollabDocument,
  api: CollabApi
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'mermaidCollabDocument',
    doc.name,
    vscode.ViewColumn.One,
    {
      retainContextWhenHidden: true,
      enableScripts: true,
    }
  );

  const markedUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'marked.min.js')
  );

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(doc.name)}</title>
  <script src="${markedUri}"></script>
  <style>
    body { margin: 0; padding: 0; display: flex; height: 100vh; overflow: hidden; }
  </style>
</head>
<body>
  <div id="conflict-banner" style="display:none;position:fixed;top:0;left:0;right:0;background:#f0ad4e;padding:8px;z-index:100;">Document updated remotely — <button onclick="reload()">Reload</button> <button onclick="keepMine()">Keep mine</button></div>
  <textarea id="editor" style="width:50%;height:100vh;box-sizing:border-box;resize:none;font-family:monospace;padding:8px;border:none;outline:none;"></textarea>
  <div id="preview" style="width:50%;height:100vh;overflow:auto;padding:8px;box-sizing:border-box;"></div>
  <script>
    const vscode = acquireVsCodeApi();
    let dirty = false;
    let debounceTimer;

    function render(content) {
      document.getElementById('preview').innerHTML = marked.parse(content);
    }

    document.getElementById('editor').oninput = () => {
      dirty = true;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        vscode.postMessage({type: 'save', content: document.getElementById('editor').value});
      }, 800);
    };

    function reload() {
      document.getElementById('conflict-banner').style.display = 'none';
      vscode.postMessage({type: 'reload'});
    }

    function keepMine() {
      document.getElementById('conflict-banner').style.display = 'none';
      dirty = false;
    }

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'init') {
        document.getElementById('editor').value = m.content;
        render(m.content);
        dirty = false;
        document.getElementById('conflict-banner').style.display = 'none';
      } else if (m.type === 'update') {
        if (dirty) {
          document.getElementById('conflict-banner').style.display = 'block';
        } else {
          render(m.content);
        }
      } else if (m.type === 'conflict') {
        document.getElementById('conflict-banner').style.display = 'block';
      }
    });

    window.onload = () => {
      vscode.postMessage({type: 'ready'});
    };
  </script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(msg => {
    if (msg.type === 'ready') {
      panel.webview.postMessage({type: 'init', content: doc.content});
    } else if (msg.type === 'save') {
      api.updateDocument(id, msg.content as string).catch(err =>
        vscode.window.showErrorMessage('Save failed: ' + String(err))
      );
    } else if (msg.type === 'reload') {
      api.getDocument(id)
        .then(fresh => panel.webview.postMessage({type: 'init', content: fresh.content}))
        .catch(() => {});
    }
  });

  return panel;
}
