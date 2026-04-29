import * as vscode from 'vscode';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function create(
  context: vscode.ExtensionContext,
  id: string,
  name: string
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'mermaidCollabDesign',
    name,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:9102; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)}</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <iframe src="http://localhost:9102/design-view?id=${encodeURIComponent(id)}" style="width:100%;height:100vh;border:none;"></iframe>
</body>
</html>`;

  return panel;
}
