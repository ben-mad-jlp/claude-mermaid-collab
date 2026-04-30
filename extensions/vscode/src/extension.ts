// IDE bridge — terminal focus + diff opening
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let ws: WebSocket | null = null;
let statusBarItem: vscode.StatusBarItem;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_DELAY = 30_000;

let _ctx: vscode.ExtensionContext | undefined;

let hasReattachedThisSession = false;
const reattachQueue: Array<{ claudePid: number; claudeSessionId: string; project: string; session: string; boundAt: string }> = [];
let reattachProcessing = false;

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

  updateStatusBar(false);

  connect(context);
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
    updateStatusBar(true);
    ws!.send(JSON.stringify({ type: 'subscribe', channel: 'ide' }));
    ws!.send(JSON.stringify({
      type: 'ide_connected',
      vscodeVersion: vscode.version,
      extensionVersion: context.extension.packageJSON.version as string,
      // Only send workspaceFolders when running locally — triggers reattach scan on server
      ...(!vscode.env.remoteName && { workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [] }),
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; [k: string]: unknown };
      void handleMessage(msg);
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    hasReattachedThisSession = false;
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
    case 'ide_reattach':
      void handleIdeReattach(msg as unknown as { claudePid: number; claudeSessionId: string; project: string; session: string; boundAt: string });
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
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension?.isActive) {
      const git = gitExtension.exports.getAPI(1) as { toGitUri(uri: vscode.Uri, ref: string): vscode.Uri };
      const headUri = git.toGitUri(workingUri, 'HEAD');
      const title = `${filePath.split('/').pop()} (Working Tree)`;
      await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, title);
      return;
    }
  } catch { /* fall through to text fallback */ }
  const doc = await vscode.workspace.openTextDocument(workingUri);
  await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
}

async function handleIdeReattach(msg: { claudePid: number; claudeSessionId: string; project: string; session: string; boundAt: string }) {
  if (vscode.env.remoteName) { return; } // tmux attach makes no sense from a remote context
  const isFirst = !hasReattachedThisSession;
  hasReattachedThisSession = true;
  reattachQueue.push(msg);
  if (!reattachProcessing) {
    await drainReattachQueue(isFirst);
  }
}

async function drainReattachQueue(isFirst: boolean) {
  reattachProcessing = true;
  let showNext = isFirst;
  while (reattachQueue.length > 0) {
    const msg = reattachQueue.shift()!;
    await processOneReattach(msg, showNext);
    showNext = false;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  reattachProcessing = false;
}

async function processOneReattach(msg: { claudePid: number; session: string }, showTerminal: boolean) {
  const sessionHint = msg.session;
  const existing = vscode.window.terminals.find(t => t.name === sessionHint);
  if (existing) {
    if (showTerminal) { existing.show(false); }
    return;
  }
  try {
    const { stdout: panesOutput } = await execAsync('tmux list-panes -a -F "#{session_name} #{window_index} #{pane_index} #{pane_pid}"');
    if (!panesOutput.trim()) { return; }
    const panes = panesOutput.trim().split('\n').map(line => {
      const parts = line.trim().split(' ');
      return { sessionName: parts[0], windowIdx: parts[1], paneIdx: parts[2], panePid: parseInt(parts[3], 10) };
    });
    let pid = msg.claudePid;
    let matchedPane: typeof panes[0] | undefined;
    for (let i = 0; i < 10; i++) {
      const found = panes.find(p => p.panePid === pid);
      if (found) { matchedPane = found; break; }
      try {
        const { stdout: ppidOut } = await execAsync(`ps -o ppid= -p ${pid}`);
        const ppid = parseInt(ppidOut.trim(), 10);
        if (isNaN(ppid) || ppid <= 1) { break; }
        pid = ppid;
      } catch { break; }
    }
    if (!matchedPane) { return; }
    const t = vscode.window.createTerminal({
      name: sessionHint,
      shellPath: '/bin/sh',
      shellArgs: ['-c', `tmux attach-session -t ${matchedPane.sessionName} \\; select-window -t ${matchedPane.windowIdx} \\; select-pane -t ${matchedPane.paneIdx}`],
    });
    if (showTerminal) { t.show(false); }
  } catch { /* tmux not available or failed — skip */ }
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
  hasReattachedThisSession = false;
  ws?.close();
}
