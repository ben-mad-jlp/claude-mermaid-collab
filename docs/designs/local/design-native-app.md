# Design: mermaid-collab as a Native App

## Goal

Repackage mermaid-collab from "browser tab + separate Bun server + CDP tunnel to a remote Chrome + full VSCode bridge" into a **single cross-platform desktop app** (macOS, Ubuntu, Windows) that:

1. Hosts the collab UI as a first-class window (OS menus, notifications, tray, deep links, file dialogs).
2. Embeds the **controlled browser** as a pane inside the app.
3. Embeds a **real terminal** as a pane inside the app.
4. **Owns the server lifecycle** — the WebSocket/API/MCP server starts/stops with the app, always-on.
5. Demotes VSCodium to a **thin diff-viewer target** only.

## Key insight: the browser you want to embed *is* Electron

The whole collab browser-automation story today is:

> VSCodium toggles a CDP tunnel (amber button) → SSH-forwards Linux:9333 → Windows Chrome → `browser_*` MCP tools drive it over chrome-remote-interface.

Electron's own window **is** a Chromium instance exposing the Chrome DevTools Protocol via the `webContents.debugger` API. If the embedded browser pane is an Electron `WebContentsView`, then:

- The "controlled browser" and the "embedded browser" become **the same object**.
- The SSH tunnel, the 9333 forward, the status-bar toggle, and `chrome-remote-interface` against a remote endpoint all **disappear**.
- `browser_click`, `browser_fill`, `browser_screenshot`, etc. retarget from a remote CDP socket to the local `webContents` — same protocol, no network hop.

This single fact is why Electron wins for *this* app, despite Tauri's smaller binaries.

## Electron vs Tauri (for this app specifically)

| Concern | Electron | Tauri |
|---|---|---|
| Embedded **controllable** browser | Native: `WebContentsView` + `webContents.debugger` (CDP). The embed *is* the controlled browser. | OS webview (WKWebView / WebView2 / webkitgtk). **No CDP** — you'd still need an external Chrome + tunnel, defeating the goal. |
| Terminal | `node-pty` + existing `@xterm/xterm` (already a UI dep). | Rust `portable-pty` + custom bridge to xterm. More glue. |
| Existing Bun server | Spawn as a sidecar child process from the main process; reuse `bun run src/server.ts` verbatim. | Same sidecar approach works, but main process is Rust. |
| Existing React UI | Loads unchanged. | Loads unchanged. |
| Cross-platform (mac/ubuntu/win) | Mature, well-trodden. | Mature, smaller binaries. |
| New language surface | None (Node/TS). | Rust. |
| Binary size | ~100–150 MB | ~10–40 MB |

**Recommendation: Electron.** The browser-control requirement is the deciding factor; Tauri can't give you a CDP-drivable embedded browser without re-introducing the very tunnel we're trying to delete.

## Proposed architecture

```
Electron App (one process tree, cross-platform)
├── Main process (Node/TS)
│   ├── Spawns + supervises the Bun server (sidecar child process)
│   │   └── existing src/server.ts — API + WebSocket + MCP, unchanged
│   ├── OS integration: app menu, tray, notifications, deep links, dialogs
│   ├── node-pty: PTY processes for terminal panes
│   └── webContents.debugger: CDP driver for the browser pane
│
└── Renderer (existing ui/ React app, loaded from the Bun server or file://)
    ├── Collab UI (diagrams / docs / designs / snippets)  ← unchanged
    ├── Terminal pane   (xterm.js ↔ IPC ↔ node-pty)
    ├── Browser pane    (WebContentsView, driven via CDP from main)
    └── "Open diff in VSCodium" button → thin extension endpoint
```

### Server lifecycle
Main process spawns the Bun server on launch, health-checks it (reuse `check_server_health`), and tears it down on quit. The current "run `bun run dev`, open localhost:3737, toggle CDP" ritual is replaced by launching the app.

### Browser pane
A `WebContentsView` layered into the window. The existing `browser_*` MCP tools change their transport: instead of connecting `chrome-remote-interface` to a remote endpoint, the main process attaches `webContents.debugger` and forwards the same CDP commands. The MCP tool surface (`browser_open`, `browser_click`, setups, screenshots) stays identical — only the backend binding changes.

