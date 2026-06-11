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

  /**
   * @param onSessionEnsured fired whenever a session pane is ensured (by the
   *   browser_* tools via desktop-control /panes/ensure). The renderer uses it to
   *   auto-open + focus the built-in browser panel on that session's pane, so a
   *   tool-driven page actually shows in the UI instead of a hidden 0×0 view.
   */
  constructor(
    private win: BrowserWindow,
    private activeBounds: Rect,
    private onSessionEnsured?: (session: string) => void,
  ) {}

  async ensureSessionTab(session: string): Promise<{ id: string }> {
    const existing = this.sessionIndex.get(session);
    if (existing) {
      // Already exists — still raise + surface it so a follow-up tool call (click,
      // navigate, screenshot) re-focuses the built-in browser on this session.
      this.focusSession(existing, session);
      return { id: existing };
    }
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
        this.focusSession(id, session);
        return { id };
      } finally {
        this.inFlight.delete(session);
      }
    })();

    this.inFlight.set(session, promise);
    return promise;
  }

  /** Raise the session's native view AND tell the renderer to open + focus the
   *  built-in browser panel on it (so tool-driven browsing is visible). */
  private focusSession(id: string, session: string): void {
    this.activateTab(id);
    this.onSessionEnsured?.(session);
  }

  openUserTab(opts: { url?: string }): { id: string } {
    const id = randomUUID();
    const marker = `mc-browser-pane:user:${id}`;
    const view = new WebContentsView();
    this.win.contentView.addChildView(view);
    view.setBounds(this.zeroRect);
    // A new user tab opens blank — no marker placeholder page (that text only
    // exists to tag automation/session views by title; user tabs aren't targets).
    void view.webContents.loadURL(opts.url ?? 'about:blank');
    this.tabs.set(id, { id, kind: 'user', view, marker });
    return { id };
  }

  closeTab(id: string): void {
    const tab = this.tabs.get(id);
    if (!tab) return;
    // The window may already be torn down when this fires from the BrowserWindow
    // `closed` handler — accessing `contentView` then throws "Object has been
    // destroyed". Skip the detach; the view is being released with the window
    // anyway. Always keep the internal book-keeping in sync.
    if (!this.win.isDestroyed()) {
      this.win.contentView.removeChildView(tab.view);
    }
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

  /** Per-pane page zoom — INDEPENDENT of the app/renderer zoom (which scales the
   *  whole React chrome). Sets the WebContentsView's own zoom factor so the user
   *  can size the embedded page without shrinking the rest of the app. Clamped to
   *  a sane range; returns the applied factor so the renderer reflects the truth. */
  setZoom(id: string, factor: number): number {
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) return 1;
    const clamped = Math.max(0.25, Math.min(5, factor));
    wc.setZoomFactor(clamped);
    return clamped;
  }

  /** The pane's current zoom factor (1 when the tab is gone). */
  getZoom(id: string): number {
    const wc = this.tabs.get(id)?.view.webContents;
    return wc ? wc.getZoomFactor() : 1;
  }

  // Open/close Chrome DevTools for a tab's web contents. A WebContentsView can't
  // dock DevTools inside the app window, so this opens the standard detached
  // DevTools window for the page the user is inspecting.
  toggleDevTools(id: string): void {
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: 'detach' });
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
