# Design — Desktop App Feature Epic (browser tabs · tmux terminals · watching-drive · text size)

_Branch target: `feat/native-app-foundation`. Status: design. Source requirements + decisions captured 2026-05-27 in session `local`._

## Context
The native Electron app shell works (Phases 0–8, signed build verified), but several user-facing capabilities are stubbed or single-instance. This epic makes the app genuinely usable as the primary surface:

1. **Multi-tab browser** with a toggle button, wired to the mermaid `browser_*` CDP tools.
2. **Tabbed terminal column** whose tabs attach **tmux** sessions on click (the desktop app becomes the primary tmux host; VSCodium shifts to diff-loading only).
3. **Watching card** that live-updates in the native app, and **click-to-drive**: clicking a watched session focuses/drives its browser + terminal.
4. **Global text-size control.**

### Decisions (locked)
- **Terminal/tmux:** desktop tabs attach **grouped tmux sessions** using the existing shared naming (`tmuxBaseName(project,session)` → `mc-<proj>-<sess>`, grouped `vscode-collab-<base>` pattern). Desktop is now the primary host; VSCodium will only load diffs, not hold sessions.
- **Browser tabs:** **dedicated session tab** — each collab session always drives its own tab; user-opened tabs are a separate, coexisting set in the same tab strip.
- **Driving:** (a) ensure Watching live-updates work in-app; (b) clicking a watched session drives its browser tab + terminal. (NOT auto-subscribe; NOT pane-only.)
- **Build:** design → `/vibe-blueprint` → `/vibe-go` waves.

---

## Current state (grounded in code)

| Area | Today | Key files |
|------|-------|-----------|
| Browser pane | ONE `WebContentsView` at 0×0, never shown; marker `mc-browser-pane`; registry `session→targetId` (1:1); electron-view picks the single marker | `desktop/src/main/browser-pane.ts`, `src/services/cdp-session.ts:12,21,29-39,180-256`, `src/mcp/tools/browser.ts` |
| Renderer↔main IPC | `window.mc` exposes server-switch only; NO browser/pane methods | `desktop/src/preload/index.ts:6-13`, `desktop/src/main/index.ts:21-38` |
| Terminal | Single bottom drawer, **raw shell** PTY; WS `/terminal/:id` JSON protocol; multi-client per id already supported | `ui/src/components/terminal/*`, `ui/src/stores/terminalStore.ts`, `src/terminal/PTYManager.ts`, `src/routes/websocket.ts` |
| tmux (server) | **Already wired**: `tmuxBaseName()`, `/api/ide/create-terminal` (detached create + broadcast), `/api/ide/tmux-sessions` | `src/services/tmux-naming.ts`, `src/routes/ide-routes.ts:56-118` |
| tmux (VSCodium) | Attaches grouped session `vscode-collab-<base>` via `tmux has-session || new-session -d -t <base>) && attach` | `extensions/vscode/src/extension.ts:255-295` |
| Watching card | `SubscriptionsPanel`, backed by `subscriptionStore` (localStorage); live status via WS `claude_session_*` → `App.tsx` handler → `updateStatus()` | `ui/src/components/layout/SubscriptionsPanel.tsx:370`, `ui/src/stores/subscriptionStore.ts`, `ui/src/App.tsx:915-929`, `src/websocket/handler.ts:55-57` |
| Text size | `uiStore.zoomLevel` (25–1000, persisted) exists but is **only displayed**, never applied; theme system (light/dark/sepia) applied via `<html>` class | `ui/src/stores/uiStore.ts:68-87,102-277`, `ui/src/index.css`, `ui/src/App.tsx:154-166` |

**Cross-cutting:** Watching updates + browser driving both ride the **main-process WS proxy** (`desktop/src/main/server-proxy.ts`) — dead in the packaged app until the recent `bufferUtil` fix (`764015f`). So part of feature 3 is verify-it-now-works + harden.

---

## Target architecture

