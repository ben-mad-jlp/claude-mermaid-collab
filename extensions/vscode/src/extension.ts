import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let statusBarItem: vscode.StatusBarItem;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30_000;

export function activate(context: vscode.ExtensionContext) {
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

  connect(context);
}

function connect(context: vscode.ExtensionContext) {
  const url = vscode.workspace.getConfiguration('mermaidCollab').get<string>('serverUrl') ?? 'ws://127.0.0.1:9002/ws';
  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectDelay = 1000;
    updateStatusBar(true);
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
    updateStatusBar(false);
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
    // context is not available here; pass a stub — connect only uses context for packageJSON in the open handler
    connect({ extension: { packageJSON: { version: '1.0.0' } } } as unknown as vscode.ExtensionContext);
  }, delay);
}

function updateStatusBar(connected: boolean) {
  statusBarItem.text = connected ? '$(plug) collab' : '$(debug-disconnect) collab';
  statusBarItem.tooltip = connected ? 'mermaid-collab: Connected' : 'mermaid-collab: Disconnected — click to reconnect';
  statusBarItem.command = connected ? 'mermaidCollab.showStatus' : 'mermaidCollab.reconnect';
}

export function deactivate() {
  ws?.close();
}
