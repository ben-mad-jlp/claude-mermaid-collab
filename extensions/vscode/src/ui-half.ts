// UI-half of the mermaid-collab VS Code extension.
// Hosts Chrome debug tunnel + instance tunneling commands.
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { resolveServerSource } from './server-resolver';
import { spawnCollabServer, AlreadyRunning } from './spawn-server';

const execAsync = promisify(exec);

type CollabServerState =
  | { kind: 'stopped' }
  | { kind: 'starting'; sessionId: string }
  | { kind: 'ready'; sessionId: string; localPort: number }
  | { kind: 'skew'; sessionId: string; localPort: number; uiVersion: string; remoteVersion: string }
  | { kind: 'failed'; reason: string };

// ====================================================================
// Instance discovery (slim reader; full impl lives in src/services/...)
// ====================================================================
export interface Instance {
  version: 1;
  sessionId: string;
  port: number;
  project: string;
  session: string;
  pid: number;
  startedAt: string;
  serverVersion: string;
}

export async function readLocalInstances(): Promise<Instance[]> {
  const dir = path.join(os.homedir(), '.mermaid-collab', 'instances');
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: Instance[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const inst = JSON.parse(raw) as Instance;
      if (typeof inst?.port !== 'number' || typeof inst?.sessionId !== 'string') continue;
      // Skip instances whose process is no longer alive — the server may have
      // died without cleaning its file (e.g. force-kill on Windows). Tunneling
      // to a dead port would clobber serverUrl with a stale address.
      if (typeof inst.pid === 'number') {
        try { process.kill(inst.pid, 0); } catch { continue; }
      }
      out.push(inst);
    } catch {}
  }
  return out;
}

// ====================================================================
// Module state (lifted from extension.ts)
// ====================================================================
let statusBarItem: vscode.StatusBarItem;
let chromeDebugBar: vscode.StatusBarItem;
let chromeDebugProcess: import('child_process').ChildProcess | null = null;
let sshTunnelProcess: import('child_process').ChildProcess | null = null;
let chromeDebugRunning = false;
let outputChannel: vscode.OutputChannel;
let portWatcherTimer: ReturnType<typeof setInterval> | null = null;
const tunnelsBySessionId = new Map<string, { dispose(): void; localAddress: { host: string; port: number } | string; remotePort: number }>();
let collabServerState: CollabServerState = { kind: 'stopped' };
let collabServerChild: ChildProcess | null = null;
let collabServerBar: vscode.StatusBarItem;
let collabServerOutput: vscode.OutputChannel;
let instancesWatcher: fsSync.FSWatcher | null = null;
const pendingInstanceUp = new Map<string, { resolve: (inst: Instance) => void; cancel: (err: Error) => void }>();

// Read the current kind without TS narrowing it by assignment flow — the
// state can be mutated to 'stopped' asynchronously (stop command / dispose).
export function collabStateKind(): CollabServerState['kind'] {
  return collabServerState.kind;
}

function updateCollabServerBar(): void {
  if (!collabServerBar) return;
  const s = collabServerState;
  switch (s.kind) {
    case 'stopped':
      collabServerBar.text = '$(plug) collab';
      collabServerBar.tooltip = 'Click to start collab server';
      collabServerBar.backgroundColor = undefined;
      break;
    case 'starting':
      collabServerBar.text = '$(loading~spin) collab';
      collabServerBar.tooltip = 'Starting collab server…';
      collabServerBar.backgroundColor = undefined;
      break;
    case 'ready':
      collabServerBar.text = `$(check) collab :${s.localPort}`;
      collabServerBar.tooltip = `Collab server on :${s.localPort} — click to open UI`;
      collabServerBar.backgroundColor = undefined;
      break;
    case 'skew':
      collabServerBar.text = `$(warning) collab :${s.localPort}`;
      collabServerBar.tooltip = `Version mismatch — UI v${s.uiVersion}, remote v${s.remoteVersion}. Click to open UI anyway.`;
      collabServerBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
    case 'failed':
      collabServerBar.text = '$(error) collab';
      collabServerBar.tooltip = `Failed: ${s.reason} — click to view log`;
      collabServerBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      break;
  }
}