### Terminal pane
xterm.js (already bundled) in the renderer ↔ IPC ↔ `node-pty` in main. The existing `src/terminal/` backend logic informs the PTY wiring. Replaces the VSCode-terminal bridge in `ui-half.ts` / `workspace-half.ts`.

### VSCodium = thin diff target
Keep one endpoint: `POST /api/ide/open-diff { filePath }` (already exists). Strip the rest of the bridge. The native app owns terminal + browser + UI; VSCodium is launched only when the user wants a full editor diff. Monaco is already a UI dependency, so an *in-app* diff view is also viable later if you want to drop VSCodium entirely.

## Migration path (incremental, non-breaking)

The current `extensions/vscode/` already proves out the hard integrations (terminal bridge, open-diff, CDP toggle). The native app **absorbs** these rather than reinventing them.

1. **Shell skeleton** — Electron app that loads the existing UI from the running Bun server. No embedded panes yet. Proves cross-platform packaging (mac/ubuntu/win).
2. **Server supervision** — main process spawns/health-checks/stops the Bun sidecar. Remove the manual start ritual.
3. **Terminal pane** — node-pty + xterm IPC. Retire the VSCode terminal bridge.
4. **Browser pane** — WebContentsView + retarget `browser_*` tools to `webContents.debugger`. Retire the SSH/CDP tunnel.
5. **OS integration** — menus, tray, notifications, deep links.
6. **VSCodium slim-down** — reduce the extension to the diff endpoint only.

Each step ships independently; the browser UI keeps working throughout.

## Resolved decisions (after codebase research + Grok consult)

> **A correction reframed everything.** The original premise assumed the server used `better-sqlite3` / `node-pty` / the `ws` package. Codebase research found the opposite: the server is **deeply Bun-native** — a single `Bun.serve()` for HTTP+WS+MCP, `bun:sqlite` across ~15 files, Bun's **native PTY** (`Bun.spawn({terminal})`), and ~35 `Bun.spawn` sites. There is no `node-pty` and no `xterm.js` in the repo today. This fact decides Q1 and, critically, **invalidates Grok's "port it in ~2-3 days" estimate** — Grok was reasoning from the wrong premise.

### Q1 — Bun sidecar vs port to Node → **SIDECAR (keep Bun)**

Grok argued "port to Node" for a single-process model. But that recommendation assumed the server was already Node-friendly. Given the true Bun coupling, porting means rewriting: `Bun.serve` + the WS upgrade path → `ws`/`uWebSockets`; `bun:sqlite` → `better-sqlite3` across 15 files (semantics differ); Bun PTY → `node-pty`; 35 `Bun.spawn` sites → `child_process`. That's a multi-week rewrite of the most logic-dense code with heavy regression risk.

