import { BrowserWindow, WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';

// Phase 2.3 — the embedded controlled browser pane.
// The pane is a WebContentsView whose initial page carries the marker title so
// the server's browser_* tools (running in the sidecar with
// MC_BROWSER_TARGET=electron-view) can find and register it via CDP.List. After
// browser_open registers the target id, later navigations keep that id, so the
// marker only needs to match at registration time.
//
// Must match ELECTRON_VIEW_MARKER in src/services/cdp-session.ts.
export const ELECTRON_VIEW_MARKER = 'mc-browser-pane';

const MARKER_PAGE =
  'data:text/html,' +
  encodeURIComponent(`<title>${ELECTRON_VIEW_MARKER}</title><body style="font:14px system-ui;padding:1rem">browser pane ready</body>`);

export interface BrowserPane {
  view: WebContentsView;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

/**
 * Create the embedded browser pane and attach it to the window.
 * `--remote-debugging-port` must already be set on the app (in main, before
 * `ready`) and passed to the sidecar as CDP_PORT so the tools target this view.
 */
// ── BrowserPaneManager ──────────────────────────────────────────────────────

export type Rect = { x: number; y: number; width: number; height: number };
type TabKind = 'session' | 'user';
interface PaneTab { id: string; kind: TabKind; sessionKey?: string; view: WebContentsView; marker: string; }
export interface TabInfo { id: string; kind: TabKind; session?: string; marker: string; url: string; }

function markerPage(marker: string): string {
  return (
    'data:text/html,' +
    encodeURIComponent(`<title>${marker}</title><body style="font:14px system-ui;padding:1rem">browser pane ready</body>`)
  );
}

export class BrowserPaneManager {
  private tabs = new Map<string, PaneTab>();
  private sessionIndex = new Map<string, string>(); // sessionKey -> tabId
  private inFlight = new Map<string, Promise<{ id: string }>>();
  private activeId: string | null = null;
  private zeroRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private win: BrowserWindow, private activeBounds: Rect) {}

  async ensureSessionTab(session: string): Promise<{ id: string }> {
    const existing = this.sessionIndex.get(session);
    if (existing) return { id: existing };
    const flying = this.inFlight.get(session);
    if (flying) return flying;

    const promise = (async () => {
      try {
        const id = randomUUID();
        const marker = `mc-browser-pane:${session}`;
        const view = new WebContentsView();
        this.win.contentView.addChildView(view);
        view.setBounds(this.zeroRect);
        await view.webContents.loadURL(markerPage(marker));
        this.tabs.set(id, { id, kind: 'session', sessionKey: session, view, marker });
        this.sessionIndex.set(session, id);
        return { id };
      } finally {
        this.inFlight.delete(session);
      }
    })();

    this.inFlight.set(session, promise);
    return promise;
  }

  openUserTab(opts: { url?: string }): { id: string } {
    const id = randomUUID();
    const marker = `mc-browser-pane:user:${id}`;
    const view = new WebContentsView();
    this.win.contentView.addChildView(view);
    view.setBounds(this.zeroRect);
    void view.webContents.loadURL(opts.url ?? markerPage(marker));
    this.tabs.set(id, { id, kind: 'user', view, marker });
    return { id };
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.win.contentView.removeChildView(tab.view);
    this.tabs.delete(id);
    if (tab.sessionKey) this.sessionIndex.delete(tab.sessionKey);
    if (this.activeId === id) this.activeId = null;
  }

  activateTab(id: string): void {
    if (!this.tabs.has(id)) return;
    this.activeId = id;
    // Raise z-order FIRST: re-adding a child view can reset its bounds, so set
    // bounds last to guarantee the active view ends up exactly on activeBounds
    // (otherwise a newly-opened tab can flash/stick at full-window size).
    this.win.contentView.addChildView(this.tabs.get(id)!.view);
    for (const tab of this.tabs.values()) {
      tab.view.setBounds(tab.id === id ? this.activeBounds : this.zeroRect);
    }
  }

  setBounds(rect: Rect): void {
    this.activeBounds = rect;
    if (this.activeId && this.tabs.has(this.activeId)) {
      this.tabs.get(this.activeId)!.view.setBounds(rect);
    }
  }

  async navigate(id: string, url: string): Promise<void> {
    const tab = this.tabs.get(id);
    if (tab) await tab.view.webContents.loadURL(url);
  }

  goBack(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(id: string): void {
    this.tabs.get(id)?.view.webContents.reload();
  }

  listTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map(tab => ({
      id: tab.id,
      kind: tab.kind,
      session: tab.sessionKey,
      marker: tab.marker,
      url: tab.view.webContents.getURL(),
    }));
  }
}

// ── legacy single-pane API (kept for back-compat) ───────────────────────────

export function createBrowserPane(
  win: BrowserWindow,
  initialBounds: { x: number; y: number; width: number; height: number }
): BrowserPane {
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds(initialBounds);
  void view.webContents.loadURL(MARKER_PAGE);

  return {
    view,
    setBounds(bounds) {
      view.setBounds(bounds);
    },
  };
}
