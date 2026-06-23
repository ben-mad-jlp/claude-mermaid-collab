# Scope: Streamed Browser Panel (`streamed-panel` mode)

**Status:** Scoping only — no code changes.
**Author:** collab / ui-cleanup session, 2026-06-16
**Problem owner:** locked-down corporate Windows (WSL2 sidecar) where WSL→Windows inbound is firewall-blocked.

---

## 0. TL;DR

Today the *automated browser is displayed* by a native Electron `WebContentsView`
overlaid onto a placeholder `<div>` in the web UI. That native overlay is the **only**
thing that requires the Electron shell — and on locked-down Windows it requires the WSL
sidecar to reach **back** into Windows (CDP port + desktop-control HTTP), which is firewall-blocked.

The fix is to stop *painting* the browser natively and instead **stream it as pixels**:
the sidecar owns a Chrome **inside WSL** (`owned-chrome`, already built), captures it with
**CDP `Page.startScreencast`** (not built), pushes JPEG frames over the **existing UI
WebSocket** (built, but no frame message type), and a **canvas panel** in the web UI renders
the frames and forwards mouse/keyboard as **CDP `Input.dispatch*`** events (input plumbing
partially built). Everything stays Linux-side; the user drives it from plain Chrome on
`localhost`. No Electron, no WSLg, no admin, no boundary crossing.

The `browser_*` MCP tool contracts **do not change** — they already talk to "whatever CDP
target this session resolves to." We add a fourth `MC_BROWSER_TARGET` mode and a UI panel;
the automation layer is untouched.

---

## 1. Current state — how the embedded browser pane works today

### 1.1 The automation pipeline (mode-agnostic)

```
browser_* MCP tool                 src/mcp/tools/browser.ts
  → withCDPSession(session, CDP_PORT, fn)   src/services/cdp-session.ts:128
      → ensureTab() resolves a CDP targetId  src/services/cdp-session.ts:250
      → CDP({host:'127.0.0.1', port, target}) connects (chrome-remote-interface)
  → fn(client) runs Page.* / Runtime.* / Input.* commands
```

- Tools are defined in `src/mcp/tools/browser.ts` and dispatched from
  `src/mcp/setup.ts:4413-4625`.
- CDP client library: **`chrome-remote-interface`**, statically imported at
  `src/services/cdp-session.ts:10` (static so `bun build --compile` bundles it into the
  sidecar binary).
- The connection is **always** `127.0.0.1:CDP_PORT` (default `9333`,
  `src/config.ts:146-149`). What differs per mode is *which Chrome* is on that port and
  *which target* `ensureTab` selects.

### 1.2 The three modes (`MC_BROWSER_TARGET`, `src/config.ts:160-165`)

| Mode | Chrome on `127.0.0.1:CDP_PORT` | Target selection | Lifecycle owner |
|---|---|---|---|
| `streamed-panel` (default) | Chrome the **server spawns** (headless on Linux), frames streamed to the UI via `ScreencastService` | `ensureTab` creates `about:blank` tab (`cdp-session.ts:206-242`) | `ChromeManager` |
| `owned-chrome` | Chrome the **server spawns** (`src/services/chrome-manager.ts:114-127`), no streaming | same as default | `ChromeManager` |
| `electron-view` | the Electron app's embedded `WebContentsView` | marker match on title `mc-browser-pane[:session]` (`cdp-session.ts:31,39-65,254-280`) | Electron main |

### 1.3 The display path — where Electron is coupled (the seam)

This is the part that matters. In `electron-view` mode, *display* is a native overlay,
**not** a render of CDP output:

1. **Native surface:** `desktop/src/main/browser-pane.ts:62` — `new WebContentsView()`,
   one per tab, added to the Electron `BrowserWindow`. It paints **above** the React DOM
   (zero-copy, full fidelity).
2. **Marker:** each view loads a `data:` page whose `<title>` is `mc-browser-pane:<session>`
   (`browser-pane.ts:21-26,60-66`) so the sidecar's `selectElectronViewTarget`
   (`cdp-session.ts:39-65`) can find it over CDP.
3. **Positioning:** the React panel `ui/src/components/browser/BrowserPanel.tsx` renders a
   placeholder `<div ref={viewportRef} className="flex-1" />` (line 261). A **rAF loop**
   (lines 68-98) reads `getBoundingClientRect()` and calls `bridge().setBounds(rect)` on
   every change (line 91).
4. **IPC:** `setBounds` → preload (`desktop/src/preload/index.ts:59-60`) →
   `ipcMain.handle('mc:browser:setBounds', …)` (`desktop/src/main/index.ts:54`) →
   `paneManager.setBounds()` (`browser-pane.ts:126-131`) → `view.setBounds()`
   (`browser-pane.ts:122`).
