// IDE bridge — terminal focus + diff opening
import * as vscode from 'vscode';
import { activateWorkspace } from './workspace-half';
import { activateUi, findChrome } from './ui-half';
import WebSocket from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let reconnectAttempts = 0;
const MAX_DELAY = 30_000;
const MAX_ATTEMPTS = 20;

let _ctx: vscode.ExtensionContext | undefined;

let hasReattachedThisSession = false;
const reattachQueue: Array<{ claudePid: number; claudeSessionId: string; project: string; session: string; boundAt: string }> = [];
let reattachProcessing = false;
const groupedSessionNames = new Map<string, string>(); // terminal name → tmux grouped session name

export function activate(context: vscode.ExtensionContext) {
  if (context.extension.extensionKind === vscode.ExtensionKind.Workspace) {
    return activateWorkspace(context);
  }
  activateUi(context);
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

  // Defer WebSocket connection until after extension host fully initializes.
  // Connecting immediately during startup causes the extension host to crash
  // (ECONNREFUSED → reconnect loop), triggering VS Code's "3 crashes" guard
  // which hangs the remote at "Initializing VS Code Server".
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
      void handleMessage(msg);
    } catch { /* ignore malformed */ }
  });

  ws.on('close', () => {
    hasReattachedThisSession = false;
    reconnectAttempts++;
    if (reconnectAttempts <= MAX_ATTEMPTS) {
      scheduleReconnect(reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
    }
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
      try {
        const git = gitExtension.exports.getAPI(1) as { toGitUri(uri: vscode.Uri, ref: string): vscode.Uri };
        const headUri = git.toGitUri(workingUri, 'HEAD');
        const title = `${filePath.split('/').pop()} (Working Tree)`;
        await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, title);
        return;
      } catch { /* fall through to text fallback */ }
    }
    const doc = await vscode.workspace.openTextDocument(workingUri);
    await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
  } catch (err) {
    vscode.window.showErrorMessage(`mermaid-collab: failed to open ${filePath.split('/').pop()} — ${err instanceof Error ? err.message : String(err)}`);
  }
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
  // Run the tmux check inside the terminal shell (on the remote/Linux side) so
  // the has-session call works even when the extension host is on Windows.
  const groupedName = `vscode-collab-${sessionHint}`;
  const cmd = `(tmux has-session -t '${groupedName}' 2>/dev/null || tmux new-session -d -s '${groupedName}' -t '${sessionHint}') && tmux attach-session -t '${groupedName}'`;
  groupedSessionNames.set(sessionHint, groupedName);
  const t = vscode.window.createTerminal({
    name: sessionHint,
    shellPath: '/bin/sh',
    shellArgs: ['-c', cmd],
  });
  if (showTerminal) { t.show(false); }
}

function scheduleReconnect(delay: number) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (_ctx) { connect(_ctx); }
  }, delay);
}

export function deactivate() {
  hasReattachedThisSession = false;
  ws?.close();
  for (const session of browserSessions.values()) {
    session.cdpSocket?.close();
  }
  browserSessions.clear();
  for (const cs of chromeSessions.values()) {
    cs.process.kill();
  }
  chromeSessions.clear();
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
  cdpSocket: InstanceType<typeof WebSocket> | null;
  pending: Map<number, CdpPending>;
  nextId: number;
  consoleBuf: ConsoleEntry[];
  networkBuf: NetworkEntry[];
  networkMap: Map<string, NetworkEntry>;
  ready: Promise<void>;
  cdpPort: number;
}

const browserSessions = new Map<string, BrowserSession>();

function sendCollabMsg(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    console.log('[mermaid-collab] sendCollabMsg dropped (ws not open):', msg.type);
  }
}

let nextCdpPort = 9230;

interface ChromeSession {
  process: import('child_process').ChildProcess;
}

const chromeSessions = new Map<string, ChromeSession>();

