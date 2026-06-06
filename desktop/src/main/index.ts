import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, nativeImage, Menu } from 'electron';
import { ServerSupervisor, getFreePort } from './server-supervisor';
import { BrowserPaneManager } from './browser-pane';
import { DesktopControl } from './desktop-control';
import { ServerProxy } from './server-proxy';
import { ConnectionStore } from './connection-store';
import { WatchAggregator } from './watch-aggregator';
import { enableCdp, publishDiscovery } from 'electron-agent-bridge/electron-main';

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
  ipcMain.handle('mc:addServer', (_e, opts: { label: string; host: string; port: number; token?: string }) =>
    store?.add(opts) ?? null
  );
  ipcMain.handle('mc:removeServer', (_e, id: string) => {
    store?.remove(id);
  });
  ipcMain.handle('mc:browser:listTabs', () => paneManager?.listTabs() ?? []);
  ipcMain.handle('mc:browser:openTab', (_e, opts) => paneManager?.openUserTab(opts ?? {}) ?? null);
  ipcMain.handle('mc:browser:closeTab', (_e, id: string) => { paneManager?.closeTab(id); });
  ipcMain.handle('mc:browser:activateTab', (_e, id: string) => { paneManager?.activateTab(id); });
  ipcMain.handle('mc:browser:navigate', (_e, id: string, url: string) => paneManager?.navigate(id, url));
  ipcMain.handle('mc:browser:goBack', (_e, id: string) => { paneManager?.goBack(id); });
  ipcMain.handle('mc:browser:goForward', (_e, id: string) => { paneManager?.goForward(id); });
  ipcMain.handle('mc:browser:reload', (_e, id: string) => { paneManager?.reload(id); });
  ipcMain.handle('mc:browser:devtools', (_e, id: string) => { paneManager?.toggleDevTools(id); });
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
    pushPeerRegistry();
  });
  // Cross-server session listing: lets the renderer's subscribe modal show
  // sessions from any registered server (not just the active one) without
  // switching active. Returns [] on any error rather than throwing across IPC.
  ipcMain.handle('mc:listSessionsForServer', async (_e, serverId: string) => {
    if (!store) return [];
    const entry = store.get(serverId);
    if (!entry) return [];
    try {
      const headers: Record<string, string> = {};
      if (entry.token) headers['Authorization'] = `Bearer ${entry.token}`;
      const r = await fetch(`http://${entry.host}:${entry.port}/api/sessions`, {
        headers,
        signal: AbortSignal.timeout(1500),
      });
      if (!r.ok) return [];
      const body = await r.json();
      // Server responses vary; if it's an array, return it; else look for .sessions.
      if (Array.isArray(body)) return body;
      if (body && Array.isArray((body as any).sessions)) return (body as any).sessions;
      return [];
    } catch (err) {
      console.warn(`[mc:listSessionsForServer] ${serverId} failed:`, err);
      return [];
    }
  });
  // Per-server invoke: lets the renderer route a row action (terminal,
  // browser-focus, navigate) at the row's serverId instead of the active
  // server's proxy. Tokens stay in main. Returns a structured envelope so the
  // renderer can branch on ok/status without losing the body.
  ipcMain.handle('mc:invokeOnServer', (_e, serverId: string, opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> }) =>
    invokeOnServer(serverId, opts)
  );
  ipcMain.handle('mc:getServerCapabilities', (_e, serverId: string) => store?.getServerCapabilities(serverId) ?? { tmux: false });
  // The loading screen calls this when the user clicks Retry after a failed
  // sidecar startup. Re-runs the bring-up using the opts captured in bootstrap.
  ipcMain.handle('mc:retry-bootstrap', () => { void startServicesGuarded(); });
}