5. **Reach-back trigger:** when a tool runs, the sidecar POSTs `/panes/ensure` to the
   **desktop-control HTTP server** (`desktop/src/main/desktop-control.ts:23-64`, bound to
   `127.0.0.1` on a random free port, bearer-token auth) to make the pane exist
   (`cdp-session.ts:256-266`). The control URL/token are handed to the sidecar as
   `MC_DESKTOP_CONTROL_URL` / `MC_DESKTOP_CONTROL_TOKEN` (`desktop/src/main/index.ts:498-500`,
   `server-supervisor.ts:397-398`). The sidecar also learns the Electron CDP port via
   `POST /api/browser/electron-target` (`src/routes/browser-routes.ts:41-48` →
   `setElectronTarget` → `cdp-session.ts:16,18`).

**The exact seam:** `BrowserPanel.tsx:261` (the placeholder hole) + the rAF `setBounds`
loop (lines 76-91) + `browser-pane.ts:62,122` (the native view). Display = "an OS overlay
positioned over a DOM hole." On WSL/Windows this requires (a) the Electron renderer to host
the hole and (b) the WSL sidecar to reach back over CDP + desktop-control — both blocked.
**Nothing in the automation layer (`browser.ts`, `cdp-session.ts` CDP commands) is coupled
to Electron — only the pixels-to-screen path is.**

---

## 2. Reuse audit — what exists vs. what's missing

| Building block | Status | Evidence |
|---|---|---|
| Own a Chrome in-process (spawn, flags, headless, lifecycle, health-poll) | **EXISTS** | `src/services/chrome-manager.ts:42-66,114-165`; started for `owned-chrome` at `src/server.ts:64-84`, stopped at `:555,568` |
| `--remote-debugging-port`, temp `--user-data-dir`, `--remote-allow-origins=*` | **EXISTS** | `chrome-manager.ts:88-95,119-123` |
| CDP one-shot capture (`Page.captureScreenshot`) | **EXISTS** | `src/mcp/tools/browser.ts:45` — proves we can pull pixels from any target |
| CDP **screencast** (`Page.startScreencast`/`screencastFrame`/`screencastFrameAck`) | **MISSING** | no hits for "screencast"/"startScreencast" anywhere |
| CDP input injection — `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` | **EXISTS (partial)** | mouse: `browser.ts:177,237-239`; key: `browser.ts:163-164,247-248` |
| CDP `Input.dispatchTouchEvent` | **MISSING** | no hits |
| UI↔server WebSocket (server handler, UI client, subscribe protocol) | **EXISTS** | `src/websocket/handler.ts:32-130,166-199,354-374`; `ui/src/lib/websocket.ts:123-415`; `ui/src/hooks/useWebSocket.ts:56-186` |
| A `browser_frame`-style message type / frame broadcast over WS | **MISSING** | no image/frame fields in the `WSMessage` union (`handler.ts:32-130`) |
| UI canvas/img frame renderer | **MISSING** | `ImageViewer.tsx`/`SpritePlayer.tsx` are static, not streamed |
| Multi-tab browser UI chrome (tab strip, address bar, back/fwd/reload/zoom) | **EXISTS** | `ui/src/components/browser/BrowserPanel.tsx` + `ui/src/stores/browserStore.ts` |

**Net:** roughly **60% of the substrate already exists.** The genuinely new work is three
pieces: (1) a screencast capture loop on the server, (2) a frame transport over the existing
WS, (3) a canvas panel + input-forwarding on the UI. `owned-chrome`, the CDP client, the WS
fabric, and most `Input.dispatch*` patterns are reusable as-is.

---

## 3. Design — the `streamed-panel` mode

### 3.1 Mode selection

Add a fourth value to `MC_BROWSER_TARGET`: **`streamed-panel`**. It is `owned-chrome` **plus**
a capture/stream service. Concretely it reuses `ChromeManager` verbatim, then attaches a
screencast pump per active session-target.

```
MC_BROWSER_TARGET=streamed-panel
  → ChromeManager.start()                    (reuse chrome-manager.ts unchanged)
  → ScreencastService.attach(session)        (NEW) — per-session CDP screencast → WS
  → browser_* tools work exactly as in owned-chrome (no change)
```

On the locked-down box: sidecar in WSL runs `streamed-panel`; Chrome runs headless in WSL;
the user opens plain Chrome on Windows at `http://localhost:9002` (forward direction already
works) and sees/drives the browser in a canvas panel. **No Electron, no reach-back.**

### 3.2 Server side — `ScreencastService` (NEW, `src/services/screencast.ts`)

Responsibilities:

