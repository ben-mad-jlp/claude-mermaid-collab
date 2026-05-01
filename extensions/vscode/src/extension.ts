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
const groupedSessionNames = new Map<string, string>(); // terminal name → tmux grouped session name

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

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      const groupedName = groupedSessionNames.get(t.name);
      if (groupedName) {
        groupedSessionNames.delete(t.name);
        execAsync(`tmux kill-session -t '${groupedName}'`).catch(() => {});
      }
    }),
  );

  connect(context);
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
    updateStatusBar(true);
    ws!.send(JSON.stringify({ type: 'subscribe', channel: 'ide' }));
    ws!.send(JSON.stringify({
      type: 'ide_connected',
      vscodeVersion: vscode.version,
      extensionVersion: context.extension.packageJSON.version as string,
      workspaceFolders: vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [],
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
    case 'ide_open_terminal':
      void processOneReattach({ session: msg.session as string }, true);
      break;
    case 'browser_open':
      void handleBrowserOpen(msg.requestId as string, msg.url as string);
      break;
    case 'browser_command':
      void handleBrowserCommand(msg.requestId as string, msg.sessionId as string, msg.method as string, msg.params);
      break;
    case 'browser_events':
      handleBrowserEvents(msg.requestId as string, msg.sessionId as string, msg.eventType as string);
      break;
    case 'browser_close':
      handleBrowserClose(msg.sessionId as string);
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

async function processOneReattach(msg: { session: string }, showTerminal: boolean) {
  const sessionHint = msg.session;
  const existing = vscode.window.terminals.find(t => t.name === sessionHint);
  if (existing) {
    if (showTerminal) { existing.show(false); }
    return;
  }
  try {
    await execAsync(`tmux has-session -t '${sessionHint}' 2>/dev/null`);
    const groupedName = `vscode-collab-${sessionHint}`;
    const cmd = `(tmux has-session -t '${groupedName}' 2>/dev/null || tmux new-session -d -s '${groupedName}' -t '${sessionHint}') && tmux attach-session -t '${groupedName}'`;
    groupedSessionNames.set(sessionHint, groupedName);
    const t = vscode.window.createTerminal({
      name: sessionHint,
      shellPath: '/bin/sh',
      shellArgs: ['-c', cmd],
    });
    if (showTerminal) { t.show(false); }
  } catch { /* tmux session not found or unavailable — skip */ }
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
  for (const session of browserSessions.values()) {
    session.cdpSocket.close();
    void vscode.debug.stopDebugging(session.debugSession);
  }
  browserSessions.clear();
}

// ── Browser CDP session management ─────────────────────────────────────────

interface CdpPending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  timestamp: number;
}

interface ConsoleEntry {
  level: string;
  text: string;
  timestamp: number;
}

interface BrowserSession {
  debugSession: vscode.DebugSession;
  cdpSocket: InstanceType<typeof WebSocket>;
  pending: Map<number, CdpPending>;
  nextId: number;
  consoleBuf: ConsoleEntry[];
  networkBuf: NetworkEntry[];
  networkMap: Map<string, NetworkEntry>;
}

const browserSessions = new Map<string, BrowserSession>();

function sendCollabMsg(msg: Record<string, unknown>): void {
  ws?.send(JSON.stringify(msg));
}

async function openBrowserSession(requestId: string, targetUrl: string): Promise<void> {
  const sessionName = `mc-browser-${Date.now()}`;
  const config: vscode.DebugConfiguration = {
    type: 'pwa-chrome',
    name: sessionName,
    request: 'launch',
    url: targetUrl,
    presentation: { hidden: true },
  };

  let disposable: vscode.Disposable;
  const sessionStarted = new Promise<vscode.DebugSession>((resolve, reject) => {
    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error('Debug session start timeout'));
    }, 20_000);
    disposable = vscode.debug.onDidStartDebugSession(s => {
      if (s.name === sessionName) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(s);
      }
    });
  });

  const ok = await vscode.debug.startDebugging(undefined, config);
  if (!ok) throw new Error('vscode.debug.startDebugging returned false');

  const debugSession = await sessionStarted;

  // Brief pause for browser to initialise before requesting proxy
  await new Promise(r => setTimeout(r, 1_000));

  const proxyResult = await vscode.commands.executeCommand(
    'extension.js-debug.requestCDPProxy',
    debugSession.id,
  ) as { host: string; port: number; path?: string } | string | undefined;

  if (!proxyResult) throw new Error('requestCDPProxy returned null — is js-debug active?');

  const cdpUrl = typeof proxyResult === 'string'
    ? proxyResult
    : `ws://${proxyResult.host}:${proxyResult.port}${proxyResult.path ?? ''}`;

  const cdpSocket = new WebSocket(cdpUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connect timeout')), 10_000);
    cdpSocket.on('open', () => { clearTimeout(timer); resolve(); });
    cdpSocket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });

  const session: BrowserSession = {
    debugSession,
    cdpSocket,
    pending: new Map(),
    nextId: 1,
    consoleBuf: [],
    networkBuf: [],
    networkMap: new Map(),
  };
  browserSessions.set(debugSession.id, session);

  cdpSocket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: unknown;
      };
      if (msg.id !== undefined) {
        const p = session.pending.get(msg.id);
        if (p) {
          session.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result ?? null);
        }
      } else if (msg.method) {
        handleCdpEvent(session, msg.method, msg.params);
      }
    } catch { /* ignore malformed */ }
  });

  cdpSocket.on('close', () => { browserSessions.delete(debugSession.id); });

  await sendCdp(session, 'Runtime.enable', {});
  await sendCdp(session, 'Page.enable', {});
  await sendCdp(session, 'Network.enable', {});
  await sendCdp(session, 'Log.enable', {});

  sendCollabMsg({ type: 'browser_ready', requestId, sessionId: debugSession.id });
}