// Per-server invoke (module-scope so main-process logic can call it directly,
// not just over IPC). Tokens stay in main. Returns a structured envelope so
// callers can branch on ok/status without losing the body.
async function invokeOnServer(
  serverId: string,
  opts: { path: string; method?: string; body?: unknown; query?: Record<string, string> },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!store) return { ok: false, status: 0, body: 'no store' };
  // Resolve the sentinel 'local' (and empty/undefined) to the local server
  // entry. Renderer code falls back to 'local' when a session has no serverId
  // (e.g. the supervisor panel's `activeId ?? 'local'`); without this the call
  // returned "unknown server" and the action silently no-op'd.
  let entry = store.get(serverId);
  if (!entry && (!serverId || serverId === 'local')) {
    const localInfo = store.list().find((s) => s.source === 'local');
    if (localInfo) entry = store.get(localInfo.id);
  }
  if (!entry) return { ok: false, status: 0, body: 'unknown server' };
  try {
    const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (entry.token) headers['Authorization'] = `Bearer ${entry.token}`;
    const r = await fetch(`http://${entry.host}:${entry.port}${opts.path}${qs}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    if (opts.path === '/api/ide/create-terminal' && r.ok && parsed && typeof parsed === 'object' && 'tmux' in (parsed as Record<string, unknown>)) {
      store.setServerCapabilities(serverId, { tmux: Boolean((parsed as { tmux?: unknown }).tmux) });
    }
    return { ok: r.ok, status: r.status, body: parsed };
  } catch (err) {
    console.warn(`[mc:invokeOnServer] ${serverId} ${opts.path} failed:`, err);
    return { ok: false, status: 0, body: String(err) };
  }
}

// Push the current server roster (with tokens) to all open upstream WS so each
// collab server can reach its peers directly. Re-pushed on each fresh connect
// (aggregator onOpen) and after the watched set or local roster changes.
function pushPeerRegistry(): void {
  if (!store || !aggregator) return;
  const peers = store.list()
    .map((s) => store!.get(s.id))
    .filter(Boolean)
    .map((e: any) => ({ serverId: e.id, baseUrl: `http://${e.host}:${e.port}`, token: e.token }));
  aggregator.broadcast({ type: 'peer_registry', peers });
}

// --- Cross-machine supervisor notify (REMOTE-ONLY) ---------------------------
// The collab server already nudges its supervisor for same-host sessions; here
// we only handle REMOTE servers so we don't double-notify. We resolve the local
// "home" server (the one whose supervisor identity is set) and, when a remote
// session it supervises flips to waiting/permission, send a reconcile nudge.
const supTransition = new Map<string, string>();           // `${serverId} ${project} ${session}` -> last status
let homeCache: { homeServerId: string; identity: any } | null = null;
let homeCacheAt = 0;
async function resolveHome(): Promise<{ homeServerId: string; identity: any } | null> {
  if (homeCache && Date.now() - homeCacheAt < 10000) return homeCache;
  if (!store) return null;
  for (const s of store.list()) {
    try {
      const r = await invokeOnServer(s.id, { path: '/api/supervisor/identity' });
      if (r.ok && r.body && (r.body as any).project && (r.body as any).session) {
        homeCache = { homeServerId: s.id, identity: r.body };
        homeCacheAt = Date.now();
        return homeCache;
      }
    } catch { /* ignore */ }
  }
  homeCache = null; homeCacheAt = Date.now(); return null;
}
let supervisedCache: Set<string> = new Set();              // `${project} ${session}`
let supervisedAt = 0;
async function isSupervisedOnHome(homeServerId: string, project: string, session: string): Promise<boolean> {
  if (Date.now() - supervisedAt > 10000) {
    try {
      const r = await invokeOnServer(homeServerId, { path: '/api/supervisor/supervised' });
      if (r.ok && Array.isArray((r.body as any)?.supervised)) {
        supervisedCache = new Set((r.body as any).supervised.map((x: any) => `${x.project} ${x.session}`));
      }
    } catch { /* keep stale */ }
    supervisedAt = Date.now();
  }
  return supervisedCache.has(`${project} ${session}`);
}
async function onWatchEvent(e: any): Promise<void> {
  mainWindow?.webContents.send('mc:watch-event', e);
  if (e.type !== 'claude_session_status') return;
  const status = e.status as string | undefined;
  const key = `${e.serverId} ${e.project} ${e.session}`;
  const prev = supTransition.get(key);
  if (status) supTransition.set(key, status);             // update gate for ALL statuses
  if (status !== 'waiting' && status !== 'permission') return;
  if (prev === status) return;                            // transition gate
  const home = await resolveHome();
  if (!home) return;
  if (e.serverId === home.homeServerId) return;           // REMOTE-ONLY: same-host handled by server-side push
  if (home.identity.project === e.project && home.identity.session === e.session) return; // not self
  if (!(await isSupervisedOnHome(home.homeServerId, e.project, e.session))) return;
  const base = (e.project || '').split('/').filter(Boolean).pop() || e.project;
  try {
    await invokeOnServer(home.homeServerId, {
      path: '/api/ide/tmux-send-keys',
      method: 'POST',
      body: {
        project: home.identity.project,
        session: home.identity.session,
        text: `[mc-supervisor] ${e.serverId}/${base}/${e.session} → ${status}. Reconcile.`,
      },
    });
  } catch { /* best-effort */ }
}

// Register the mermaid-collab:// deep-link scheme so links from browsers/Slack
// open (or focus) this app at a given project/session.
app.setAsDefaultProtocolClient('mermaid-collab');

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: { project: string; session: string; srv: string | null } | null = null;

/** Parse a mermaid-collab://<project>/<session>?srv=<id> URL. */
function parseDeepLink(url: string): { project: string; session: string; srv: string | null } | null {
  try {
    const u = new URL(url);
    const project = u.hostname;
    const session = u.pathname.replace(/^\//, '');
    const srv = u.searchParams.get('srv');
    console.log(`[deeplink] project=${project} session=${session} srv=${srv}`);
    return { project, session, srv };
  } catch {
    console.warn(`[deeplink] could not parse: ${url}`);
    return null;
  }
}

function dispatchDeepLink(
  parsed: { project: string; session: string; srv: string | null } | null,
  retriesLeft = 60 /* 30s @ 500ms */,
): void {
  if (!parsed) return;
  const srv = parsed.srv ?? (store?.list().find((e) => e.source === 'local')?.id ?? null);
  if (srv == null) {
    if (retriesLeft > 0) {
      setTimeout(() => dispatchDeepLink(parsed, retriesLeft - 1), 500);
    } else {
      console.warn('[deeplink] no server resolved; dropping', parsed);
    }
    return;
  }
  const payload = { srv, project: parsed.project, session: parsed.session };
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('mc:deeplink', payload);
  } else {
    pendingDeepLink = payload;
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
  if (url) dispatchDeepLink(parseDeepLink(url));
  focusMainWindow();
});

// macOS: deep links arrive via open-url, not argv.
app.on('open-url', (event, url) => {
  event.preventDefault();
  dispatchDeepLink(parseDeepLink(url));
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

// Build the application menu. The default Electron menu's zoom items call
// webContents.setZoomFactor() directly, which bypasses the renderer's uiStore
// (so the header's % never updates). We replace the View zoom items with ones
// that send `mc:zoom` to the renderer, making uiStore the single source of
// truth — it applies the zoom AND drives the header. Everything else uses the
// standard role-based submenus.
function setupMenu(): void {
  const isMac = process.platform === 'darwin';
  const sendZoom = (dir: 'in' | 'out' | 'reset') => () => mainWindow?.webContents.send('mc:zoom', dir);
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Actual Size', accelerator: 'CommandOrControl+0', click: sendZoom('reset') },
        { label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: sendZoom('in') },
        // Cmd+= (no shift) is what users actually press for zoom-in; register it
        // as a hidden duplicate so the accelerator fires without a second item.
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: sendZoom('in'), visible: false },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: sendZoom('out') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

  mainWindow.webContents.once('did-finish-load', () => {
    if (pendingDeepLink && mainWindow) {
      mainWindow.webContents.send('mc:deeplink', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  mainWindow.on('closed', () => {
    // Release all browser pane tabs so they don't leak.
    if (paneManager) {
      for (const t of paneManager.listTabs()) paneManager.closeTab(t.id);
      paneManager = null;
    }
    mainWindow = null;
  });
}

// Captured once in bootstrap() so the retryable startServices() (and the
// mc:retry-bootstrap IPC handler) can re-run the sidecar bring-up without
// re-doing the one-time window/control setup.
let serviceOpts: { cdpPort: number; controlUrl: string; controlToken: string } | null = null;

async function bootstrap(): Promise<void> {
  // The CDP switch MUST be set before the app reaches 'ready'. getFreePort is
  // fast, so awaiting it here is safe (spike lesson: a long await before this
  // lets the app become ready first and the switch is ignored).
  // MC_CDP_PORT pins the renderer CDP port for debugging (so tools can attach to
  // a known endpoint); otherwise a free port is chosen. MC_INSPECT exposes the
  // Node main process to the inspector (e.g. MC_INSPECT=9229). Both are opt-in —
  // normal launches are unaffected.
  const cdpPort = await enableCdp(app, { port: process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : undefined });
  if (process.env.MC_INSPECT) app.commandLine.appendSwitch('inspect', process.env.MC_INSPECT);

  await app.whenReady();
  setupMenu();
  createWindow();
  // Register IPC up front (handlers use lazy `store?.`/`paneManager?.` refs, so
  // they're safe before those are assigned) — this also wires mc:retry-bootstrap.
  registerIpc();

  paneManager = new BrowserPaneManager(mainWindow!, { x: 0, y: 0, width: 0, height: 0 });
  control = new DesktopControl(paneManager);
  const { url: controlUrl, token: controlToken } = await control.start();
  serviceOpts = { cdpPort, controlUrl, controlToken };

  await startServicesGuarded();

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

/**
 * Spawn the sidecar, wire the proxy/store/aggregator, and swap the window from
 * the loading screen to the real UI. On failure, surface the reason to the
 * loading screen (mc:bootstrap-error) instead of leaving the window hung — the
 * renderer's Retry button calls back in via mc:retry-bootstrap.
 */
async function startServicesGuarded(): Promise<void> {
  if (!serviceOpts) return;
  try {
    await startServices(serviceOpts);
  } catch (err) {
    const e = err as Error & { detail?: string; logPath?: string };
    console.error('[bootstrap] service startup failed:', err);
    mainWindow?.webContents.send('mc:bootstrap-error', {
      message: e?.message ?? String(err),
      detail: e?.detail,
      logPath: e?.logPath,
    });
  }
}

async function startServices(opts: { cdpPort: number; controlUrl: string; controlToken: string }): Promise<void> {
  const { cdpPort, controlUrl, controlToken } = opts;
  // Spawn (or attach to) the Bun sidecar, pointing its browser tools at our
  // own embedded view via CDP_PORT + MC_BROWSER_TARGET (set inside the supervisor).
  const repoRoot = process.env.MC_REPO_ROOT ?? join(app.getAppPath(), '..');
  // In a packaged app the server is a compiled binary in resources/ and its
  // assets (ui/dist, public) live alongside it; in dev we run from the repo.
  const prodBinary = app.isPackaged
    ? join(process.resourcesPath, process.platform === 'win32' ? 'mc-server.exe' : 'mc-server')
    : undefined;
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
    // Tee sidecar stdout/stderr here so a failed Windows/packaged startup is
    // diagnosable; the path is also shown on the error screen.
    logFilePath: join(app.getPath('logs'), 'sidecar.log'),
  });
  const { port, attached } = await supervisor.start();
  console.log(`[bootstrap] sidecar ${attached ? 'attached' : 'spawned'} on port ${port}; cdp on ${cdpPort}`);
  await fetch(`http://127.0.0.1:${port}/api/browser/electron-target`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cdpPort }) }).catch(() => {});
  void publishDiscovery({ appName: 'mermaid-collab', port: cdpPort });

  // Start the per-server proxy pinned to the local sidecar. The renderer talks
  // only to the proxy (single origin → relative URLs keep working). The local
  // upstream is immutable for the lifetime of the app; per-server requests are
  // routed via the resolver below (and `mc:invokeOnServer`) instead.
  proxy = new ServerProxy({ host: '127.0.0.1', port });
  // Fixed preferred port keeps the renderer origin stable across restarts so
  // localStorage-backed prefs (subscriptions, theme, layout) survive. Falls back
  // to a free port only if 9180 is already taken.
  const { port: proxyPort } = await proxy.start(9180);
  console.log(`[bootstrap] proxy on ${proxyPort} → sidecar ${port}`);

  // Connection store: persisted server list + auto-listed local instances.
  store = new ConnectionStore();
  await store.init();
  await store.refreshLocal();
  // Resolver: live lookup keeps tokens in main and lets per-server WS bridges
  // pick the right upstream regardless of which server is "active".
  proxy.setResolver((id) => {
    // Resolve the 'local' SENTINEL (and empty/undefined) to the local server,
    // exactly as invokeOnServer does. Supervised/worker terminal tabs carry
    // serverId='local' (supervisor panel's `activeId ?? 'local'`); without this
    // the per-server terminal WS resolved to null → socket.destroy() → the pane
    // connected nowhere and showed empty, even though the POST that created the
    // tab (via invokeOnServer, which DOES resolve 'local') succeeded.
    let e = store?.get(id);
    if (!e && (!id || id === 'local')) {
      const localInfo = store?.list().find((s) => s.source === 'local');
      if (localInfo) e = store?.get(localInfo.id);
    }
    return e ? { host: e.host, port: e.port, token: e.token } : null;
  });
  aggregator = new WatchAggregator((e) => void onWatchEvent(e), () => pushPeerRegistry());
  // refreshLocal() ran before the aggregator existed; push the initial roster now.
  pushPeerRegistry();

  // Load the real collab UI through the proxy (replaces the loading screen).
  if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${proxyPort}`);

  // NOTE: we intentionally do NOT eagerly create a session tab here. The browser
  // pane should start empty — the user adds tabs themselves. The desktop_* /
  // browser automation provisions its session tab lazily via
  // desktop-control.ensureSessionTab() when it actually needs one.
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