**Decisive bonus:** the sidecar path **eliminates the entire native-module rebuild nightmare** (node-pty + better-sqlite3 rebuilt against Electron's ABI for 6 targets) that Grok itself flagged as the classic Electron pain point — because Bun's PTY and `bun:sqlite` are built into the Bun binary. We dodge it completely by *not* porting.

- Ship the server via `bun build --compile --target=...` per OS.
- Must-do plumbing: `asarUnpack`/`extraResources` + resolve via `process.resourcesPath` (NOT `__dirname`); sign the sidecar binary independently (mac hardened runtime, Windows cert) or Gatekeeper/SmartScreen kills it; robust child-process-tree teardown on Windows (`taskkill /T`, no real POSIX signals); port discovery via the existing instance registry.
- **Terminal bonus:** keep the terminal server-side (Bun-native PTY, stream over the existing `/terminal/:id` WS) → we may not need `node-pty` *or* a renderer PTY at all. (This corrects the architecture diagram above, which assumed node-pty.)

### Q2 — Packaging → **electron-builder (+ electron-vite)** — unanimous

Both the research agent and Grok agree. Builder does notarized `.dmg`, signed NSIS `.exe`, and AppImage/deb from one config; its `asarUnpack`/`extraResources` keys are exactly what the Bun sidecar needs; it pairs natively with `electron-updater`. Grok adds: use `electron-vite` to bundle the React UI with `contextIsolation`, a custom `app://` protocol, and proper asar handling.

### Q3 — Auto-update → **do the minimum in v1** — unanimous

Since macOS distribution *forces* notarization/signing anyway, wiring `electron-updater` against GitHub Releases is cheap incremental work and gives a safety valve for a v1 that bundles an experimental sidecar. v1: auto-update on macOS (signed/notarized) + Windows NSIS + Linux **AppImage** (deb/rpm defer to system package managers). **Must-test:** an update correctly swaps the unpacked sidecar binary *and* re-validates its signature — the migration-specific risk.

### Q4 — A client vs THE client → **A reachable localhost server that the app bundles + supervises; localhost-default, opt-in sharing**

The two opinions converge here. The app bundles and supervises the server, but the server stays a **reachable listening process** — because it *must*: Claude Code reaches MCP over HTTP (`.mcp.json` → `type:"http"`, `localhost:9002/mcp`), and the VSCode bridge needs a `serverUrl`. A fully in-process/socketless server would break the AI integration, so "THE client (embedded, no socket)" isn't actually achievable without crippling the agent story.

- Default-bind **`127.0.0.1`** (safe single-user out of the box) with an explicit **"Allow other devices / bind `0.0.0.0`"** toggle for LAN/remote.
- Reuse the instance registry so a CLI-started server and the app don't double-bind (attach if present, else spawn).
- Preserves the high-value fan-out that collab *actually* delivers today: **human ↔ Claude agent ↔ IDE/browser**, all on one live session. (Note: collab is shallow — last-write-wins, no presence/CRDT/multi-cursor. Multi-*human* co-editing is more aspirational than real.)

## Newly surfaced must-address items (mostly from Grok)

1. **MCP transport — mostly already solved.** Claude Code uses HTTP transport to `localhost:9002/mcp` today. As long as the bundled server keeps listening there and `.mcp.json` points at it, the AI story works unchanged. (Grok feared a stdio bridge would be needed; verified not required given the existing HTTP transport.) Decide whether the app *manages* `.mcp.json` / port advertisement.
2. **`webContents.debugger` is an RCE surface.** The controlled browser pane must be treated as a sandbox: `session.fromPartition()` (no persistent storage), strict permissions, `webSecurity: true`, never expose the raw debugger API to the renderer — funnel CDP through the main process via a tiny `contextBridge`.
3. **The remote / two-machine use case breaks.** The controlled browser moves *inside* the Electron instance, killing the SSH→remote-Chrome workflow that `research-remote-collab-topology` / `research-two-machine-one-ui` explored. Need a plan: a "headless controlled browser" mode on the server, or remote-desktop to the app machine. The `0.0.0.0` toggle keeps the *collab* half reachable, but not the *browser-control* half.
4. **Single-instance lock + deep linking.** `app.requestSingleInstanceLock()` from day one; register `mermaid-collab://` so links from browsers/Slack open the right session; second instance forwards the URL/session to the first.
5. **Renderer ↔ server boundary.** Prefer a custom `app://` protocol + main-process proxy (and Electron IPC for the control plane) over the renderer hitting `http://localhost:xxxx` directly — avoids macOS loopback consent popups. Collab data can still ride WS.
6. **No auth layer exists today.** "Others can join" over `0.0.0.0` is unsafe as-is. Add a simple per-session token/PIN before exposing the bind toggle. This is the one genuinely new piece of work the client-decision requires.
   - **Binding + auth must be server-config-level, not app-level.** Because the per-machine server is most often started by Claude's `SessionStart` hook / CLI daemon — *not* by the native app (see "Who runs the server on each machine?") — the "Allow other devices" choice cannot live only in the app UI. The server itself must honor a `0.0.0.0`-vs-`127.0.0.1` bind setting and a token via env var / config file that the **hook, CLI, and app all read** (e.g. `MERMAID_BIND_HOST` + `MERMAID_AUTH_TOKEN`). Otherwise a remote machine's hook-started server binds `127.0.0.1` and the switcher can never reach it. Default remains `127.0.0.1` + no token (safe); opting into sharing flips the server config, not just an app preference.
7. **`WebContentsView` ≠ `BrowserWindow`.** Some CDP domains behave differently; validate `Page.navigate`, `Emulation`, and overlay handling early before committing the `browser_*` retarget.

## Multi-machine topology

The hard constraint from the codebase: **a collab server can only touch files on its own machine.** It writes artifacts under `<project>/.collab/...` and runs git/pseudo against its own `cwd`. That single fact dictates the topology.

### What works on one machine
Multiple collab servers can run on one machine — one per (project, session), on different ports, tracked by the instance registry. So "multiple collabs on a single machine" is fine today.

### What breaks: Claude on a different machine than its server
If Claude Code runs on machine 1 but its collab server runs on the hub, they operate on **two different filesystems** — the server stores artifacts and runs git on the hub's disk, while Claude edits the real source on machine 1. The collab state lands in the wrong place.

{{diagram:native-app-topology-question}}

### Server ↔ client fan-out

The server↔UI link is a **WebSocket**: the `WebSocketHandler` keeps a flat set of all connected sockets and `broadcast()`s every mutation to all of them. So one server already talks to **many clients at once** — and UIs are just one client type alongside Claude (MCP) and the IDE channel.

{{diagram:native-app-server-fanout}}

The relationship is asymmetric:

| Direction | Supported? |
|-----------|-----------|
| One server → many UIs at once | ✅ Today (WS broadcast) |
| One server → UIs + Claude + IDE simultaneously | ✅ Today (the real value: human ↔ agent ↔ IDE sync) |
| One UI → one server at a time | ✅ Today (single origin); switcher changes *which* |
| One UI → many servers at once (federation) | ❌ Not built |

**A server is many-to-one on the client side; a UI is one-to-one on the server side.** The server switcher works *within* this — it re-points one window between servers, each connection still to a single server. (Collab is shallow: last-write-wins, no presence/cursors.)

### The rule the constraint forces
> **Server + project code + Claude Code stay co-located on one machine. The only thing that roams across the network is the UI window.**

{{diagram:native-app-topology-that-works}}

### Implication for the native app
- "A collab window per machine?" — the **window is the flexible part, not a hard requirement.** Today the UI is single-origin (one window = one server), so it would be one window per machine.
- The native app can ship a **server switcher / tabs** so a single app connects to server A, B, C in turn (or side by side) — each a co-located server+code+Claude unit on its own machine, reachable over the network (`0.0.0.0` + auth).
- Showing **multiple servers aggregated in one view simultaneously** is the "federation" piece the earlier research (`research-remote-collab-topology`, `research-two-machine-one-ui`) scoped out, and is **not built yet**. The single-origin UI (`API_BASE=''`, WS from `window.location.host`) would need to become multi-origin/host-aware first.

The server-switcher UI that implements this (sketch + technical requirements + scope ladder) is specced separately in [[design-server-switcher]].

### Who runs the server on each machine?

The server is **already** started three idempotent ways today, all co-located with the code (each detects an already-running instance and no-ops):

1. **Claude Code plugin `SessionStart` hook** — `scripts/session-start-hook.sh` + `hooks/server-check.sh` bring the server up when a Claude session starts in the project.
2. **CLI daemon** — `mermaid-collab start` (background, PID/instance dedup).
3. **VSCodium extension** — `spawnCollabServer()` with already-running pre-flight detection.

**The natural owner is Claude Code itself.** The topology rule already forces server + code + Claude to be co-located on each machine; since Claude must run there anyway and its hook already starts the server, Claude is the per-machine server owner by default. The CLI daemon and the slimmed extension are alternate starters for the same local server.

This **scopes the app's "bundle + supervise" claim**:
- **Local machine ("This Mac"):** the native app bundles and supervises its own server. (Must dedup against a CLI/hook-started instance via the registry — don't double-bind.)
- **Remote machines:** the app is a **pure viewer**. It does NOT start remote servers — Claude's hook / CLI / extension on each machine does. The app connects to whatever is already listening (and reachable via the `0.0.0.0` + auth path).

## Implementation decisions (2nd research pass + Grok)

Resolved the three load-bearing unknowns via two codebase agents + a Grok consult.

### D1 — Browser-control process boundary → **Option A first (chrome-remote-interface → Electron's loopback remote-debugging-port); Option B as optional hardening**

The `browser_*` tools live in the Bun sidecar and drive CDP via `chrome-remote-interface`; the controllable `WebContentsView` lives in Electron main. Grounding facts that decided it:

- The tool layer `src/mcp/tools/browser.ts` (≈30 CDP call-sites across Runtime/Page/Input/DOM/Emulation/Network/Performance/HeapProfiler/Target) survives **100% unchanged under A** — only the `port`/target in `src/services/cdp-session.ts` changes.
- The tab layer's reliance on `Target.createTarget` + `CDP.List` **does not fit the new model either way** — you want commands routed to the existing view, not CDP spawning Chromium pages. So `createOrReplaceTab`/`ensureTab` need rework regardless of A vs B.
- Option B's real cost is re-marshalling CDP **events** (`Runtime.consoleAPICalled`, `Network.requestWillBeSent`, `HeapProfiler` chunks, `Page.loadEventFired`) and **binary screenshots** over IPC — both sources flag this as the painful part.

**Plan:** Launch Electron with `remote-debugging-port` on a **random loopback port**, passed to the sidecar at spawn. Keep `chrome-remote-interface` (handles WS framing + per-target sessions + events — the expensive parts). **Switch to B (IPC bridge) only if** the open-CDP-port threat model bites — see Risk R1.

**✅ D1 SPIKE VERIFIED** (`desktop/` — Electron 37.10.3 / Chrome 138, run on macOS): both paths work.
- `WebContentsView` **appears in `/json/list`** as `type: "page"` with a `webSocketDebuggerUrl` — resolves the main unverified caveat (and de-risks R7).
- **Option A:** `chrome-remote-interface` connected to the view's target; `Runtime.evaluate` returned the expected DOM text; `Page.captureScreenshot` returned a valid 23 KB PNG. The lib the server already uses drives the embedded view **unchanged**.
- **Option B:** `webContents.debugger.attach('1.3')` + `sendCommand('Runtime.evaluate'|'Page.captureScreenshot')` both succeeded.
- **Caveat confirmed:** two `page` targets exist (the view + a blank host target), so the tab layer must **select the existing view by title/url, not `Target.createTarget`** — exactly as predicted.

**✅ D1 EXTENDED SPIKE** (`desktop/extended.js`, `npm run spike:full`): proves migration milestones 1+2 and the fuller CDP surface.
- **Sidecar supervision (milestone 2):** Electron main spawns `bun run src/server.ts` on its own free port, health-checks `/api/health` (**healthy in ~0.7s**), kills it on quit. ✅
- **Shell loads real UI (milestone 1):** main window loaded the actual collab UI from the sidecar (title "Mermaid Collaboration"). ✅
- **Full CDP surface via Option A (chrome-remote-interface), all on the embedded view:** `Runtime.evaluate` ✅, `DOM.getDocument/querySelector/getBoxModel` ✅, `Input.dispatchMouseEvent` (real click registered) ✅, `Page.captureScreenshot` ✅.
- **Event streaming works** (the hard part of an IPC bridge): `Runtime.consoleAPICalled` ✅ and `Network.requestWillBeSent` ✅ both captured.
- **A/B coexistence:** `webContents.debugger.attach()` **succeeded while `chrome-remote-interface` was simultaneously connected** to the same view — so Option A and Option B are *not* mutually exclusive; per-command fallback to B is viable.
- **✅ Device/viewport emulation — RESOLVED, no gap.** A visible-window retest (`desktop/emulation-retest.js`) confirmed emulation works via **both** CDP `setDeviceMetricsOverride` and Electron-native `enableDeviceEmulation`: baseline `innerWidth` 1100 → emulated **375** under both. The earlier 980 reading was two compounding *test* artifacts — a `show:false` view (no render surface) plus a test page lacking `<meta name="viewport">` (980 is Chrome's correct mobile fallback for such pages). So the **entire `browser_*` CDP surface is verified on the embedded `WebContentsView` via Option A** — no limitations found, and R3 has no remaining concrete instance.
- Still untested (minor): single-`debugger`-client vs **open DevTools** conflict; heavy-load event throughput.

### D2 — Cross-origin transport for the switcher → **Electron main proxy (unanimous)**

There is **zero** CORS/origin/auth code today; the UI is hardwired same-origin (`API_BASE=''`, WS from `window.location`). So:

- **Don't add CORS to every route** — instead, Electron main runs a **per-server local HTTP+WS proxy** on a random loopback port. The renderer keeps its same-origin assumption (just points at the proxy URL); a thin transport shim replaces `window.location`-derived URLs.
- Custom protocols (`protocol.registerHttpProtocol`) **can't proxy WS** — use real `http`/`ws` servers in main (~150 lines).
- **Tokens live only in main**, injected uniformly into every proxied request *and* the upstream WS handshake (only the main process can set real WS headers). Persist via `safeStorage`. Renderer never holds the token.
- Bonus: kills the macOS loopback-consent popups (traffic originates from main, not the sandboxed renderer).

### D3 — Remote browser-control → **REQUIRED. Keep it, as per-server CDP config (Grok's "accept the loss" rejected by product decision)**

**Product decision: remote browser control is a hard requirement, not optional.** It is **not** two implementations to maintain — it's the *same* `browser_*` tools with the **CDP target made per-`ServerContext` config** (today `CDP_PORT=9333` is hardcoded):

- **Local "This Mac":** target the embedded `WebContentsView`'s debug port (interactive, visible in the browser pane).
- **Remote / headless machine:** the per-machine server owns a Chrome it spawns (reuse the extension's existing `--remote-debugging-port` spawn logic). The remote Claude drives the remote server's tools → remote Chrome — **all on that machine**; the app just displays the resulting screenshots as artifacts. No cross-network CDP.

Accepting the loss (Grok's pick) would re-break the exact remote/headless scenario the multi-server architecture is being built for, since an embedded local `WebContentsView` physically cannot see a remote server's localhost/VPN/env. **Grok's dissent is explicitly overridden.** Implications now in scope: `CDP_PORT` must become per-`ServerContext` config; the server must be able to spawn/own a headless Chrome on its own machine (lift the extension's spawn logic into the server); and the `cdp-session.ts` rework must keep both targets (embedded view + server-owned Chrome) as first-class, not treat the embedded view as the only path.

### Risks / overlooked seams (mostly Grok — track these)

- **R1 — Open remote-debugging-port = local RCE surface.** Even on loopback, any local process can attach and drive/read the embedded browser (cookies, localStorage, screenshots). Real once users log into actual sites in the controlled view. This is the standing reason to migrate D1 → Option B later.
- **R2 — Binary blob marshalling.** Screenshots/PDF/HAR over base64-CDP (and over the network for remote servers) gets expensive at scale. Prefer a side channel (temp files / shared memory); already a reason A (no IPC) beats B for blobs.
- **R3 — `WebContentsView` CDP gaps.** `Page.printToPDF`, parts of `Emulation`, the `Browser` domain may differ/stub vs real Chrome. Validate the actually-used commands in the D1 spike.
- **R4 — Token lifecycle in proxy mode.** Where stored (`safeStorage`/keychain), refresh without renderer seeing secrets, atomic revoke of the previous server's token on switch.
- **R5 — Multi-`WebContentsView` / tab model.** Tabs will be wanted fast; managing multiple targets, which is the "automation target," focus stealing, per-tab DevTools, and the heavy `WebContentsView` lifecycle are uncovered.
- **R6 — Sidecar process model.** Spawn from main vs `UtilityProcess` (crash isolation, sandbox/asar interplay with the 35 `Bun.spawn` + PTY sites).
- **R7 — Target-discovery race.** Random CDP port + view creation → sidecar may attach before the target exists. Need an explicit "browser ready" handshake.
- **R8 — Remote MCP latency.** Browser commands to a remote server now cross the network (remote MCP → sidecar → CDP); budget for it.

## Net assessment

Most of the original plan holds, with one major correction: **keep the Bun server as a signed sidecar — do not port it.** That choice is what makes the migration tractable (no rewrite, no native-module rebuild hell). The remaining real work is plumbing (asar/signing/path resolution, single-instance, deep links), a small auth layer, and the browser-pane security sandbox — not a server rewrite.

**Readiness:** with D1–D3 resolved, the load-bearing unknowns are closed and this is now an **implementation-ready design** — enough to write a build plan / task graph against. Recommended first move is the **D1 spike** (Electron + `WebContentsView` + loopback remote-debugging-port), since it validates the headline premise ("Electron's window is the controlled browser") and de-risks R3/R7 before committing the `cdp-session.ts` rework. The risks R1–R8 are tracked, not blocking — R1 (open CDP port) is the main one that could later force the D1→B migration.
