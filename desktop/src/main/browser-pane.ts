import { BrowserWindow, WebContentsView } from 'electron';

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