- **Capture:** for a session's CDP target, open a (long-lived) CDP client and call
  `Page.startScreencast({ format:'jpeg', quality, maxWidth, maxHeight, everyNthFrame })`.
  On each `Page.screencastFrame` event: broadcast the frame, then **immediately**
  `Page.screencastFrameAck({ sessionId })` (CDP back-pressure — Chrome stops sending until
  acked, which naturally throttles to consumer speed).
- **Transport:** push frames to the UI via the existing WS handler. Add a broadcast method
  `broadcastBrowserFrame(session, {data, metadata})` to `src/websocket/handler.ts` and a new
  `WSMessage` variant:
  ```ts
  { type: 'browser_frame', session: string, data: string /*base64 jpeg*/,
    meta: { offsetTop, pageScaleFactor, deviceWidth, deviceHeight, timestamp } }
  ```
  Scope it to a channel (e.g. `browser:<session>`) so only the open panel subscribes —
  reuse `broadcastToChannel` (`handler.ts:354-374`) and the UI `subscribe()` path.
- **Input:** add a WS **inbound** message `browser_input` (mouse/key/scroll) handled by the
  WS handler, dispatched through the **existing** `Input.dispatch*` helpers, factored out of
  `browser.ts` into a shared `cdp-input.ts` so both the MCP tools and the live panel use one
  implementation. Translate canvas-relative coords using the frame `metadata`
  (`offsetTop`, `pageScaleFactor`) so clicks land where the user sees them.
