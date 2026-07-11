# Blueprint: Desktop Feature Epic — browser tabs · tmux terminals · watching-drive · text size

## Source Artifacts
- `design-desktop-features` (architecture + locked decisions + resolved main↔sidecar pane-ensure channel)

## 1. Structure Summary

### Files
- [ ] `ui/src/App.tsx` — apply `uiStore.zoomLevel` as a global root font-size scale (effect); wire header zoom control; SubscriptionsPanel click-to-drive callback (W3).
- [ ] `ui/src/components/layout/Header.tsx` — text-size control (− / % / +) bound to `zoomIn/zoomOut/setZoomLevel`; browser toggle button.
- [ ] `src/terminal/PTYManager.ts` — tmux-attach spawn mode (grouped-session command) alongside the raw-shell path.
- [ ] `src/routes/websocket.ts` — pass tmux opts from `/terminal/:id` upgrade into `PTYManager`.
- [ ] `desktop/src/main/browser-pane.ts` — `BrowserPaneManager` (N `WebContentsView`s, per-session + user markers, active-bounds, lifecycle).
- [ ] `desktop/src/preload/index.ts` — `mc.browser.*` bridge (listTabs/openTab/closeTab/activateTab/navigate/setBounds) + `mc.setZoomFactor`.
- [ ] `desktop/src/main/index.ts` — register browser IPC handlers; start `DesktopControl` before `supervisor.start()`; pass control url/token into supervisor opts; zoom IPC.
- [ ] `desktop/src/main/desktop-control.ts` — NEW token-guarded loopback `http.Server`; `POST /panes/ensure`.
- [ ] `desktop/src/main/server-supervisor.ts` — inject `MC_DESKTOP_CONTROL_URL` + `MC_DESKTOP_CONTROL_TOKEN` in the electron-view env block.
- [ ] `src/services/cdp-session.ts` — `selectElectronViewTarget(tabs, session?)` per-session marker; `ensureTab` calls control endpoint before listing.
- [ ] `ui/src/stores/terminalStore.ts` — multi-tab model `{ tabs:[{id,title,tmuxName}], activeTabId, open }` + `openFor(project,session)`.
- [ ] `ui/src/components/terminal/TerminalDrawer.tsx` / `TerminalPane.tsx` — tabbed column; active-tab WS connect.
- [ ] `ui/src/stores/browserStore.ts` — NEW renderer mirror of pane state (tabs, activeId, visible) + `activateSession(session)`.
- [ ] `ui/src/components/browser/BrowserPanel.tsx` — NEW tab strip + address bar + native-view bounds container (ResizeObserver → `setBounds`).
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — row onClick → drive (browser + terminal).

### Type Definitions
- `BrowserTab { id: string; kind: 'session'|'user'; session?: string; url: string; title: string }`
- `PaneRect { x:number; y:number; width:number; height:number }`
- `TerminalTab { id: string; title: string; tmuxName: string }`
- PTY tmux opts: `create(id, { tmux?: { base: string; grouped: string } })`

### Component Interactions
- Sidecar `browser_*` → (electron-view) `ensureTab` → `POST control/panes/ensure` → main `BrowserPaneManager.ensureSessionTab` → CDP target `mc-browser-pane:<session>` selected → drive.
- Renderer `BrowserPanel` → `window.mc.browser.*` (IPC) → `BrowserPaneManager`; ResizeObserver pushes `setBounds`.
- `TerminalColumn` tab → WS `/terminal/<tmuxName>` → `PTYManager` `tmux attach` (grouped) → xterm.
- `SubscriptionsPanel` row click → `browserStore.activateSession(session)` + `terminalStore.openFor(project,session)`.

---

## 2. Function Blueprints

### `BrowserPaneManager.ensureSessionTab(session: string): Promise<{ id: string }>`
**Pseudocode:** 1. if a tab with `kind:'session', session` exists → return it. 2. create `WebContentsView`, set `webContents` title via loaded marker page `mc-browser-pane:<session>`. 3. add as child view, park at 0×0. 4. await `dom-ready`. 5. record in `tabs`. 6. return id.
**Error handling:** reject if window destroyed. **Edge:** idempotent under concurrent calls (in-flight map keyed by session). **Tests:** ensure twice → one view; marker title correct.

### `BrowserPaneManager.activateTab(id) / setBounds(rect)`
**Pseudocode:** activate → park all views at 0×0 except `id`, set its bounds to last `rect`, raise z-order; setBounds → store rect, apply to active view. **Edge:** activate unknown id → no-op; setBounds before any active → store only. **Tests:** only one view non-zero bounds at a time.

### `DesktopControl` — `POST /panes/ensure { session }`
**Pseudocode:** 1. check `Authorization: Bearer <token>`; 401 otherwise. 2. parse `{session}`. 3. `await paneManager.ensureSessionTab(session)`. 4. 200 `{ok:true}`. **Error handling:** 400 on bad body; 500 on manager throw. **Edge:** loopback bind only. **Tests:** wrong token→401; ensure called with session.

### `selectElectronViewTarget(tabs, session?): string`
**Pseudocode:** if `session` → find `type==='page' && title===`mc-browser-pane:<session>``; else/ fallback → bare `mc-browser-pane` (title or url-includes). throw if none. **Tests:** picks session tab among multiple; falls back to bare marker; ignores `:user:` tabs.