function handleCdpEvent(session: BrowserSession, method: string, params: unknown): void {
  if (method === 'Runtime.consoleAPICalled') {
    const p = params as { type: string; args: Array<{ type: string; value?: unknown; description?: string }>; timestamp: number };
    const text = p.args.map(a => a.value !== undefined ? String(a.value) : (a.description ?? '')).join(' ');
    session.consoleBuf.push({ level: p.type, text, timestamp: Math.round(p.timestamp * 1000) });
    if (session.consoleBuf.length > 500) session.consoleBuf.shift();
  } else if (method === 'Log.entryAdded') {
    const p = params as { entry: { level: string; text: string; timestamp: number } };
    session.consoleBuf.push({ level: p.entry.level, text: p.entry.text, timestamp: Math.round(p.entry.timestamp * 1000) });
    if (session.consoleBuf.length > 500) session.consoleBuf.shift();
  } else if (method === 'Network.requestWillBeSent') {
    const p = params as { requestId: string; request: { url: string; method: string }; timestamp: number };
    session.networkMap.set(p.requestId, {
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      timestamp: Math.round(p.timestamp * 1000),
    });
  } else if (method === 'Network.responseReceived') {
    const p = params as { requestId: string; response: { status: number; mimeType: string } };
    const entry = session.networkMap.get(p.requestId);
    if (entry) { entry.status = p.response.status; entry.mimeType = p.response.mimeType; }
  } else if (method === 'Network.loadingFinished') {
    const p = params as { requestId: string };
    const entry = session.networkMap.get(p.requestId);
    if (entry) {
      session.networkBuf.push({ ...entry });
      session.networkMap.delete(p.requestId);
      if (session.networkBuf.length > 200) session.networkBuf.shift();
    }
  }
}

function sendCdp(session: BrowserSession, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = session.nextId++;
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`CDP ${method} timed out`));
    }, 10_000);
    session.pending.set(id, { resolve, reject, timer });
    session.cdpSocket.send(JSON.stringify({ id, method, params }));
  });
}

async function handleBrowserOpen(requestId: string, targetUrl: string): Promise<void> {
  try {
    await openBrowserSession(requestId, targetUrl);
  } catch (err) {
    sendCollabMsg({ type: 'browser_error', requestId, error: String(err) });
  }
}

async function handleBrowserCommand(requestId: string, sessionId: string, method: string, params: unknown): Promise<void> {
  const session = browserSessions.get(sessionId);
  if (!session) {
    sendCollabMsg({ type: 'browser_response', requestId, error: `Session not found: ${sessionId}` });
    return;
  }
  try {
    const result = await sendCdp(session, method, params ?? {});
    sendCollabMsg({ type: 'browser_response', requestId, result });
  } catch (err) {
    sendCollabMsg({ type: 'browser_response', requestId, error: String(err) });
  }
}

function handleBrowserEvents(requestId: string, sessionId: string, eventType: string): void {
  const session = browserSessions.get(sessionId);
  if (!session) {
    sendCollabMsg({ type: 'browser_response', requestId, error: `Session not found: ${sessionId}` });
    return;
  }
  if (eventType === 'console') {
    sendCollabMsg({ type: 'browser_response', requestId, result: [...session.consoleBuf] });
  } else if (eventType === 'network') {
    // Merge completed (networkBuf) + in-flight (networkMap), deduplicated
    const seen = new Set<string>();
    const all = [...session.networkBuf, ...session.networkMap.values()].filter(e => {
      if (seen.has(e.requestId)) return false;
      seen.add(e.requestId);
      return true;
    });
    sendCollabMsg({ type: 'browser_response', requestId, result: all });
  } else {
    sendCollabMsg({ type: 'browser_response', requestId, error: `Unknown event type: ${eventType}` });
  }
}

function handleBrowserClose(sessionId: string): void {
  const session = browserSessions.get(sessionId);
  if (!session) return;
  session.cdpSocket.close();
  void vscode.debug.stopDebugging(session.debugSession);
  browserSessions.delete(sessionId);
}
