// UI-half of the mermaid-collab VS Code extension.
// Hosts Chrome debug tunnel + instance tunneling commands.
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

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

async function readLocalInstances(): Promise<Instance[]> {
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
      if (typeof inst?.port === 'number' && typeof inst?.sessionId === 'string') {
        out.push(inst);
      }
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
const tunnelsBySessionId = new Map<string, { dispose(): void; localAddress: { host: string; port: number } | string }>();

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
    vscode.commands.registerCommand('mermaidCollab.ui.onInstanceUp', async (inst: Instance) => {
      try {
        const existing = tunnelsBySessionId.get(inst.sessionId);
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
        tunnelsBySessionId.set(inst.sessionId, tunnel);
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
          return; // bail — don't write garbage
        }
        await ctx.globalState.update(`tunnel:${inst.sessionId}`, localPort);
        await vscode.workspace.getConfiguration('mermaidCollab')
          .update('serverUrl', `ws://127.0.0.1:${localPort}/ws`, vscode.ConfigurationTarget.Workspace);
        outputChannel.appendLine(`[tunnel] ${inst.session} → 127.0.0.1:${localPort} (remote ${inst.port})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[tunnel] openTunnel failed for ${inst.session}: ${msg}`);
        void vscode.window.showWarningMessage(`mermaid-collab: Couldn't forward port for ${inst.session} — ${msg}`);
      }
    }),
  );

  // NEW: instance-down handler — disposes tunnel
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.ui.onInstanceDown', async (inst: { sessionId: string }) => {
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
      try {
        const instances = await readLocalInstances();
        for (const inst of instances) {
          await ctx.globalState.update(`tunnel:${inst.sessionId}`, inst.port);
          await vscode.workspace.getConfiguration('mermaidCollab')
            .update('serverUrl', `ws://127.0.0.1:${inst.port}/ws`, vscode.ConfigurationTarget.Workspace);
          outputChannel.appendLine(`[local] ${inst.session} → 127.0.0.1:${inst.port}`);
        }
      } catch (err) {
        outputChannel.appendLine(`[local] readInstances failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }
}
