# Wave 2 Implementation

## Tasks
- **desktop-control-server** — NEW `desktop/src/main/desktop-control.ts`: `DesktopControl` class, loopback `http.Server`, `POST /panes/ensure` (Bearer token via randomUUID) → `paneManager.ensureSessionTab(session)`; 401/400/404/500; `start()→{url,token}`, `stop()`. `server-supervisor.ts`: `controlUrl?`/`controlToken?` opts + env injection (`MC_DESKTOP_CONTROL_URL`/`MC_DESKTOP_CONTROL_TOKEN`) after the cdpPort block. `index.ts`: instantiate `BrowserPaneManager`, start `DesktopControl` before supervisor, pass control url/token into supervisor opts, ensure default session tab, 7 new IPC handlers (`mc:browser:*` + `mc:setZoomFactor`), window-close cleanup closes all tabs.
- **terminal-column** — `terminalStore.ts`: multi-tab model `{ open, tabs:[{id,title,tmuxName}], activeTabId }` + `toggle/openDrawer/close/setActive/closeTab/openFor`; `openFor(project,session)` POSTs `/api/terminal/sessions` → pushes tab from `{id,tmuxSession}`. `TerminalDrawer.tsx`: tab strip (per-tab close, `+`=openFor, drawer close), renders `<TerminalPane key={activeTabId} sessionId={activeTabId}/>`, auto-opens a tab on first open. `TerminalPane.tsx`: unchanged (now receives the PTY uuid as sessionId).
- **browser-panel** — NEW `browserStore.ts`: zustand mirror `{visible,tabs,activeId}` + toggle/show/hide/refresh/openUserTab/closeTab/activateTab/navigate/activateSession, all no-op without `window.mc.browser`. NEW `BrowserPanel.tsx`: fixed overlay (top:56,bottom:0), tab strip + address bar + viewport `<div>` with ResizeObserver → `mc.browser.setBounds`; zeroes bounds on hide/unmount. `Header.tsx`: globe Browser toggle button after the Terminal button. `App.tsx`: mounts `<BrowserPanel/>` after `<TerminalDrawer/>`.

## Verification
- desktop tsc (desktop-control.ts, server-supervisor.ts, index.ts, browser-pane.ts): clean.
- ui tsc (terminalStore, TerminalDrawer, browserStore, BrowserPanel, Header, App): clean.
- terminalStore API change: all consumers (Header `.toggle()`, TerminalDrawer new actions, terminal-ws.test.ts `open`/`toggle`) compatible — no breakage.
- Note: App.tsx mount initially failed (parallel race — BrowserPanel.tsx not yet written); re-dispatched after creation → done.

## Wave TSC
Wave-2 files clean across both packages. Remaining repo tsc errors are the pre-existing `../src/agent/__tests__/*` + api.ts:693 noise, unrelated.