- **Sizing/focus:** when the panel reports its viewport size, call
  `Emulation.setDeviceMetricsOverride` (or relaunch screencast with new `maxWidth/Height`)
  so the captured page matches the panel. Tie `Page.startScreencast`/`stopScreencast` to
  panel visibility + subscription count (stop when nobody's watching → zero idle cost).
- **Lifecycle:** start screencast lazily on first subscribe; stop on last unsubscribe;
  tear down with `ChromeManager.stop()` on shutdown.

### 3.3 UI side — streamed `BrowserPanel` variant

- Replace the placeholder `<div ref={viewportRef}>` (`BrowserPanel.tsx:261`) with a
  `<canvas>` (or `<img src=data:…>` for MVP) when running in `streamed-panel` mode. **Keep
  the existing tab strip / address bar / nav chrome** — those drive `browserStore` actions
  that already map to `browser_*`/CDP, so they work unchanged.
- **Render:** subscribe to `browser:<session>`; on each `browser_frame`, paint the base64
  JPEG to the canvas (`drawImage` after `createImageBitmap`, or set `img.src`). Track the
  frame `metadata` for coordinate mapping.
- **Input forwarding:** attach `mousemove/down/up/wheel/keydown/keyup` listeners to the
  canvas; convert to page coords via metadata; send `browser_input` over WS (coalesce
  `mousemove`/`wheel` with rAF to bound message rate).
- **Drop the rAF `setBounds` loop** in this mode — there is no native overlay to position.
  Detect mode from a server-provided capability flag (e.g. extend
  `GET /api/browser/...` or a bootstrap config field) rather than sniffing `window.mc`.

### 3.4 Coexistence with `electron-view`

`streamed-panel` is **additive**. `electron-view` stays the default for the native desktop
app (zero-copy fidelity is genuinely better there). The UI chooses canvas-vs-placeholder
from the mode flag. No `browser_*` tool signature changes. Long term, if `streamed-panel`
proves good enough, `electron-view` + `BrowserPaneManager` + `desktop-control` could be
retired to simplify the desktop shell — but that is **not** required for this change and
should be a separate decision.

---

## 4. Effort + phasing

Rough sizing assumes one engineer familiar with the codebase. "d" = ideal days.

| Phase | Deliverable | Effort |
|---|---|---|
| **P0 — Spike** | `streamed-panel` mode flag reuses `ChromeManager`; bare `ScreencastService` logs `screencastFrame` dims to console. Proves capture works against owned Chrome in WSL. | 0.5–1d |
| **P1 — MVP: read-only stream** | Frame → WS (`browser_frame` + channel broadcast) → `<img>`/canvas in UI. Agent-driven navigation visible live in a plain browser tab. **No input yet** — user watches; existing `browser_*` tools drive. This alone unblocks the corp box for supervised/agent use. | 2–3d |
| **P2 — Input forwarding** | Canvas → `browser_input` → shared `Input.dispatch*`. Mouse + keyboard + scroll; coordinate mapping via metadata. User fully drives the browser. Factor `cdp-input.ts` out of `browser.ts`. | 2–3d |
| **P3 — Sizing/focus/lifecycle polish** | `setDeviceMetricsOverride` to match panel; start/stop on visibility; reconnect handling; quality/fps tuning; multi-session channel isolation. | 1.5–2.5d |
| **P4 — Hardening (optional)** | downloads/uploads UX, multi-tab in streamed mode, clipboard, retina/devicePixelRatio, perf under VPN. | 2–4d, scope-dependent |

**MVP = P0+P1 (~3–4d):** read-only live view in a plain browser, no Electron, no reach-back —
already solves the corp-Windows blocker for agent/supervised workflows. **Fully interactive =
through P2 (~5–7d).**

---

## 5. Risks / unknowns

- **Screencast latency/throughput over WS.** JPEG frames base64'd over the collab WS add
  ~33% size overhead and compete with other WS traffic. Mitigations: `screencastFrameAck`
  back-pressure (built into CDP), `everyNthFrame`, quality knob, viewport-sized capture,
  rAF-coalesced input, dedicated channel. **Unknown:** real latency under the corp VPN —
  must measure in P1. Consider a binary WS frame (ArrayBuffer) instead of base64 if needed.
- **Input fidelity.** CDP `Input.dispatch*` is synthetic, not OS-level. Edge cases: IME/
  composition, modifier combos, native context menus, drag-drop, precise wheel deltas,
  `devicePixelRatio`/retina coordinate scaling. `dispatchTouchEvent` is currently MISSING if
  touch is ever needed.
- **Multi-tab.** Screencast captures one target at a time. The existing multi-tab store
  assumes native views; streamed mode needs one active screencast that follows the active
  tab (background tabs un-streamed). Defer to P4.
- **Downloads / uploads.** A streamed canvas has no native file dialog. Downloads must be
  intercepted via `Browser.setDownloadBehavior` / `Page.downloadWillBegin` and surfaced in
  the UI; uploads need `DOM.setFileInputFiles`. Out of MVP scope — flag as a known gap.
- **Auth / cookies / state.** `owned-chrome` uses a throwaway `--user-data-dir`
  (`chrome-manager.ts:117`) → no persisted logins across restarts. If users need durable
  sessions, switch to a persistent profile dir (small change, has security implications on a
  shared box).
- **`browser_*` tool contracts.** **No change expected** — tools resolve a CDP target the
  same way in `streamed-panel` as in `owned-chrome`. The only new surface is the WS
  `browser_frame`/`browser_input` messages and the mode flag. This is the key de-risking
  property of the design: automation and display are already decoupled in the code.
- **GPU/headless rendering quirks in WSL.** Same Chromium-GPU-in-WSL fragility noted for
  WSLg may affect headless rendering (fonts, WebGL). `--headless=new` + software GL is the
  safe baseline; verify target pages render acceptably.

---

## 6. Resolved decisions (2026-06-16)

1. **Coexist (additive) — DECIDED.** `streamed-panel` is a **4th mode alongside**
   `electron-view`, not a replacement. `electron-view` stays the native-desktop default
   (zero-copy fidelity on a single local box). Retiring `BrowserPaneManager`/`desktop-control`
   is explicitly **out of scope** and revisited later only if streaming proves sufficient
   across all topologies.

   **Multi-server consideration (raised by owner):** we talk to multiple servers on different
   machines. This is a **point in favor of `streamed-panel` + coexistence**, not a problem:
   - `electron-view` pins the automated browser to the **one local Electron shell** and drives
     remote servers' browsers via cross-machine CDP — the same reach-across-machines fragility
     that breaks the corp box, plus structurally one shared pane for N servers.
   - `streamed-panel` gives **each server its own co-located Chrome**; pixels stream over *that
     server's* WS on a `browser:<session>` channel — the same per-server/per-session scoping
     artifacts already use (`broadcastToChannel`, `handler.ts:354`). No cross-machine CDP, no
     single-pane contention.
   - **Design requirement this imposes:** the streamed `BrowserPanel` must bind its frame
     subscription to the **specific server connection** the session belongs to (not a global
     singleton WS client). This matches existing per-server artifact routing — known pattern,
     not new risk. (Flagged into P1/P3.)

2. **Full interactivity (P2) is the bar — DECIDED.** Read-only (P1) is a build milestone, not
   the ship target. Nothing ships to the corp box until mouse/keyboard/scroll forwarding works.
   Target ~5–7d through P2.

3. **Single agent-driven session pane — DECIDED.** No full multi-tab manual-browsing UX in
   streamed mode for this change. One screencast follows the active session target. Multi-tab
   stays a deferred P4 item.

4. **Throwaway profile — DECIDED.** Keep the current temp `--user-data-dir`
   (`chrome-manager.ts:117`); logins reset on restart. No persistent-profile work; revisit only
   if durable auth becomes a need (note the shared-box security implication then).