function httpGetJson(host: string, port: number, path: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const http = require('http') as typeof import('http');
    const req = http.request(
      { hostname: host, port, path, method: 'GET', headers: { Host: `${host}:${port}`, Connection: 'close' } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

async function findCdpUrlViaPowerShell(port: number): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -Command "(Invoke-WebRequest -Uri 'http://127.0.0.1:${port}/json' -UseBasicParsing).Content"`
    );
    const targets = JSON.parse(stdout.trim()) as Array<{ webSocketDebuggerUrl?: string; type?: string }>;
    const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    return page?.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

async function findCdpUrl(cdpPort: number, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  const usePowerShell = process.platform === 'win32';
  while (Date.now() < deadline) {
    if (usePowerShell) {
      const url = await findCdpUrlViaPowerShell(cdpPort);
      if (url) return url;
    } else {
      for (const host of ['127.0.0.1', 'localhost']) {
        try {
          const targets = await httpGetJson(host, cdpPort, '/json', 2000) as Array<{ webSocketDebuggerUrl?: string; type?: string }>;
          const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
        } catch { /* not ready yet */ }
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

function connectCdpSocket(cdpUrl: string): Promise<InstanceType<typeof WebSocket>> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(cdpUrl);
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connect timeout')), 10_000);
    sock.on('open', () => { clearTimeout(timer); resolve(sock); });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function enableCdpDomains(session: BrowserSession): Promise<void> {
  await sendCdp(session, 'Runtime.enable', {});
  await sendCdp(session, 'Page.enable', {});
  await sendCdp(session, 'Network.enable', {});
  await sendCdp(session, 'Log.enable', {});
}

function wireCdpSocket(sock: InstanceType<typeof WebSocket>, session: BrowserSession, sessionId: string): void {
  sock.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown;
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

  sock.on('close', () => {
    session.cdpSocket = null;
    if (!browserSessions.has(sessionId)) return; // intentionally closed via browser_close

    // Replace ready promise so subsequent commands queue up during reconnect
    let resolveReady!: () => void, rejectReady!: (e: Error) => void;
    session.ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
    void reconnectCdpSession(session, sessionId, resolveReady, rejectReady);
  });
}

async function reconnectCdpSession(
  session: BrowserSession,
  sessionId: string,
  resolveReady: () => void,
  rejectReady: (e: Error) => void,
): Promise<void> {
  try {
    const cdpUrl = await findCdpUrl(session.cdpPort, 10_000);
    if (!cdpUrl || !browserSessions.has(sessionId)) {
      rejectReady(new Error('CDP reconnect: no page target found'));
      browserSessions.delete(sessionId);
      return;
    }
    const sock = await connectCdpSocket(cdpUrl);
    session.cdpSocket = sock;
    wireCdpSocket(sock, session, sessionId);
    await enableCdpDomains(session);
    resolveReady();
  } catch (err) {
    rejectReady(err instanceof Error ? err : new Error(String(err)));
    browserSessions.delete(sessionId);
  }
}

async function openBrowserSession(requestId: string, targetUrl: string): Promise<void> {
  const cdpPort = nextCdpPort++;
  const sessionId = `mc-browser-${Date.now()}-${cdpPort}`;

  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  const readyPromise = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });

  const session: BrowserSession = {
    cdpSocket: null,
    pending: new Map(),
    nextId: 1,
    consoleBuf: [],
    networkBuf: [],
    networkMap: new Map(),
    ready: readyPromise,
    cdpPort,
  };
  browserSessions.set(sessionId, session);

  // Respond immediately so the MCP tool doesn't time out waiting for Chrome startup
  sendCollabMsg({ type: 'browser_ready', requestId, sessionId });

  // Finish Chrome setup in the background
  void (async () => {
    const popup = (text: string) => void vscode.window.showInformationMessage(`[collab ${process.platform}] ${text}`);
    const popupErr = (text: string) => void vscode.window.showErrorMessage(`[collab ${process.platform}] ${text}`);
    try {
      const configuredPath = vscode.workspace.getConfiguration('mermaidCollab').get<string>('chromePath') ?? '';
      let chromeBin: string;
      try {
        chromeBin = configuredPath.trim() || await findChrome();
      } catch (findErr) {
        const msg = `findChrome failed: ${findErr instanceof Error ? findErr.message : String(findErr)}`;
        popupErr(msg);
        sendCollabMsg({ type: 'browser_debug', sessionId, message: msg });
        browserSessions.delete(sessionId);
        rejectReady(new Error(msg));
        return;
      }
      popup(`step1: found chrome at ${chromeBin}`);
      sendCollabMsg({ type: 'browser_debug', sessionId, message: `step1: chrome=${chromeBin} port=${cdpPort}` });

      const tmpDir = process.platform === 'win32'
        ? `${process.env.TEMP ?? 'C:\\Temp'}\\mc-browser-${cdpPort}`
        : `/tmp/mc-browser-${cdpPort}`;
      const chromeArgs = [
        `--remote-debugging-port=${cdpPort}`,
        '--remote-allow-origins=*',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-sync',
        '--safebrowsing-disable-auto-update',
        `--user-data-dir=${tmpDir}`,
        targetUrl,
      ];
      const chromeProc = require('child_process').spawn(chromeBin, chromeArgs, { detached: false, stdio: 'ignore' });
      chromeSessions.set(sessionId, { process: chromeProc });
      popup(`step2: chrome spawned pid=${chromeProc.pid}`);
      sendCollabMsg({ type: 'browser_debug', sessionId, message: `step2: chrome spawned pid=${chromeProc.pid}` });

      // Listen for immediate crash
      let chromeCrashed = false;
      chromeProc.on('exit', (code: number | null) => {
        chromeCrashed = true;
        sendCollabMsg({ type: 'browser_debug', sessionId, message: `chrome exited code=${code}` });
      });

      popup(`step3: polling CDP at 127.0.0.1:${cdpPort}...`);
      const cdpUrl = await findCdpUrl(cdpPort, 60_000);
      if (!cdpUrl) {
        chromeProc.kill();
        chromeSessions.delete(sessionId);
        browserSessions.delete(sessionId);
        const msg = `step3 FAILED: CDP not available after 20s on port ${cdpPort} (crashed=${chromeCrashed})`;
        popupErr(msg);
        sendCollabMsg({ type: 'browser_debug', sessionId, message: msg });
        rejectReady(new Error(msg));
        return;
      }
      popup(`step3 OK: CDP at ${cdpUrl}`);
      sendCollabMsg({ type: 'browser_debug', sessionId, message: `step3 OK: ${cdpUrl}` });

      let cdpSocket: InstanceType<typeof WebSocket>;
      try {
        cdpSocket = await connectCdpSocket(cdpUrl);
      } catch (sockErr) {
        const msg = `step5 FAILED: CDP socket connect: ${sockErr instanceof Error ? sockErr.message : String(sockErr)}`;
        popupErr(msg);
        sendCollabMsg({ type: 'browser_debug', sessionId, message: msg });
        browserSessions.delete(sessionId);
        rejectReady(new Error(msg));
        return;
      }
      session.cdpSocket = cdpSocket;
      wireCdpSocket(cdpSocket, session, sessionId);
      popup(`step5 OK: CDP socket connected`);
      sendCollabMsg({ type: 'browser_debug', sessionId, message: 'step5 OK: socket connected' });

      try {
        await enableCdpDomains(session);
        await sendCdp(session, 'Page.bringToFront', {});
      } catch (domainErr) {
        const msg = `step6 FAILED: enable domains: ${domainErr instanceof Error ? domainErr.message : String(domainErr)}`;
        popupErr(msg);
        sendCollabMsg({ type: 'browser_debug', sessionId, message: msg });
        browserSessions.delete(sessionId);
        rejectReady(new Error(msg));
        return;
      }

      popup(`step6 OK: session ready!`);
      sendCollabMsg({ type: 'browser_debug', sessionId, message: 'step6 OK: session ready' });
      resolveReady();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      popupErr(`unexpected error: ${msg}`);
      sendCollabMsg({ type: 'browser_debug', sessionId, message: `unexpected: ${msg}` });
      browserSessions.delete(sessionId);
      rejectReady(err instanceof Error ? err : new Error(msg));
    }
  })();
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
    if (!session.cdpSocket) { reject(new Error('CDP socket not ready')); return; }
    const id = session.nextId++;
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`CDP ${method} timed out`));
    }, 10_000);
    session.pending.set(id, { resolve, reject, timer });
    session.cdpSocket.send(JSON.stringify({ id, method, params }));
  });
}

function handleBrowserOpen(requestId: string, targetUrl: string): void {
  console.log('[mermaid-collab] browser_open — platform:', process.platform, 'pid:', process.pid, 'url:', targetUrl);
  void vscode.window.showInformationMessage(`[collab] browser_open received on ${process.platform} (pid ${process.pid})`);
  void openBrowserSession(requestId, targetUrl);
}

async function handleBrowserCommand(requestId: string, sessionId: string, method: string, params: unknown): Promise<void> {
  const session = browserSessions.get(sessionId);
  if (!session) {
    sendCollabMsg({ type: 'browser_response', requestId, error: `Session not found: ${sessionId}` });
    return;
  }
  try {
    await session.ready;
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
  session.cdpSocket?.close();
  browserSessions.delete(sessionId);
  const cs = chromeSessions.get(sessionId);
  if (cs) { cs.process.kill(); chromeSessions.delete(sessionId); }
}

// ── Chrome debug tunnel moved to ui-half.ts ─────────────────────────────────
