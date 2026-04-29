import * as vscode from 'vscode';
import WebSocket from 'ws';
import { CollabApi, ArtifactType } from './api';
import { ArtifactPanelManager } from './ArtifactPanelManager';
import { SidebarViewProvider } from './SidebarViewProvider';

let ws: WebSocket | null = null;
let statusBarItem: vscode.StatusBarItem;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30_000;

let api: CollabApi | undefined;
let panelManager: ArtifactPanelManager | undefined;
let _ctx: vscode.ExtensionContext | undefined;
let _activeSession = '';

export function activate(context: vscode.ExtensionContext) {
  _ctx = context;

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'mermaidCollab.showStatus';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.showStatus', () => {
      const state = ws?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected';
      vscode.window.showInformationMessage(`mermaid-collab: ${state}`);
    }),
    vscode.commands.registerCommand('mermaidCollab.reconnect', () => {
      scheduleReconnect(0);
    }),
  );

  const apiUrl = vscode.workspace.getConfiguration('mermaidCollab').get<string>('apiUrl') ?? 'http://127.0.0.1:9002';
  const project = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const activeSession = context.workspaceState.get<string>('mermaidCollab.activeSession') ?? '';
  _activeSession = activeSession;

  api = new CollabApi(apiUrl);
  panelManager = new ArtifactPanelManager(context, api, activeSession);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'mermaidCollabPanel',
      new SidebarViewProvider(
        context,
        () => panelManager,
        () => _activeSession,
        () => project
      )
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.openArtifact', (id: string, type: string) => {
      panelManager?.open(id, type as ArtifactType);
    }),
  );

  updateStatusBar(false, activeSession);

  connect(context);

  return {
    extendMarkdownIt(md: any) {
      const defaultFence = (md.renderer.rules.fence as Function | undefined) ?? (md.renderer.rules.code_block as Function | undefined);
      md.renderer.rules.fence = (tokens: any[], idx: number, opts: any, env: any, self: any) => {
        const token = tokens[idx];
        if (token.info.trim() === 'mermaid') {
          return `<div class="mermaid">${token.content}</div>`;
        }
        return defaultFence ? defaultFence(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts);
      };
      return md;
    }
  };
}

function connect(context: vscode.ExtensionContext) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.removeAllListeners();
    ws.close();
  }
  const url = vscode.workspace.getConfiguration('mermaidCollab').get<string>('serverUrl') ?? 'ws://127.0.0.1:9002/ws';
  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectDelay = 1000;
    updateStatusBar(true, _activeSession);
    ws!.send(JSON.stringify({ type: 'subscribe', channel: 'ide' }));
    ws!.send(JSON.stringify({
      type: 'ide_connected',
      vscodeVersion: vscode.version,
      extensionVersion: context.extension.packageJSON.version as string,
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };
      void handleMessage(msg);
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    updateStatusBar(false, _activeSession);
    scheduleReconnect(reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  });

  ws.on('error', () => { /* close fires after error */ });
}

async function handleMessage(msg: { type: string; [k: string]: unknown }) {
  switch (msg.type) {
    case 'ide_focus_terminal':
      await focusTerminal(msg.claudePid as number, msg.session as string);
      break;
    case 'ide_open_diff':
      await openDiff(msg.filePath as string);
      break;
  }
}

async function focusTerminal(targetPid: number, sessionHint: string) {
  const terminals = vscode.window.terminals;
  const resolved = await Promise.all(
    terminals.map(async (t) => ({ terminal: t, pid: await t.processId }))
  );

  let parentPid: number | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process') as typeof import('child_process');
    const output = execSync(`ps -o ppid= -p ${targetPid}`).toString().trim();
    const parsed = parseInt(output, 10);
    if (!isNaN(parsed)) {
      parentPid = parsed;
    }
  } catch { /* process not found or ps unavailable — fall through to name match */ }

  const match = resolved.find((r) => r.pid === (parentPid ?? targetPid));
  if (match) {
    match.terminal.show(false);
    return;
  }
  const nameMatch = terminals.find((t) => t.name.toLowerCase().includes(sessionHint.toLowerCase()));
  if (nameMatch) {
    nameMatch.show(false);
    return;
  }
  void vscode.window.showWarningMessage(`mermaid-collab: Terminal for session "${sessionHint}" not found.`);
}

async function openDiff(filePath: string) {
  const workingUri = vscode.Uri.file(filePath);
  try {
    await vscode.commands.executeCommand('git.openChange', workingUri);
  } catch {
    const doc = await vscode.workspace.openTextDocument(workingUri);
    await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
  }
}

function scheduleReconnect(delay: number) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (_ctx) { connect(_ctx); }
  }, delay);
}

function updateStatusBar(connected: boolean, sessionName?: string) {
  statusBarItem.text = connected ? `$(plug) collab${sessionName ? ` · ${sessionName}` : ''}` : '$(debug-disconnect) collab';
  statusBarItem.tooltip = connected ? 'mermaid-collab: Connected' : 'mermaid-collab: Disconnected — click to reconnect';
  statusBarItem.command = connected ? 'mermaidCollab.showStatus' : 'mermaidCollab.reconnect';
}

export function deactivate() {
  ws?.close();
}
