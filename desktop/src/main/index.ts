import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import { ServerSupervisor, getFreePort } from './server-supervisor';
import { BrowserPaneManager } from './browser-pane';
import { DesktopControl } from './desktop-control';
import { ServerProxy } from './server-proxy';
import { ConnectionStore } from './connection-store';
import { WatchAggregator } from './watch-aggregator';

// Phase 0.1 — Electron shell skeleton.
// Single-instance lock so a second launch focuses the first window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let supervisor: ServerSupervisor | null = null;
let paneManager: BrowserPaneManager | null = null;
let proxy: ServerProxy | null = null;
let store: ConnectionStore | null = null;
let control: DesktopControl | null = null;
let aggregator: WatchAggregator | null = null;

/** Register the `mc` IPC handlers backing the preload bridge. */
function registerIpc(): void {
  ipcMain.handle('mc:listServers', () => store?.list() ?? []);
  ipcMain.handle('mc:getActiveServer', () => store?.getActive()?.id ?? null);
  ipcMain.handle('mc:addServer', (_e, opts: { label: string; host: string; port: number; token?: string }) =>
    store?.add(opts) ?? null
  );
  ipcMain.handle('mc:removeServer', (_e, id: string) => {
    store?.remove(id);
  });
  ipcMain.handle('mc:switchServer', (_e, id: string) => {
    if (!store || !proxy) return { ok: false };
    const entry = store.get(id);
    if (!entry) return { ok: false };
    store.setActive(id);
    proxy.setUpstream({ host: entry.host, port: entry.port, token: entry.token });
    return { ok: true };
  });
  ipcMain.handle('mc:browser:listTabs', () => paneManager?.listTabs() ?? []);
  ipcMain.handle('mc:browser:openTab', (_e, opts) => paneManager?.openUserTab(opts ?? {}) ?? null);
  ipcMain.handle('mc:browser:closeTab', (_e, id: string) => { paneManager?.closeTab(id); });
  ipcMain.handle('mc:browser:activateTab', (_e, id: string) => { paneManager?.activateTab(id); });
  ipcMain.handle('mc:browser:navigate', (_e, id: string, url: string) => paneManager?.navigate(id, url));
  ipcMain.handle('mc:browser:goBack', (_e, id: string) => { paneManager?.goBack(id); });
  ipcMain.handle('mc:browser:goForward', (_e, id: string) => { paneManager?.goForward(id); });
  ipcMain.handle('mc:browser:reload', (_e, id: string) => { paneManager?.reload(id); });
  ipcMain.handle('mc:browser:setBounds', (_e, rect) => { paneManager?.setBounds(rect); });
  ipcMain.handle('mc:setZoomFactor', (_e, factor: number) => { mainWindow?.webContents.setZoomFactor(factor); });
  // Probe a server's reachability from the main process (the renderer can't
  // cross-origin fetch other servers). Returns true iff /api/health responds OK.
  ipcMain.handle('mc:probeServer', async (_e, opts: { host: string; port: number }) => {
    try {
      const r = await fetch(`http://${opts.host}:${opts.port}/api/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  });
  ipcMain.handle('mc:setWatchedServers', (_e, ids: string[]) => {
    if (!store || !aggregator) return;
    const ups = (ids ?? []).map((id: string) => store!.get(id)).filter(Boolean).map((e: any) => ({ id: e.id, host: e.host, port: e.port, token: e.token }));
    aggregator.setWatched(ups);
  });
}

// Register the mermaid-collab:// deep-link scheme so links from browsers/Slack
// open (or focus) this app at a given project/session.
app.setAsDefaultProtocolClient('mermaid-collab');

let mainWindow: BrowserWindow | null = null;

/** Parse a mermaid-collab://<project>/<session> URL. Routing comes later. */
function parseDeepLink(url: string): { project: string; session: string } | null {
  try {
    const u = new URL(url);
    const project = u.hostname;
    const session = u.pathname.replace(/^\//, '');
    console.log(`[deeplink] project=${project} session=${session}`);
    return { project, session };
  } catch {
    console.warn(`[deeplink] could not parse: ${url}`);
    return null;
  }
}

function focusMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// Windows/Linux: a second launch forwards its argv here.
app.on('second-instance', (_event, argv) => {
  const url = argv.find((a) => a.startsWith('mermaid-collab://'));
  if (url) parseDeepLink(url);
  focusMainWindow();
});

// macOS: deep links arrive via open-url, not argv.
app.on('open-url', (event, url) => {
  event.preventDefault();
  parseDeepLink(url);
  focusMainWindow();
});

/**
 * The collab brand icon (pixel whale). electron-builder bakes it into the
 * packaged .icns/.ico via build/icon.png; this also sets it at runtime so the
 * window + macOS dock show it when running unpackaged (e.g. `electron .` / debug).
 * Packaged: copied to resourcesPath via `extraResources`. Dev: read from build/.
 */
function loadAppIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png');
  return nativeImage.createFromPath(iconPath);
}

function createWindow(): void {
  const appIcon = loadAppIcon();
  // macOS shows the dock icon from the bundle, but unpackaged dev runs default
  // to the Electron icon unless we set it explicitly.
  if (process.platform === 'darwin' && app.dock && !appIcon.isEmpty()) {
    app.dock.setIcon(appIcon);
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  // electron-vite injects ELECTRON_RENDERER_URL in dev; in prod load the built file.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    // Release all browser pane tabs so they don't leak.
    if (paneManager) {
      for (const t of paneManager.listTabs()) paneManager.closeTab(t.id);
      paneManager = null;
    }
    mainWindow = null;
  });
}

async function bootstrap(): Promise<void> {
  // The CDP switch MUST be set before the app reaches 'ready'. getFreePort is
  // fast, so awaiting it here is safe (spike lesson: a long await before this
  // lets the app become ready first and the switch is ignored).
  // MC_CDP_PORT pins the renderer CDP port for debugging (so tools can attach to
  // a known endpoint); otherwise a free port is chosen. MC_INSPECT exposes the
  // Node main process to the inspector (e.g. MC_INSPECT=9229). Both are opt-in —
  // normal launches are unaffected.
  const cdpPort = process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : await getFreePort();
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  if (process.env.MC_INSPECT) app.commandLine.appendSwitch('inspect', process.env.MC_INSPECT);

  await app.whenReady();
  createWindow();

  // Spawn (or attach to) the Bun sidecar, pointing its browser tools at our
  // own embedded view via CDP_PORT + MC_BROWSER_TARGET (set inside the supervisor).
  const repoRoot = process.env.MC_REPO_ROOT ?? join(app.getAppPath(), '..');
  // In a packaged app the server is a compiled binary in resources/ and its
  // assets (ui/dist, public) live alongside it; in dev we run from the repo.
  const prodBinary = app.isPackaged
    ? join(process.resourcesPath, process.platform === 'win32' ? 'mc-server.exe' : 'mc-server')
    : undefined;
  paneManager = new BrowserPaneManager(mainWindow!, { x: 0, y: 0, width: 0, height: 0 });
  control = new DesktopControl(paneManager);
  const { url: controlUrl, token: controlToken } = await control.start();
  supervisor = new ServerSupervisor({
    repoRoot,
    project: repoRoot,
    session: process.env.MC_SESSION ?? 'desktop',
    host: '127.0.0.1',
    cdpPort,
    controlUrl,
    controlToken,
    serverBinaryPath: prodBinary,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  });
  const { port, attached } = await supervisor.start();
  console.log(`[bootstrap] sidecar ${attached ? 'attached' : 'spawned'} on port ${port}; cdp on ${cdpPort}`);
  await fetch(`http://127.0.0.1:${port}/api/browser/electron-target`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cdpPort }) }).catch(() => {});

  // Start the per-server proxy and point it at the local sidecar. The renderer
  // talks only to the proxy (single origin → relative URLs keep working);
  // switching servers later just repoints the proxy upstream.
  proxy = new ServerProxy();
  const { port: proxyPort } = await proxy.start();
  proxy.setUpstream({ host: '127.0.0.1', port }); // local sidecar, no token
  console.log(`[bootstrap] proxy on ${proxyPort} → sidecar ${port}`);

  // Connection store: persisted server list + auto-listed local instances.
  store = new ConnectionStore();
  await store.init();
  await store.refreshLocal();
  registerIpc();
  aggregator = new WatchAggregator((e) => mainWindow?.webContents.send('mc:watch-event', e));

  // Load the real collab UI through the proxy.
  if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${proxyPort}`);

  // Ensure the app's own session tab exists so browser_* tools keep working.
  await paneManager.ensureSessionTab(process.env.MC_SESSION ?? 'desktop');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Auto-update (packaged builds only; inert without a publish feed + signing).
  if (app.isPackaged) {
    import('electron-updater')
      .then(({ autoUpdater }) => autoUpdater.checkForUpdatesAndNotify())
      .catch(() => { /* no update feed / unsigned — ignore */ });
  }
}

// Only the primary instance boots the app and owns the sidecar. A second
// instance has already called app.quit() above; without this guard it would
// still run bootstrap() (appending the CDP switch and spawning a second
// sidecar/window) before the async quit completes.
if (gotLock) {
  void bootstrap();

  app.on('before-quit', () => {
    aggregator?.stop();
    void control?.stop();
    void proxy?.stop();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
