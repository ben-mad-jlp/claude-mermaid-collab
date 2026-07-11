# Design: Remote Browser-Control (Phase 7)

Third design doc in the native-app series — see [[design-native-app]] (D3 made remote browser control a hard requirement) and [[design-remote-connectivity]] (the reachable-server + switcher work this builds on, now committed).

## Goal

Let the **per-machine collab server spawn and own a Chrome on its own machine** so the `browser_*` tools work when the server runs on a remote/headless box — instead of the Electron-embedded `WebContentsView`, which only exists where the app runs. This is the D3 requirement: *browser runs where the code/server is.*

## The key simplification (from the code map)

The default `cdp-session` path already connects `chrome-remote-interface` to `127.0.0.1:CDP_PORT` and **assumes a Chrome is listening there** (`cdp-session.ts:198` `Target.createTarget` against `CDP({host:'127.0.0.1', port})`). Today that Chrome arrives via the VSCodium SSH tunnel.

> So "server-owned Chrome" mostly means: **the server spawns Chrome on `CDP_PORT` itself.** Once it's listening, the existing `browser_*` tools drive it **unchanged**. No cross-network CDP, no new tool code — just a server-side process manager + a mode flag.

And screenshots already land as session artifacts (`browser.ts:48-53` → `.collab/sessions/<session>/images/`), which sync to any UI over the collab WS. So a remote server's screenshots show up in the app **without the laptop ever speaking CDP to the remote Chrome.**

{{diagram:native-app-remote-browser-flow}}

## The three browser-target modes (per-`ServerContext`)

`MC_BROWSER_TARGET` selects how the browser tools get a Chrome:

| Mode | Who sets it | Chrome source |
|------|-------------|---------------|
| `electron-view` | Electron supervisor for the **local** sidecar (already implemented) | the app's embedded `WebContentsView` |
| `owned-chrome` | a server on a **remote/headless** machine (via env/config) — **NEW in Phase 7** | Chrome the server spawns on `CDP_PORT` |
| _(unset)_ | today's default | external Chrome already on `CDP_PORT` (SSH tunnel / VSCodium toggle) — preserved for back-comat |

Same `browser_*` tools throughout; only the target differs. This is exactly the "same tools, CDP target per-ServerContext config" from [[design-native-app]] D3.

## Architecture

### New: server-side `ChromeManager` (`src/services/chrome-manager.ts`)
Lifts the extension's proven spawn logic (`extensions/vscode/src/extension.ts:537-548`, `ui-half.ts:239-286`) server-side:
- **`findChrome()`** — platform binary lists (mac/linux/win from `ui-half.ts:239-260`) + macOS `mdfind` fallback + a `MERMAID_CHROME_PATH` config override (required on headless Linux if Chrome isn't at a standard path).
- **`start()`** — `spawn(chromeBin, [...flags], { stdio: 'ignore', detached: false })` with the extension's flags: `--remote-debugging-port=${CDP_PORT}`, `--remote-allow-origins=*`, `--no-first-run`, `--no-default-browser-check`, `--disable-background-networking`, `--disable-sync`, `--user-data-dir=${ephemeralTmpDir}`, plus **`--headless=new`** when `MERMAID_BROWSER_HEADLESS` is set or no display is detected. Poll CDP readiness (reuse the extension's `findCdpUrl`-style loop) before returning.
- **`stop()`** — kill the child (SIGTERM; Windows `taskkill /T`) + remove the ephemeral user-data-dir.

### Config (`src/config.ts`)
- `MC_BROWSER_TARGET` (read it explicitly now), `MERMAID_CHROME_PATH` (override), `MERMAID_BROWSER_HEADLESS` (bool). `CDP_PORT` already exists.

### Lifecycle wiring (`src/server.ts`)
- **Startup** (~`server.ts:50-54`, alongside `closePersistedTabs`): if `MC_BROWSER_TARGET==='owned-chrome'`, `await chromeManager.start()`. Non-fatal on failure — log and continue (browser tools just error until Chrome is up).
- **Shutdown** (SIGINT/SIGTERM handlers `server.ts:393-409`): `await chromeManager.stop()` before `removeInstance()`.

### Tools — no change
`browser.ts` / `cdp-session.ts` default path already targets `127.0.0.1:CDP_PORT`. With owned-chrome listening there, `browser_open`/`click`/`screenshot`/etc. work as-is. (`electron-view` branch stays for local.)

## How it ties to the switcher
A remote server in `owned-chrome` mode is just another entry in the [[design-server-switcher]] list. The **remote Claude** (co-located with that server) drives its `browser_*` tools → its local Chrome; screenshots are written to that session's images and synced to the app over the collab WS. The laptop app is a pure viewer of the result. (The app's main-process proxy carries the collab HTTP/WS + token; it does **not** carry CDP.)

## Open questions / decisions

- **Chrome discovery on headless Linux:** standard paths often present (`/usr/bin/google-chrome`, `chromium`); otherwise require `MERMAID_CHROME_PATH`. Do **not** attempt mdfind/registry magic on servers — fail clearly with an actionable message. Consider documenting `apt install chromium` etc.
- **Headless default:** headful when a display exists, `--headless=new` otherwise. Auto-detect via `process.env.DISPLAY` (Linux) / platform, overridable by `MERMAID_BROWSER_HEADLESS`.
- **Port:** spawn Chrome on the configured `CDP_PORT` (default 9333). Simple; the tools already read it. (Ephemeral-port + rewrite is unnecessary complexity since the server owns the port on its own machine.)
- **Chrome crash/restart:** ChromeManager should detect `exit` and optionally relaunch on next tool call (lazy) rather than supervise aggressively. Keep v1 simple: log the crash; next `browser_open` triggers a `start()` if not alive.
- **No new npm dep:** reuse `chrome-remote-interface` + child_process + lifted findChrome. Do NOT add puppeteer/chrome-launcher (keeps the Bun-native, no-native-modules story intact).
- **Bun spawn:** the server is Bun — use `Bun.spawn` (matches the ~35 existing spawn sites) rather than node `child_process`.

## Scope / not in this phase
- The embedded `electron-view` path is unchanged (already shipped).
- Interactive *viewing* of the remote browser (live stream) is out — v1 surfaces screenshots as artifacts (sufficient for agent-driven flows). A live view would be a much larger streaming feature.
- Windows headless Chrome is supported in principle (same flags) but lower-priority to verify.

## Build order (when blueprinted)
1. `ChromeManager` + `findChrome` (server-side, unit-testable: binary discovery with injected fs/platform; spawn with injected spawn impl; readiness poll).
2. Config readers (`MC_BROWSER_TARGET`, `MERMAID_CHROME_PATH`, `MERMAID_BROWSER_HEADLESS`).
3. `server.ts` startup + shutdown wiring (owned-chrome mode).
4. Manual/integration verify: run a server with `MC_BROWSER_TARGET=owned-chrome`, call `browser_open` + `browser_screenshot`, confirm the image lands in the session and renders in the UI.