export function awaitInstanceUp(sessionId: string, timeoutMs = 30_000): Promise<Instance> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingInstanceUp.delete(sessionId);
      reject(new Error(`Timed out waiting for server (sessionId ${sessionId}) to come up`));
    }, timeoutMs);
    pendingInstanceUp.set(sessionId, {
      resolve: (inst) => {
        clearTimeout(timer);
        pendingInstanceUp.delete(sessionId);
        resolve(inst);
      },
      cancel: (err) => {
        clearTimeout(timer);
        pendingInstanceUp.delete(sessionId);
        reject(err);
      },
    });
  });
}

/** Rejects every in-flight awaitInstanceUp — used on stop/dispose so a late
 *  instance file can't flip the bar back to `ready` after the user stopped. */
export function cancelAllPending(reason: string): void {
  for (const entry of Array.from(pendingInstanceUp.values())) {
    try { entry.cancel(new Error(reason)); } catch {}
  }
  pendingInstanceUp.clear();
}

async function startCollabServerLocal(ctx: vscode.ExtensionContext, project: string, session: string): Promise<void> {
  collabServerState = { kind: 'starting', sessionId: '' };
  updateCollabServerBar();
  try {
    const source = await resolveServerSource();
    const result = await spawnCollabServer({ project, session, source, output: collabServerOutput });
    collabServerChild = result.child;
    collabServerState = { kind: 'starting', sessionId: result.sessionId };
    updateCollabServerBar();
    // Detect a crash/exit of the spawned server so the bar doesn't stay green
    // on a dead process. Only act if this child still owns the current state.
    const onServerGone = (detail: string) => {
      if (collabServerChild !== result.child) return;
      collabServerChild = null;
      cancelAllPending(`server exited (${detail})`);
      const owns =
        (collabServerState.kind === 'ready' || collabServerState.kind === 'skew' || collabServerState.kind === 'starting') &&
        collabServerState.sessionId === result.sessionId;
      if (!owns) return;
      collabServerOutput.appendLine(`[server] ${detail} — marking collab server stopped`);
      collabServerState = { kind: 'failed', reason: `server exited (${detail})` };
      updateCollabServerBar();
    };
    result.child.once('exit', (code, signal) => onServerGone(`code=${code} signal=${signal}`));
    result.child.once('error', (e) => onServerGone(e instanceof Error ? e.message : String(e)));
    const inst = await awaitInstanceUp(result.sessionId);
    // The user may have hit Stop while we were starting — don't override that.
    if (collabServerState.kind !== 'starting' || collabServerState.sessionId !== result.sessionId) return;
    // onInstanceUp has written the resolved tunnel port to globalState by now;
    // prefer it over the raw server port (they can differ on non-loopback).
    const localPort = ctx.globalState.get<number>(`tunnel:${result.sessionId}`) ?? inst.port;
    const uiVersion = ctx.extension.packageJSON.version as string;
    if (inst.serverVersion && inst.serverVersion !== uiVersion) {
      collabServerState = { kind: 'skew', sessionId: result.sessionId, localPort, uiVersion, remoteVersion: inst.serverVersion };
    } else {
      collabServerState = { kind: 'ready', sessionId: result.sessionId, localPort };
    }
    updateCollabServerBar();
  } catch (err) {
    // User pressed Stop while starting — cancelAllPending rejected us; honor it.
    if (collabStateKind() === 'stopped') return;
    if (err instanceof AlreadyRunning) {
      collabServerState = { kind: 'ready', sessionId: err.sessionId, localPort: err.port };
      updateCollabServerBar();
      await vscode.commands.executeCommand('mermaidCollab.openUi');
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    collabServerOutput.appendLine(`[start] failed: ${reason}`);
    collabServerOutput.show(true);
    collabServerState = { kind: 'failed', reason };
    updateCollabServerBar();
    void vscode.window.showWarningMessage(`mermaid-collab: failed to start server — ${reason}`);
  }
}

async function startCollabServerRemote(ctx: vscode.ExtensionContext, project: string, session: string): Promise<void> {
  collabServerState = { kind: 'starting', sessionId: '' };
  updateCollabServerBar();
  try {
    const result = await vscode.commands.executeCommand<{ pid: number; sessionId: string; version: string }>(
      'mermaidCollab.workspace.startServer', { project, session },
    );
    if (!result) throw new Error('workspace half did not return a result');
    collabServerState = { kind: 'starting', sessionId: result.sessionId };
    updateCollabServerBar();
    const inst = await awaitInstanceUp(result.sessionId);
    if (collabServerState.kind !== 'starting' || collabServerState.sessionId !== result.sessionId) return;
    const desiredLocal = ctx.globalState.get<number>(`tunnel:${result.sessionId}`);
    const localPort = typeof desiredLocal === 'number' ? desiredLocal : inst.port;
    const uiVersion = ctx.extension.packageJSON.version as string;
    if (result.version && result.version !== uiVersion) {
      collabServerState = { kind: 'skew', sessionId: result.sessionId, localPort, uiVersion, remoteVersion: result.version };
    } else {
      collabServerState = { kind: 'ready', sessionId: result.sessionId, localPort };
    }
    updateCollabServerBar();
  } catch (err) {
    if (collabStateKind() === 'stopped') return;
    const reason = err instanceof Error ? err.message : String(err);
    collabServerOutput.appendLine(`[start:remote] failed: ${reason}`);
    collabServerOutput.show(true);
    collabServerState = { kind: 'failed', reason };
    updateCollabServerBar();
    void vscode.window.showWarningMessage(`mermaid-collab: failed to start remote server — ${reason}`);
  }
}

// ── Chrome binary discovery ────────────────────────────────────────────────

export const CHROME_BINARIES_LINUX = [
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];
export const CHROME_BINARIES_MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
export const CHROME_BINARIES_WIN = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local'}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

export async function findChrome(): Promise<string> {
  const { existsSync } = require('fs') as typeof import('fs');
  const bins = process.platform === 'darwin' ? CHROME_BINARIES_MAC
    : process.platform === 'win32' ? CHROME_BINARIES_WIN
    : CHROME_BINARIES_LINUX;
  for (const bin of bins) {
    if (bin && existsSync(bin)) return bin;
  }
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const found = execSync('mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\'" 2>/dev/null | head -1').toString().trim();
      if (found) {
        const bin = `${found}/Contents/MacOS/Google Chrome`;
        if (existsSync(bin)) return bin;
      }
      const brave = execSync('mdfind "kMDItemCFBundleIdentifier == \'com.brave.Browser\'" 2>/dev/null | head -1').toString().trim();
      if (brave) {
        const bin = `${brave}/Contents/MacOS/Brave Browser`;
        if (existsSync(bin)) return bin;
      }
    } catch { /* ignore */ }
  }
  throw new Error('No Chrome/Chromium binary found — install Chrome or set mermaidCollab.chromePath');
}

