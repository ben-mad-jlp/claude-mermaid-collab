import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ArtifactPanelManager } from './ArtifactPanelManager';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getPanelManager: () => ArtifactPanelManager | undefined,
    private readonly getSession: () => string,
    private readonly getProject: () => string
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };

    const nonce = crypto.randomBytes(16).toString('base64');
    const session = encodeURIComponent(this.getSession());
    const project = encodeURIComponent(this.getProject());
    const src = `http://localhost:9102/sidebar?project=${project}&session=${session}`;

    webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src http://localhost:9102; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
  <style>
    html, body, iframe {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      border: none;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <iframe id="sidebar-frame" src="${src}"></iframe>
  <script nonce="${nonce}">
    (function () {
      const vscodeApi = acquireVsCodeApi();
      window.addEventListener('message', function (event) {
        const msg = event.data;
        if (msg && msg.type === 'openArtifact') {
          vscodeApi.postMessage({ type: 'openArtifact', id: msg.id, artifactType: msg.artifactType });
        }
      });
    })();
  </script>
</body>
</html>`;

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'openArtifact') {
        this.getPanelManager()?.open(msg.id, msg.artifactType);
      }
    });
  }
}