### Feature A — Multi-tab browser (dedicated session tab)
**Main process — `BrowserPaneManager`** (replaces the single `createBrowserPane`):
- Manages N `WebContentsView`s. Exactly one is "active" (bounds = the renderer's reserved rect); the rest are parked at 0×0.
- Two tab kinds: **session tabs** (one per collab session, marker title `mc-browser-pane:<session>`) and **user tabs** (marker `mc-browser-pane:user:<uuid>`).
- API (via IPC): `listTabs()`, `openTab({url, session?})`, `closeTab(id)`, `activateTab(id)`, `navigate(id,url)`, `setBounds(rect)`.
- The active view is overlaid on a renderer-reserved rectangle: the React browser panel renders an empty container, measures it (ResizeObserver), and pushes bounds to main via `window.mc.browser.setBounds`. Main repositions the active view. (WebContentsView is a native overlay, not in the DOM.)

**CDP selection — `src/services/cdp-session.ts`:**
- `selectElectronViewTarget(tabs, session)` matches the marker for the **requesting session** (`mc-browser-pane:<session>`), not a generic marker. `browser_*` tools already pass `session` → the dedicated tab is selected deterministically.
- `ensureTab` in electron-view mode: if no session tab exists yet, request main to create one (new IPC: server→main is awkward; simpler — the desktop pre-creates a session tab for the app's own session, and additional sessions' tabs are created lazily by a tiny HTTP hook the main proxy injects, OR the tools' first `browser_open` triggers tab creation via a new `/api/browser/ensure-pane` that the main process listens for). **Open detail to resolve in blueprint:** the server (sidecar) and main are separate processes; tab creation lives in main, but `browser_*` runs in the sidecar. Cleanest: main exposes a tiny local control endpoint (or reuses the existing proxy control channel) that the sidecar calls to ensure a session's WebContentsView exists before CDP selection.

**Preload — `desktop/src/preload/index.ts`:** add `mc.browser.*` bridge.

**UI:** Browser toggle button (header) → browser panel with tab strip (session tabs badged with the session name + user tabs) + address bar + the native-view container. New `browserStore` (active tab, visible, tabs list mirrored from main via IPC events).

### Feature B — Tabbed terminal column (tmux)
**Server — `PTYManager`:** add a tmux mode. When a terminal id is a tmux session name (or `create({tmux:{base,grouped}})`), spawn the grouped-attach command mirroring the VSCodium extension:
`sh -c "(tmux has-session -t <grouped> 2>/dev/null || tmux new-session -d -s <grouped> -t <base>) && tmux attach -t <grouped>"` (create `<base>` first if missing). Otherwise keep the raw-shell path. Reuse `tmuxBaseName(project, session)` for `<base>`.

**WS routing — `src/routes/websocket.ts`:** `/terminal/:id` where `id` encodes the tmux target; `handleTerminalOpen` passes tmux opts to `PTYManager`.

**UI:** `TerminalColumn` (replaces/extends `TerminalDrawer`) — a tab strip + active `TerminalPane` (xterm logic unchanged). `terminalStore` grows to `{ tabs: [{id, title, tmuxName}], activeTabId, open }`. First tab for a session = `tmuxBaseName(project,session)`; "+" adds `<base>-2`, `-3`, …. Clicking a tab connects its WS.

### Feature C — Watching live-update + click-to-drive
- **Verify + harden** that `claude_session_registered|status|context_update` broadcasts reach the native app over the (now-fixed) proxy and update `subscriptionStore`. Add a regression guard if a gap is found.
- **Click-to-drive:** `SubscriptionsPanel` row onClick → resolve `{project, session}` → (a) `browserStore.activateSession(session)` (IPC → main activates that session's `mc-browser-pane:<session>` view, opening the panel), and (b) `terminalStore.openFor(project, session)` (opens/activates the tmux tab for `tmuxBaseName(project,session)`). One click surfaces both that session's browser and terminal.

### Feature D — Global text size
- Apply `uiStore.zoomLevel` globally: bind it to a root scale — `document.documentElement.style.fontSize = (16 * zoomLevel/100)+'px'` (rem-based UI scales), via a `useEffect` in `App.tsx`. In desktop, also call `webContents.setZoomFactor(zoomLevel/100)` (IPC) so native panes scale too.
- Header control: − / % / + (reuse `zoomIn`/`zoomOut`/`setZoomLevel`). Works in web + desktop.

---

## Proposed waves (for blueprint)
- **W1 (parallel foundations):**
  - `text-size` (D) — bind zoomLevel → root font-size + header control (+ desktop setZoomFactor). _Independent, smallest._
  - `pty-tmux` (B-server) — PTYManager tmux-attach mode + WS opts. _Independent server._
  - `browser-pane-manager` (A-main) — N-view manager + IPC + preload bridge + per-session markers.
- **W2:**
  - `terminal-column` (B-ui) — tabbed column + multi-session `terminalStore` (←pty-tmux).
  - `cdp-session-select` (A-cdp) — per-session marker selection + lazy pane-ensure channel (←browser-pane-manager).
  - `browser-panel` (A-ui) — toggle + tab strip + bounds-overlay + `browserStore` (←browser-pane-manager).
- **W3:**
  - `watching-drive` (C) — verify/harden live updates + click-to-drive wiring (←terminal-column, browser-panel).

## RESOLVED — main↔sidecar pane-ensure channel (A)
**Decision: a dedicated, token-guarded HTTP control server in the Electron main process; the sidecar calls it synchronously to ensure a session's pane exists before CDP selection.**

Rejected alternatives: CDP can't create native `WebContentsView`s (Electron isn't a full browser — no browser-level `Target.createTarget` for views; CDP only *attaches*). Renderer-as-intermediary (sidecar→WS→renderer→IPC→main) is racy + needs the renderer alive. Reusing the proxy port muddies concerns.

Wiring:
1. **Main** starts `DesktopControl` (`http.Server` on `127.0.0.1:<free port>`) **before** `supervisor.start()`. Endpoint `POST /panes/ensure { session }` (Bearer token) → idempotent `BrowserPaneManager.ensureSessionTab(session)`: create `WebContentsView` titled `mc-browser-pane:<session>` if absent, load marker page, await `dom-ready`, confirm target in CDP `/json/list`, return `{ ok }`.
2. **Supervisor** (extend electron-view block at `server-supervisor.ts:111-114`): inject `MC_DESKTOP_CONTROL_URL` + `MC_DESKTOP_CONTROL_TOKEN` (from `ServerSupervisor` opts set in `index.ts`).
3. **Sidecar** (`cdp-session.ts` `ensureTab`, electron-view branch): if control URL set, `await fetch(POST /panes/ensure {session})` before `CDP.List`, then select.
4. **`selectElectronViewTarget(tabs, session?)`**: match `mc-browser-pane:<session>`; fall back to bare `mc-browser-pane` (back-compat). User tabs = `mc-browser-pane:user:<uuid>`, never tool-selected.
5. **Gating:** only when `MC_BROWSER_TARGET==='electron-view'` AND control URL present → `owned-chrome`/remote paths unaffected.

Ownership: **main owns view lifecycle; sidecar just requests then drives over CDP.** The same `BrowserPaneManager` also serves renderer actions (user tabs, click-to-drive) via IPC — two callers, one idempotent manager. Security: loopback + ephemeral port + shared token.

This collapses the W2 `cdp-session-select` task into: per-session marker + control-call in `ensureTab`. A new W1 task `desktop-control-server` (main `DesktopControl` + supervisor env) gates it.

## Key risks / open details
- **Native overlay layout (A):** `WebContentsView` sits above the DOM; bounds must track the reserved rect on resize/scroll/panel-toggle, and hide when the panel is closed. Z-order vs other overlays (terminal drawer) must be managed.
- **tmux lifecycle (B):** grouped sessions persist after detach (desired). Need cleanup/listing UX (reuse `/api/ide/tmux-sessions`).
- **Diagram render endpoint** is currently erroring server-side (`DOMPurify.addHook`) — diagrams omitted from this doc; fix separately if we want visuals.

## Verification
- A: launch via `scripts/debug-app.sh`; open 2 user tabs + drive one session's tab via `bun scripts/app-debug.ts` / `browser_*`; confirm dedicated-tab selection + overlay tracks layout.
- B: open terminal column, click a tab → attach tmux; verify the SAME session is visible from `tmux attach -t mc-<proj>-<sess>` in a real terminal; multi-tab + persistence across reconnect.
- C: two sessions; confirm Watching live status + context update in-app; click a watched row → its browser + terminal surface.
- D: change text size → whole UI scales (web + desktop), persists across relaunch.