// ── Chrome debug tunnel ────────────────────────────────────────────────────

function updateChromeDebugBar(): void {
  if (chromeDebugRunning) {
    chromeDebugBar.text = '$(broadcast) CDP';
    chromeDebugBar.tooltip = 'Chrome debug tunnel running — click to stop';
    chromeDebugBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    chromeDebugBar.text = '$(debug-disconnect) CDP';
    chromeDebugBar.tooltip = 'Chrome debug tunnel stopped — click to start';
    chromeDebugBar.backgroundColor = undefined;
  }
}

function checkPort(port: number): Promise<boolean> {
  const net = require('net') as typeof import('net');
  return new Promise(resolve => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.setTimeout(800);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function startPortWatcher(port: number): void {
  if (portWatcherTimer) clearInterval(portWatcherTimer);
  portWatcherTimer = setInterval(async () => {
    if (!chromeDebugRunning) { clearInterval(portWatcherTimer!); portWatcherTimer = null; return; }
    const up = await checkPort(port);
    if (!up) {
      outputChannel.appendLine(`[CDP] Port ${port} gone — Chrome stopped`);
      clearInterval(portWatcherTimer!); portWatcherTimer = null;
      chromeDebugProcess = null;
      chromeDebugRunning = false;
      updateChromeDebugBar();
    }
  }, 3000);
}

async function pollForPort(port: number, budgetMs: number, launchStderr: string): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const tryOnce = async (): Promise<void> => {
    if (await checkPort(port)) {
      outputChannel.appendLine(`[CDP] Port ${port} is up — Chrome started successfully`);
      startPortWatcher(port);
      return;
    }
    if (Date.now() < deadline) {
      setTimeout(tryOnce, 400);
    } else {
      outputChannel.appendLine(`[CDP] Timed out waiting for port ${port}`);
      chromeDebugRunning = false;
      updateChromeDebugBar();
      const hint = launchStderr.trim().split('\n')[0] || 'port never came up';
      vscode.window.showErrorMessage(`mermaid-collab: Chrome failed to bind port ${port} — ${hint}`, 'Show Log')
        .then(sel => { if (sel === 'Show Log') outputChannel.show(); });
    }
  };
  await tryOnce();
}

async function startChromeDebug(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('mermaidCollab');
  const port = cfg.get<number>('chromeDebugPort') ?? 9333;
  const defaultUserDataDir = process.platform === 'win32' ? 'C:\\ChromeDebug'
    : process.platform === 'darwin' ? require('path').join(require('os').homedir(), 'Library', 'Application Support', 'ChromeDebug')
    : '/tmp/chrome-debug';
  const configuredDataDir = cfg.get<string>('chromeDebugUserDataDir') ?? '';
  const isWindowsPath = (p: string) => /^[A-Za-z]:[\\\/]/.test(p);
  const userDataDir = (configuredDataDir && !(process.platform !== 'win32' && isWindowsPath(configuredDataDir)))
    ? configuredDataDir : defaultUserDataDir;
  const sshTarget = cfg.get<string>('sshTunnelTarget') ?? '';

  const configuredPath = cfg.get<string>('chromePath') ?? '';
  let chromeBin: string;
  try {
    chromeBin = configuredPath.trim() || await findChrome();
  } catch (err) {
    vscode.window.showErrorMessage(`mermaid-collab: Chrome not found — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  const startTime = Date.now();

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
  ];

  outputChannel.appendLine(`[CDP] Starting Chrome: ${chromeBin}`);
  outputChannel.appendLine(`[CDP] Args: ${chromeArgs.join(' ')}`);
  outputChannel.show(true);

  const { spawn } = require('child_process') as typeof import('child_process');

  if (process.platform === 'darwin') {
    const appBundle = chromeBin.replace(/\/Contents\/MacOS\/.*$/, '');
    outputChannel.appendLine(`[CDP] macOS: using open -n "${appBundle}"`);
    const openProc = spawn('open', ['-n', appBundle, '--args', ...chromeArgs],
      { detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let openStderr = '';
    openProc.stderr?.on('data', (d: Buffer) => { openStderr += d.toString(); });
    openProc.on('exit', (code) => {
      outputChannel.appendLine(`[CDP] open exited (code=${code})${openStderr.trim() ? ` — ${openStderr.trim()}` : ''}`);
      if (!chromeDebugRunning) return;
      void pollForPort(port, 8000, openStderr);
    });
    chromeDebugProcess = openProc;
  } else {
    chromeDebugProcess = spawn(chromeBin, chromeArgs,
      { detached: false, stdio: ['ignore', 'pipe', 'pipe'] });

    let chromeStderr = '';
    chromeDebugProcess.stderr?.on('data', (d: Buffer) => {
      const txt = d.toString();
      chromeStderr += txt;
      outputChannel.append(`[Chrome stderr] ${txt}`);
    });
    chromeDebugProcess.on('exit', (code) => {
      const elapsed = Date.now() - startTime;
      outputChannel.appendLine(`[CDP] Chrome exited (code=${code}, after ${elapsed}ms)`);
      chromeDebugProcess = null;
      if (!chromeDebugRunning) return;
      chromeDebugRunning = false;
      updateChromeDebugBar();
      if (elapsed < 5000) {
        const hint = chromeStderr.trim().split('\n')[0] || `exit code ${code}`;
        vscode.window.showErrorMessage(`mermaid-collab: Chrome exited unexpectedly — ${hint}`, 'Show Log')
          .then(sel => { if (sel === 'Show Log') outputChannel.show(); });
      }
    });
  }

  if (sshTarget) {
    sshTunnelProcess = spawn('ssh', [
      '-R', `${port}:127.0.0.1:${port}`,
      '-N',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ExitOnForwardFailure=yes',
      sshTarget,
    ], { detached: false, stdio: ['ignore', 'ignore', 'pipe'] });

    let sshStderr = '';
    sshTunnelProcess.stderr?.on('data', (d: Buffer) => { sshStderr += d.toString(); });

    sshTunnelProcess.on('exit', (code) => {
      sshTunnelProcess = null;
      if (chromeDebugRunning) {
        chromeDebugRunning = false;
        updateChromeDebugBar();
        const detail = sshStderr.trim() ? ` — ${sshStderr.trim().split('\n')[0]}` : ` (exit ${code})`;
        vscode.window.showWarningMessage(`mermaid-collab: SSH tunnel disconnected${detail}`);
      }
    });
  }

  chromeDebugRunning = true;
  updateChromeDebugBar();
  vscode.window.showInformationMessage(`mermaid-collab: Chrome debug${sshTarget ? ' + SSH tunnel' : ''} started on port ${port}`);
}

function stopChromeDebug(): void {
  if (portWatcherTimer) { clearInterval(portWatcherTimer); portWatcherTimer = null; }
  chromeDebugProcess?.kill();
  chromeDebugProcess = null;
  sshTunnelProcess?.kill();
  sshTunnelProcess = null;
  chromeDebugRunning = false;
  updateChromeDebugBar();
}

// ====================================================================
// activateUi
// ====================================================================
export function activateUi(ctx: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'mermaidCollab.showStatus';
  statusBarItem.text = '$(debug-disconnect) collab';
  statusBarItem.tooltip = 'mermaid-collab UI half';
  statusBarItem.show();
  ctx.subscriptions.push(statusBarItem);

  chromeDebugBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  chromeDebugBar.command = 'mermaidCollab.toggleChromeDebug';
  chromeDebugBar.show();
  ctx.subscriptions.push(chromeDebugBar);
  updateChromeDebugBar();

  outputChannel = vscode.window.createOutputChannel('mermaid-collab CDP');
  ctx.subscriptions.push(outputChannel);

  collabServerBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  collabServerBar.command = 'mermaidCollab.toggleCollabServer';
  collabServerBar.show();
  ctx.subscriptions.push(collabServerBar);
  collabServerOutput = vscode.window.createOutputChannel('mermaid-collab Server');
  ctx.subscriptions.push(collabServerOutput);
  updateCollabServerBar();
  ctx.subscriptions.push({ dispose: () => {
    cancelAllPending('extension deactivated');
    if (collabServerChild) { try { collabServerChild.kill('SIGTERM'); } catch {} }
  } });

  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.toggleCollabServer', async () => {
      const wf = vscode.workspace.workspaceFolders?.[0];
      if (!wf) { void vscode.window.showWarningMessage('mermaid-collab: open a folder first'); return; }
      const project = wf.uri.fsPath;
      const session = path.basename(project);
      if (collabServerState.kind === 'ready' || collabServerState.kind === 'skew') {
        return vscode.commands.executeCommand('mermaidCollab.openUi');
      }
      if (collabServerState.kind === 'starting') return;
      if (collabServerState.kind === 'failed') collabServerOutput.show(true);
      if (vscode.env.remoteName) return startCollabServerRemote(ctx, project, session);
      return startCollabServerLocal(ctx, project, session);
    }),
    vscode.commands.registerCommand('mermaidCollab.stopCollabServer', async () => {
      collabServerState = { kind: 'stopped' };
      cancelAllPending('stopped by user');
      if (collabServerChild) { try { collabServerChild.kill('SIGTERM'); } catch {} collabServerChild = null; }
      updateCollabServerBar();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.toggleChromeDebug', () => {
      if (chromeDebugRunning) stopChromeDebug();
      else void startChromeDebug();
    }),
    vscode.commands.registerCommand('mermaidCollab.startChromeDebug', () => { void startChromeDebug(); }),
    vscode.commands.registerCommand('mermaidCollab.stopChromeDebug', () => { stopChromeDebug(); }),
    vscode.commands.registerCommand('mermaidCollab.showStatus', () => {
      vscode.window.showInformationMessage('mermaid-collab UI half active');
    }),
  );

  // NEW: instance-up handler — opens tunnel and updates serverUrl
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.ui.onInstanceUp', async (inst?: Instance) => {
      // Internal RPC target — no-op when invoked manually from the command palette.
      if (!inst || typeof inst.sessionId !== 'string' || typeof inst.port !== 'number') {
        outputChannel.appendLine('[tunnel] onInstanceUp called without a valid Instance — ignoring');
        return;
      }
      const pending = pendingInstanceUp.get(inst.sessionId);
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        pending?.resolve(inst);
      };
      try {
        const existing = tunnelsBySessionId.get(inst.sessionId);
        if (existing && existing.remotePort === inst.port) {
          // Same instance still on the same remote port — fs.watch fired for a
          // heartbeat/.lock rewrite, not a real change. Don't churn the tunnel.
          settle();
          return;
        }
        if (existing) {
          try { (existing as any).dispose?.(); } catch {}
          tunnelsBySessionId.delete(inst.sessionId);
        }
        const desiredLocal = ctx.globalState.get<number>(`tunnel:${inst.sessionId}`);
        const tunnel = (await (vscode.workspace as any).openTunnel({
          remoteAddress: { host: '127.0.0.1', port: inst.port },
          localAddressPort: desiredLocal,
          label: `collab:${inst.session}`,
        })) as { dispose(): void; localAddress: { host: string; port: number } | string };
        ctx.subscriptions.push(tunnel as vscode.Disposable);
        tunnelsBySessionId.set(inst.sessionId, { ...tunnel, dispose: () => tunnel.dispose(), remotePort: inst.port });
        const la: unknown = (tunnel as any).localAddress;
        let localPort: number | undefined;
        if (typeof la === 'string') {
          const m = la.match(/:(\d+)$/);
          localPort = m ? Number(m[1]) : undefined;
        } else if (la && typeof la === 'object' && typeof (la as any).port === 'number') {
          localPort = (la as any).port;
        }
        if (typeof localPort !== 'number' || localPort <= 0) {
          outputChannel.appendLine(`[tunnel] could not determine local port for ${inst.session} from ${JSON.stringify(la)}`);
          settle(); // server is up; caller falls back to inst.port
          return; // bail — don't write garbage
        }
        await ctx.globalState.update(`tunnel:${inst.sessionId}`, localPort);
        await vscode.workspace.getConfiguration('mermaidCollab')
          .update('serverUrl', `ws://127.0.0.1:${localPort}/ws`, vscode.ConfigurationTarget.Workspace);
        outputChannel.appendLine(`[tunnel] ${inst.session} → 127.0.0.1:${localPort} (remote ${inst.port})`);
        // Resolve the awaiter only now — serverUrl is written, so an immediate
        // open-UI click after `ready` can't read a stale serverUrl.
        settle();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[tunnel] openTunnel failed for ${inst.session}: ${msg}`);
        void vscode.window.showWarningMessage(`mermaid-collab: Couldn't forward port for ${inst.session} — ${msg}`);
        settle(); // server itself is up even if forwarding failed
      }
    }),
  );

  // NEW: instance-down handler — disposes tunnel
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.ui.onInstanceDown', async (inst?: { sessionId?: string }) => {
      if (!inst || typeof inst.sessionId !== 'string') {
        outputChannel.appendLine('[tunnel] onInstanceDown called without a valid sessionId — ignoring');
        return;
      }
      const t = tunnelsBySessionId.get(inst.sessionId);
      if (t) {
        try { t.dispose(); } catch {}
        tunnelsBySessionId.delete(inst.sessionId);
        outputChannel.appendLine(`[tunnel] ${inst.sessionId} closed`);
      }
    }),
  );

  // NEW: open UI in browser
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.openUi', async (inst?: Instance) => {
      let localPort: number | undefined;
      if (inst) localPort = ctx.globalState.get<number>(`tunnel:${inst.sessionId}`);
      if (!localPort) {
        const cfg = vscode.workspace.getConfiguration('mermaidCollab').get<string>('serverUrl') ?? '';
        const m = cfg.match(/:(\d+)\/ws$/);
        localPort = m ? Number(m[1]) : undefined;
      }
      if (!localPort) {
        void vscode.window.showWarningMessage('mermaid-collab: no local UI port known yet');
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${localPort}`));
    }),
  );

  // Local-only path: scan ~/.mermaid-collab/instances/ for already-running local servers
  if (ctx.extension.extensionKind === vscode.ExtensionKind.UI) {
    void (async () => {
      const instancesDir = path.join(os.homedir(), '.mermaid-collab', 'instances');
      try { await fs.mkdir(instancesDir, { recursive: true }); } catch {}
      const rescan = async () => {
        try {
          const instances = await readLocalInstances();
          for (const inst of instances) {
            await vscode.commands.executeCommand('mermaidCollab.ui.onInstanceUp', inst);
          }
        } catch (err) {
          collabServerOutput.appendLine(`[watch] rescan failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      await rescan();

      // Coalesce bursts (macOS fires rename ~2x; servers rewrite heartbeats).
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const scheduleRescan = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => { debounce = null; void rescan(); }, 250);
      };

      let pollTimer: ReturnType<typeof setInterval> | null = null;
      const startPolling = () => {
        if (pollTimer) return;
        collabServerOutput.appendLine('[watch] falling back to 30s polling');
        pollTimer = setInterval(() => { void rescan(); }, 30_000);
      };

      try {
        instancesWatcher = fsSync.watch(instancesDir, { persistent: false }, (_event, filename) => {
          // Only .json files matter; ignore .lock churn and editor temp files.
          if (filename && !String(filename).endsWith('.json')) return;
          scheduleRescan();
        });
        // watch() can succeed then later emit 'error' (NFS, dir removed) — fall
        // back to polling instead of silently going deaf.
        instancesWatcher.on('error', (err) => {
          collabServerOutput.appendLine(`[watch] watcher error: ${err instanceof Error ? err.message : String(err)}`);
          try { instancesWatcher?.close(); } catch {}
          instancesWatcher = null;
          startPolling();
        });
        ctx.subscriptions.push({ dispose: () => {
          if (debounce) clearTimeout(debounce);
          if (pollTimer) clearInterval(pollTimer);
          instancesWatcher?.close();
        } });
      } catch {
        startPolling();
        ctx.subscriptions.push({ dispose: () => {
          if (debounce) clearTimeout(debounce);
          if (pollTimer) clearInterval(pollTimer);
        } });
      }
    })();
  }
}
