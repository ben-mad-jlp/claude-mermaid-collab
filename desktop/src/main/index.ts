import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { ServerSupervisor, getFreePort } from './server-supervisor';
import { createBrowserPane, type BrowserPane } from './browser-pane';

// Phase 0.1 — Electron shell skeleton.
// Single-instance lock so a second launch focuses the first window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let supervisor: ServerSupervisor | null = null;
let browserPane: BrowserPane | null = null;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
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
    // Release the embedded pane's WebContentsView so it doesn't leak.
    if (browserPane) {
      browserPane.view.webContents.close();
      browserPane = null;
    }
    mainWindow = null;
  });
}

async function bootstrap(): Promise<void> {
  // The CDP switch MUST be set before the app reaches 'ready'. getFreePort is
  // fast, so awaiting it here is safe (spike lesson: a long await before this
  // lets the app become ready first and the switch is ignored).
  const cdpPort = await getFreePort();
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

  await app.whenReady();
  createWindow();

  // Spawn (or attach to) the Bun sidecar, pointing its browser tools at our
  // own embedded view via CDP_PORT + MC_BROWSER_TARGET (set inside the supervisor).
  const repoRoot = process.env.MC_REPO_ROOT ?? join(app.getAppPath(), '..');
  supervisor = new ServerSupervisor({
    repoRoot,
    project: repoRoot,
    session: process.env.MC_SESSION ?? 'desktop',
    host: '127.0.0.1',
    cdpPort,
  });
  const { port, attached } = await supervisor.start();
  console.log(`[bootstrap] sidecar ${attached ? 'attached' : 'spawned'} on port ${port}; cdp on ${cdpPort}`);

  // Load the real collab UI from the sidecar.
  if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Create the controlled browser pane. Zero bounds for now — the renderer
  // lays it out via IPC in a later phase; the marker page is still discoverable
  // by the browser_* tools regardless of size.
  if (mainWindow) {
    browserPane = createBrowserPane(mainWindow, { x: 0, y: 0, width: 0, height: 0 });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// Only the primary instance boots the app and owns the sidecar. A second
// instance has already called app.quit() above; without this guard it would
// still run bootstrap() (appending the CDP switch and spawning a second
// sidecar/window) before the async quit completes.
if (gotLock) {
  void bootstrap();

  app.on('before-quit', () => {
    void supervisor?.stop();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