### `cdp-session.ensureTab(session)` (electron-view branch)
**Pseudocode:** if `MC_BROWSER_TARGET==='electron-view'` && `MC_DESKTOP_CONTROL_URL`: `await fetch(url+'/panes/ensure', {POST, bearer token, body:{session}})`; then `CDP.List` → `selectElectronViewTarget(list, session)` → register. **Error:** surface control-call failure with actionable message. **Tests:** mock fetch + List; selects per-session target.

### `PTYManager.create(id, opts)` tmux mode
**Pseudocode:** if `opts.tmux`: `cmd = sh -c "(tmux has-session -t G 2>/dev/null || tmux new-session -d -s G -t B) && tmux attach -t G"` with `B=opts.tmux.base, G=opts.tmux.grouped`; spawn via Bun PTY. else raw shell (unchanged). **Edge:** tmux missing → error surfaced to WS. **Tests:** command string for given base/grouped; raw path untouched.

### `terminalStore` multi-tab + `openFor(project, session)`
**Pseudocode:** `openFor` → `base = tmuxBaseName(project,session)`; if tab with that tmuxName exists → activate; else push `{id, title:session, tmuxName:base}` + activate + open drawer. **Tests:** dedup by tmuxName; activeTabId set.

### text-size apply (App.tsx effect)
**Pseudocode:** `useEffect([zoomLevel])` → `document.documentElement.style.fontSize = (16*zoomLevel/100)+'px'`; if `window.mc?.setZoomFactor` → call `(zoomLevel/100)`. **Tests:** store test that zoom mutators clamp 25–1000 (existing) + effect sets fontSize.

### SubscriptionsPanel row onClick drive (W3)
**Pseudocode:** `onClick(sub)` → `browserStore.activateSession(sub.session)` (IPC ensure+activate session tab, show panel) + `terminalStore.openFor(sub.project, sub.session)`. **Edge:** non-desktop (no `window.mc`) → terminal only. **Tests:** click calls both drivers with correct args.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: text-size
    files: [ui/src/App.tsx, ui/src/components/layout/Header.tsx]
    tests: [ui/src/stores/__tests__/uiStore.zoom.test.ts]
    description: "Apply uiStore.zoomLevel as a global root font-size scale + header text-size control; desktop setZoomFactor via IPC."
    parallel: true
    depends-on: []
  - id: pty-tmux
    files: [src/terminal/PTYManager.ts, src/routes/websocket.ts]
    tests: [src/terminal/__tests__/PTYManager.tmux.test.ts]
    description: "PTYManager tmux-attach spawn mode (grouped session, mirrors VSCodium) + WS opts plumbing."
    parallel: true
    depends-on: []
  - id: browser-pane-manager
    files: [desktop/src/main/browser-pane.ts, desktop/src/preload/index.ts]
    tests: [desktop/src/main/__tests__/browser-pane.test.ts]
    description: "BrowserPaneManager: N WebContentsViews, per-session/user markers, active-bounds, lifecycle + preload mc.browser bridge."
    parallel: true
    depends-on: []
  - id: desktop-control-server
    files: [desktop/src/main/desktop-control.ts, desktop/src/main/server-supervisor.ts, desktop/src/main/index.ts]
    tests: [desktop/src/main/__tests__/desktop-control.test.ts]
    description: "Token-guarded loopback control server (POST /panes/ensure → ensureSessionTab); supervisor env injection; start before supervisor; register browser IPC."
    parallel: false
    depends-on: [browser-pane-manager]
  - id: terminal-column
    files: [ui/src/stores/terminalStore.ts, ui/src/components/terminal/TerminalDrawer.tsx, ui/src/components/terminal/TerminalPane.tsx]
    tests: [ui/src/stores/__tests__/terminalStore.test.ts]
    description: "Tabbed terminal column + multi-tab store + openFor(project,session) mapping to tmux base name."
    parallel: false
    depends-on: [pty-tmux]
  - id: browser-panel
    files: [ui/src/stores/browserStore.ts, ui/src/components/browser/BrowserPanel.tsx]
    tests: [ui/src/stores/__tests__/browserStore.test.ts]
    description: "Browser panel: tab strip + address bar + native-view bounds container (ResizeObserver→setBounds); browserStore mirror + activateSession."
    parallel: false
    depends-on: [browser-pane-manager]
  - id: cdp-session-select
    files: [src/services/cdp-session.ts]
    tests: [src/services/__tests__/cdp-session.target.test.ts]
    description: "Per-session marker selection (selectElectronViewTarget(tabs,session)) + ensureTab control-endpoint call before listing; gated by electron-view + control url."
    parallel: false
    depends-on: [desktop-control-server]
  - id: watching-drive
    files: [ui/src/components/layout/SubscriptionsPanel.tsx, ui/src/App.tsx]
    tests: [ui/src/components/layout/__tests__/SubscriptionsPanel.drive.test.ts]
    description: "Verify/harden live Watching updates over the (fixed) WS proxy; row click drives the session's browser tab + terminal."
    parallel: false
    depends-on: [terminal-column, browser-panel]
```

### Execution Waves

**Wave 1 (parallel):**
- text-size, pty-tmux, browser-pane-manager

**Wave 2 (depends on Wave 1):**
- desktop-control-server (←browser-pane-manager), terminal-column (←pty-tmux), browser-panel (←browser-pane-manager)

**Wave 3 (depends on Wave 2):**
- cdp-session-select (←desktop-control-server), watching-drive (←terminal-column, browser-panel)

### Summary
- Total tasks: 8
- Total waves: 3
- Max parallelism: 3
