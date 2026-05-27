// mermaid-collab IDE bridge — diff-only.
//
// Single responsibility: when the collab server broadcasts `ide_open_diff`,
// open that file's working-tree diff (vs git HEAD) in the editor. Nothing else
// — terminal/tmux management and browser control were removed; the desktop app
// owns those now. Declared as a "workspace" extension so it runs on the host
// that actually has the files + git (local or the remote/SSH end).
import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
const MAX_DELAY = 30_000;
const MAX_ATTEMPTS = 20;
let _ctx: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext) {
  _ctx = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.reconnect', () => {
      scheduleReconnect(0);
    }),
    vscode.commands.registerCommand('mermaidCollab.update', async () => {
      const serverUrl = vscode.workspace.getConfiguration('mermaidCollab').get<string>('serverUrl') ?? 'ws://127.0.0.1:9002/ws';
      const httpBase = serverUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws$/, '');
      try {
        const res = await fetch(`${httpBase}/api/extension/js`);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const js = await res.text();
        const { writeFileSync } = require('fs') as typeof import('fs');
        writeFileSync(__filename, js, 'utf-8');
        const choice = await vscode.window.showInformationMessage('mermaid-collab extension updated. Reload to apply?', 'Reload Now');
        if (choice === 'Reload Now') {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      } catch (err) {
        vscode.window.showErrorMessage(`mermaid-collab update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  // Defer the WebSocket connection until after the extension host fully
  // initializes — connecting during startup can crash the host (ECONNREFUSED
  // → reconnect loop → VS Code's "3 crashes" guard hangs a remote at startup).
  setTimeout(() => connect(context), 5000);
}

function connect(context: vscode.ExtensionContext) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.removeAllListeners();
    ws.on('error', () => {});
    ws.close();
  }
  const url = vscode.workspace.getConfiguration('mermaidCollab').get<string>('serverUrl') ?? 'ws://127.0.0.1:9002/ws';
  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectDelay = 1000;
    reconnectAttempts = 0;
    ws!.send(JSON.stringify({ type: 'subscribe', channel: 'ide' }));
    ws!.send(JSON.stringify({
      type: 'ide_connected',
      vscodeVersion: vscode.version,
      extensionVersion: context.extension.packageJSON.version as string,
      workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };
      if (msg.type === 'ide_open_diff') {
        void openDiff(msg.filePath as string);
      }
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    reconnectAttempts++;
    if (reconnectAttempts <= MAX_ATTEMPTS) {
      scheduleReconnect(reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    }
  });

  ws.on('error', () => { /* close fires after error */ });
}

/**
 * Resolve the server-supplied path to one that actually exists on this host.
 * Tries the path as-is, its realpath (macOS /var → /private/var symlink), and
 * — if still missing — the same basename/relative tail under each workspace
 * folder. Returns null if nothing resolves.
 */
function resolveDiffPath(filePath: string): string | null {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const tryPath = (p: string): string | null => {
    try {
      if (fs.existsSync(p)) {
        try { return fs.realpathSync.native(p); } catch { return p; }
      }
    } catch { /* ignore */ }
    return null;
  };
  const direct = tryPath(filePath);
  if (direct) return direct;

  const folders = vscode.workspace.workspaceFolders ?? [];
  for (const f of folders) {
    const root = f.uri.fsPath;
    // If the path shares a suffix with a workspace folder, re-root it there.
    const idx = filePath.indexOf(`${path.sep}${path.basename(root)}${path.sep}`);
    if (idx !== -1) {
      const reRooted = path.join(root, filePath.slice(idx + path.basename(root).length + 2));
      const hit = tryPath(reRooted);
      if (hit) return hit;
    }
    const byBase = tryPath(path.join(root, path.basename(filePath)));
    if (byBase) return byBase;
  }
  return null;
}

async function openDiff(filePath: string) {
  const resolved = resolveDiffPath(filePath);
  if (!resolved) {
    vscode.window.showErrorMessage(
      `mermaid-collab: cannot open diff — file not found on this host: ${filePath}`,
    );
    return;
  }
  const workingUri = vscode.Uri.file(resolved);
  const title = `${resolved.split('/').pop()} (Working Tree)`;

  // Working-tree diff vs HEAD. Only works for a tracked file in a git repo; for
  // untracked/new files (no HEAD blob) or no repo it rejects — fall back to
  // just opening the file (not an error).
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    const git = gitExtension?.isActive
      ? (gitExtension.exports.getAPI(1) as {
          toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
          getRepository(uri: vscode.Uri): unknown;
        })
      : null;
    if (git && git.getRepository(workingUri)) {
      const headUri = git.toGitUri(workingUri, 'HEAD');
      // preview:false → each diff gets its own persistent tab.
      await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, title, {
        preview: false,
        preserveFocus: true,
      });
      return;
    }
  } catch { /* fall through to plain open */ }

  try {
    const doc = await vscode.workspace.openTextDocument(workingUri);
    await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
  } catch (err) {
    vscode.window.showErrorMessage(
      `mermaid-collab: failed to open ${title} (${resolved}) — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function scheduleReconnect(delay: number) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (_ctx) { connect(_ctx); }
  }, delay);
}

export function deactivate() {
  ws?.close();
}
