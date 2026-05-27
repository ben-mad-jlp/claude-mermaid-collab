# Native App (Electron) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use mermaid-collab:executing-plans to implement this plan task-by-task.

**Goal:** Repackage mermaid-collab as a cross-platform Electron desktop app (macOS/Ubuntu/Windows) that bundles + supervises the existing Bun server, embeds the controlled browser and terminal as first-class panes, and can connect to collab servers on other machines.

**Architecture:** Electron main process spawns the existing Bun server **unchanged, as a sidecar child process** (the server is deeply Bun-native — do NOT port it). The embedded browser is an Electron `WebContentsView` driven via the server's existing `chrome-remote-interface` code pointed at Electron's own loopback `--remote-debugging-port` (Option A — spike-verified). The renderer talks to local/remote servers through a main-process proxy so it stays single-origin. VSCodium is demoted to a thin "open diff" target.

**Tech Stack:** Electron 37, electron-vite, electron-builder, Bun (sidecar), `chrome-remote-interface` (existing), React/Vite UI (existing), vitest (backend tests).

**Design Artifacts:**
- Design doc: collab document `design-native-app` (project=this repo, session=`local`) — the authoritative design with decisions D1–D3, risks R1–R8, and spike results.
- Sub-spec: collab document `design-server-switcher`.
- Diagrams: `native-app/topology-question`, `native-app/topology-that-works`, `native-app/server-fanout`.
- Proven spikes (seed code): `desktop/main.js`, `desktop/extended.js`, `desktop/emulation-retest.js`.

---

## Scope & Sequencing Note

This is a multi-phase effort. **Phases 0–2 are specified in full bite-sized TDD detail** (they are the foundation directly de-risked by the spikes). **Phases 3–8 are structured task outlines** (files / changes / design refs); expand each into bite-sized steps when its predecessor completes, since later phases depend on earlier outcomes. Do not start a phase until the previous phase's "Phase Exit" check passes.

Phase order:
0. Electron shell (promote spike → real app structure, electron-vite)
1. Sidecar supervision (spawn / health / lifecycle / instance dedup)
2. Browser pane + CDP retarget (Option A; `CDP_PORT` → per-context config)
3. Terminal pane (server-side Bun PTY over existing WS ↔ xterm in renderer)
4. ServerContext refactor + main-process proxy (D2)
5. Server-config binding + auth (`MERMAID_BIND_HOST` / `MERMAID_AUTH_TOKEN`)
6. Server-switcher UI (`design-server-switcher`)
7. Remote browser (server-owned headless Chrome; per-server CDP target) — D3, REQUIRED
8. Packaging + signing + auto-update (electron-builder)

---

## Phase 0 — Electron shell (real app structure)

**Why:** The `desktop/` spikes prove feasibility but are throwaway scripts. Establish a real, buildable Electron app structure with electron-vite, contextIsolation, and a tiny preload. No panes yet — just load a placeholder.

### Task 0.1: Scaffold electron-vite project structure

**Files:**
- Create: `desktop/electron.vite.config.ts`
- Create: `desktop/src/main/index.ts`
- Create: `desktop/src/preload/index.ts`
- Modify: `desktop/package.json` (scripts: `dev`, `build`; deps: `electron-vite`, keep `electron`)
- Keep (do not delete): `desktop/main.js`, `desktop/extended.js`, `desktop/emulation-retest.js` as `desktop/spikes/` reference — move them into `desktop/spikes/`.

**Changes (pseudo code):**
- `electron.vite.config.ts`: standard electron-vite config with `main`, `preload`, `renderer` roots. Renderer initially points at a placeholder `index.html`; later phases switch it to load the sidecar URL.
- `src/main/index.ts`: `app.whenReady()` → create `BrowserWindow({ webPreferences: { contextIsolation: true, sandbox: true, preload }})`, load placeholder. Add `app.requestSingleInstanceLock()` (risk: single-instance, design "must-address #4"). Quit on all-windows-closed (except macOS).
- `src/preload/index.ts`: minimal `contextBridge.exposeInMainWorld('mc', {})` placeholder.

**Step 1:** Move spikes: `mkdir -p desktop/spikes && git mv desktop/main.js desktop/extended.js desktop/emulation-retest.js desktop/spikes/`. Update `desktop/package.json` spike scripts to point at `spikes/`.

**Step 2:** Install: `cd desktop && npm install -D electron-vite`.

**Step 3:** Write the three files above (placeholder renderer that shows "mermaid-collab desktop — shell ok").

**Step 4:** Run `cd desktop && npm run dev`. Expected: a window opens showing the placeholder text. (This briefly opens a GUI window — acceptable; close it.)

**Step 5:** Commit.
```bash
git add desktop && git commit -m "feat(desktop): electron-vite shell skeleton with single-instance lock"
```

**Design Reference:** `design-native-app` → "Proposed architecture" + must-address #4 (single-instance/deep-link).

### Task 0.2: Single-instance + deep-link protocol registration

**Files:**
- Modify: `desktop/src/main/index.ts`

**Changes (pseudo code):**
- Register `app.setAsDefaultProtocolClient('mermaid-collab')`.
- On `second-instance` event, focus the existing window and parse the forwarded `mermaid-collab://` URL (stub a handler that logs the parsed session for now).

**Step 1:** Implement the `second-instance` handler + protocol registration.
**Step 2:** Manual verify: launch app, then run `open "mermaid-collab://test/session"` (macOS) — expect the existing window focuses and the parsed URL logs to the main-process console.
**Step 3:** Commit: `feat(desktop): register mermaid-collab:// deep links + second-instance forwarding`.

**Phase 0 Exit:** `npm run dev` opens a single-instance window; second launch focuses the first; deep link reaches the handler.

---

## Phase 1 — Sidecar supervision

**Why:** The app must own the local server lifecycle (spawn, health-check, teardown) and must NOT double-bind against a server already started by Claude's hook / CLI. The spike (`extended.js`) proved spawn+health works (~0.7s); this phase hardens it into a reusable supervisor with instance dedup.

**Design Reference:** `design-native-app` → "Server lifecycle", "Who runs the server on each machine?", Q1 (sidecar), risk R6 (spawn vs UtilityProcess).

### Task 1.1: `ServerSupervisor` — spawn + health + teardown

**Files:**
- Create: `desktop/src/main/server-supervisor.ts`
- Test: `desktop/src/main/__tests__/server-supervisor.test.ts`

**Changes (pseudo code):**
- `server-supervisor.ts`: export `class ServerSupervisor` with:
  - `start(opts: { repoRoot, project, session, host, port?, token? }): Promise<{ port: number }>` — pick a free port if not given; `child_process.spawn('bun', ['run', 'src/server.ts'], { cwd: repoRoot, env: { PORT, HOST, MERMAID_PROJECT, MERMAID_SESSION, MERMAID_BIND_HOST, MERMAID_AUTH_TOKEN } })`; poll `GET /api/health` until ok or timeout; resolve with the port.
  - `stop(): Promise<void>` — `SIGTERM`, and on Windows `taskkill /pid <pid> /T /F` (design Q1: Windows child-tree teardown).
  - `isHealthy(): Promise<boolean>`.

**Step 1: Write the failing test** (mock `child_process.spawn` + a fake health endpoint; or use a stub script). Minimal first test:
```ts
import { ServerSupervisor } from '../server-supervisor';
it('resolves with a port once health passes', async () => {
  const sup = new ServerSupervisor({ spawnImpl: fakeSpawn, fetchImpl: fakeHealthOkAfter(2) });
  const { port } = await sup.start({ repoRoot: '/x', project: '/x', session: 's', host: '127.0.0.1', port: 12345 });
  expect(port).toBe(12345);
});
```
(Design the class to accept injectable `spawnImpl`/`fetchImpl` for testability — DRY/TDD.)

**Step 2:** Run `npm run test:backend -- server-supervisor` → expect FAIL (module missing). NOTE: this test lives under `desktop/`; add `desktop/src/**/*.test.ts` to a vitest include or run via `cd desktop && npx vitest run`. Confirm the test runner picks it up.

**Step 3:** Implement minimal `ServerSupervisor`.
**Step 4:** Run the test → PASS.
**Step 5:** Add tests for `stop()` (asserts kill called) and health-timeout (rejects). Implement. Re-run → PASS.
**Step 6:** Commit: `feat(desktop): ServerSupervisor spawns/health-checks/stops the Bun sidecar`.

### Task 1.2: Instance dedup (attach if a server is already running)

**Files:**
- Modify: `desktop/src/main/server-supervisor.ts`
- Reference (read-only): `src/services/instance-discovery.ts` (`readInstances`, `findInstance`, `deriveSessionId`, `Instance` interface).
- Test: `desktop/src/main/__tests__/server-supervisor.test.ts`

**Changes (pseudo code):**
- Before spawning, call into the discovery registry: if `findInstance(project, session)` returns a live instance (health check its advertised port), **attach** (return that port) instead of spawning. This prevents double-bind against a hook/CLI-started server (design "scopes the app's supervise claim").

**Step 1:** Failing test: given a discovery file pointing at a healthy port, `start()` returns that port and does NOT call spawn.
**Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
**Step 5:** Commit: `feat(desktop): attach to existing instance instead of double-binding`.

**Phase 1 Exit:** `ServerSupervisor` unit tests green; manual `npm run dev` launches, spawns (or attaches to) a healthy sidecar, and the window loads `http://127.0.0.1:<port>` showing the real collab UI (lift the `loadURL` from `extended.js`).

---

## Phase 2 — Browser pane + CDP retarget (Option A)

**Why:** Make the embedded `WebContentsView` the controlled browser, driven by the server's EXISTING `chrome-remote-interface` code pointed at Electron's loopback `--remote-debugging-port`. Spikes verified the full surface works and that the view appears in `/json/list`. The only real code change is making `CDP_PORT` configurable and selecting the existing view by title/url rather than `Target.createTarget`.

**Design Reference:** `design-native-app` → D1 + "D1 SPIKE VERIFIED" + "D1 EXTENDED SPIKE"; risks R1, R7. `src/services/cdp-session.ts`, `src/mcp/tools/browser.ts`.

### Task 2.1: Make `CDP_PORT` per-`ServerContext` config (not a hardcoded const)

**Files:**
- Modify: `src/services/cdp-session.ts` (the `export const CDP_PORT = 9333` and the `host: '127.0.0.1'` call-sites)
- Modify: `src/config.ts` (add `CDP_PORT` from env, default 9333)
- Test: `src/services/__tests__/cdp-session.config.test.ts`

**Changes (pseudo code):**
- `config.ts`: `export const CDP_PORT = Number(process.env.CDP_PORT ?? '9333')`.
- `cdp-session.ts`: import `CDP_PORT` from config instead of declaring it; keep the existing `port` parameter threading (most functions already take `port`). Goal: zero behavioral change when `CDP_PORT` is unset (defaults to 9333), but settable via env for the Electron-spawned sidecar.

**Step 1:** Failing test: with `CDP_PORT=4444` in env (or injected), the resolved port used by `withCDPSession` is 4444.
**Step 2:** Run `npm run test:backend -- cdp-session.config` → FAIL.
**Step 3:** Implement.
**Step 4:** Run → PASS. Also run existing browser/cdp tests to confirm no regression.
**Step 5:** Commit: `refactor(cdp): CDP_PORT configurable via env, default 9333`.

### Task 2.2: Select the existing WebContentsView target by title/url (not Target.createTarget)

**Files:**
- Modify: `src/services/cdp-session.ts` (`createOrReplaceTab`, `ensureTab`)
- Test: `src/services/__tests__/cdp-session.target.test.ts`

**Changes (pseudo code):**
- Add an `electronView` mode (gated by an env flag set when running under Electron, e.g. `MC_BROWSER_TARGET=electron-view`): in `createOrReplaceTab`, instead of `Target.createTarget`, call `CDP.List` and pick the target whose `url`/`title` matches the pane's known marker; register that `targetId` in `tabRegistry`. Spike confirmed two `page` targets exist, so match deliberately.
- Default (non-Electron) path unchanged.

**Step 1:** Failing test: in `electron-view` mode, `createOrReplaceTab` resolves to a target found via a mocked `CDP.List` and never calls `Target.createTarget`.
**Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS (and default-mode test still green).
**Step 5:** Commit: `feat(cdp): select existing Electron view target instead of creating one`.

### Task 2.3: Wire the browser pane in Electron main

**Files:**
- Create: `desktop/src/main/browser-pane.ts`
- Modify: `desktop/src/main/index.ts` (set `--remote-debugging-port` on a free loopback port BEFORE ready; pass it to the sidecar env as `CDP_PORT`; create the `WebContentsView` and a known load marker)

**Changes (pseudo code):**
- Lift the verified spike logic: append `remote-debugging-port`/`remote-debugging-address` switches at top of main; after window+sidecar are up, create `WebContentsView`, add to `win.contentView`, set bounds; set `CDP_PORT`=that port + `MC_BROWSER_TARGET=electron-view` in the sidecar env so `browser_*` tools drive the pane.
- Add IPC `mc.browser.setBounds()` so the renderer can lay out the pane.

**Step 1:** Implement `browser-pane.ts` + wire main.
**Step 2:** Manual verify: launch app; from a connected Claude (or a quick script hitting the sidecar's `browser_open`/`browser_screenshot` MCP/HTTP), confirm the embedded pane navigates and screenshots. Compare against spike behavior.
**Step 3:** Commit: `feat(desktop): embedded WebContentsView driven via existing browser_* tools`.

**Phase 2 Exit:** `browser_*` tools drive the embedded pane end-to-end through the app; backend cdp tests green; risk R1 (open CDP port) noted in code comment with a TODO referencing the possible D1→Option-B migration.

---

## Phase 3 — Terminal pane (outline)

**Design Reference:** `design-native-app` → "Terminal pane" + Q1 "Terminal bonus" (keep server-side Bun PTY, stream over existing `/terminal/:id` WS — do NOT add node-pty). `src/terminal/PTYManager.ts`, existing `/terminal/:id` WS upgrade in `src/server.ts`.

**Tasks (expand when reached):**
- 3.1 Add `@xterm/xterm` + `@xterm/addon-fit`/`addon-attach` to the renderer (already in `ui/package.json` — verify). Create a `TerminalPane` React component that opens a WS to `/terminal/:id` on the active server and attaches xterm.
- 3.2 Verify the existing `PTYManager` (Bun-native PTY) drives it unchanged; add resize message plumbing.
- 3.3 Retire the VSCode terminal bridge path (`extensions/vscode/src/ui-half.ts` / `workspace-half.ts`) — leave the extension's diff endpoint only (Phase 8/VSCodium slim-down).
- Test: PTYManager tests already exist (`src/terminal/PTYManager.test.ts`); add a renderer component test (vitest + jsdom) asserting WS attach.

**Phase 3 Exit:** a working terminal pane backed by the server-side Bun PTY; no node-pty added.

---

## Phase 4 — ServerContext refactor + main-process proxy (outline)

**Design Reference:** `design-native-app` → D2; `design-server-switcher` → requirement #1, #5. Files: `ui/src/lib/pseudo-api.ts`, `ui/src/lib/projects-api.ts`, `ui/src/lib/onboarding-api.ts`, `ui/src/lib/websocket.ts`.

**Tasks (expand when reached):**
- 4.1 Introduce a runtime `ServerContext` (`{ baseUrl, wsUrl, token }`) in the UI; a `fetch` wrapper + WS factory that inject it. Replace hardcoded `API_BASE=''` and `window.location`-derived URLs. (TDD: unit-test the wrapper builds correct URLs/headers.)
- 4.2 Build the main-process per-server local HTTP+WS proxy (real `http`/`ws` servers; `protocol.registerHttpProtocol` can't do WS). Renderer points `ServerContext.baseUrl` at the proxy URL.
- 4.3 Inject the auth token in main (never in renderer); persist via `safeStorage`. (Depends on Phase 5.)
- Risks: R4 (token lifecycle), R8 (remote latency).

**Phase 4 Exit:** the renderer reaches the local sidecar entirely through the main-process proxy; same-origin assumption preserved; macOS loopback consent popups gone.

---

## Phase 5 — Server-config binding + auth (outline)

**Design Reference:** `design-native-app` → must-address #6 + sub-bullet. Files: `src/config.ts`, `src/server.ts` (WS upgrade + route auth), `scripts/session-start-hook.sh`, `bin/mermaid-collab.ts`.

**Tasks (expand when reached):**
- 5.1 `config.ts`: read `MERMAID_BIND_HOST` (default `127.0.0.1`) and `MERMAID_AUTH_TOKEN` (default none). Bind `HOST` to it. (TDD config parsing.)
- 5.2 `server.ts`: if a token is configured, require it (header or query param) on API routes AND check `Origin`/token on the `/ws` + `/terminal/:id` upgrade. Default (no token) = today's open localhost behavior. (TDD: request with/without token.)
- 5.3 Ensure hook + CLI + app all read the same env/config (so a hook-started remote server can be made reachable). Document in the design's must-address #6.

**Phase 5 Exit:** default stays safe (`127.0.0.1`, no token); opting into sharing is a server-config flip honored regardless of who started the server.

---

## Phase 6 — Server-switcher UI (outline)

**Design Reference:** `design-server-switcher` (full sketch + requirements + scope ladder). Build **Level 1** first (switch one active server at a time), then Level 2 (saved + auto-list local instances).

**Tasks (expand when reached):**
- 6.1 Connection store (persisted) `{ id, label, host, port, token?, status }`.
- 6.2 Switcher UI (pill + sidebar + add/edit dialog) per the ASCII sketches.
- 6.3 Switch lifecycle: tear down active WS, swap `ServerContext`, reconnect, refetch sessions, remount — no stale subscriptions.
- 6.4 Health probe per server (`/api/health`); auto-list local instances from the registry.
- Defer Level 3 (tabs) / Level 4 (federation).

**Phase 6 Exit:** one window can connect to a remote machine's server (with token) and switch back to local.

---

## Phase 7 — Remote browser (server-owned headless Chrome) — REQUIRED

**Design Reference:** `design-native-app` → D3 (hard requirement). Files: `src/services/cdp-session.ts`, `extensions/vscode/src/extension.ts` (lift its `--remote-debugging-port` Chrome-spawn logic into the server), `src/config.ts`.

**Tasks (expand when reached):**
- 7.1 Add a server capability to spawn/own a Chrome on its own machine (headless or headful) with `--remote-debugging-port`, reusing the extension's spawn logic. Gated by `MC_BROWSER_TARGET=owned-chrome`.
- 7.2 Per-`ServerContext` CDP target selection: local "This Mac" → embedded view; remote server → its owned Chrome. Same `browser_*` tools; only the target differs.
- 7.3 Screenshots from a remote server surface as session artifacts (existing images flow) — no cross-network CDP.
- Risks: R2 (binary blob marshalling), R8 (latency).

**Phase 7 Exit:** a remote/headless server can be driven via `browser_*` and its screenshots appear in the app.

---

## Phase 8 — Packaging + signing + auto-update (outline)

**Design Reference:** `design-native-app` → Q2 (electron-builder + electron-vite), Q3 (minimal auto-update v1). 

**Tasks (expand when reached):**
- 8.1 electron-builder config: mac `.dmg` (hardened runtime + notarize), Windows NSIS (signed), Linux AppImage + deb. `asarUnpack`/`extraResources` for the Bun sidecar binary (`bun build --compile --target=...` per OS). Resolve sidecar path via `process.resourcesPath`, NOT `__dirname`.
- 8.2 Sign the sidecar binary independently (mac hardened runtime; Windows cert) or Gatekeeper/SmartScreen blocks it.
- 8.3 `electron-updater` against GitHub Releases: macOS (signed/notarized) + Windows NSIS + Linux AppImage. Defer deb/rpm auto-update to system package managers.
- 8.4 **Must-test:** an update correctly swaps the unpacked sidecar binary AND re-validates its signature (the migration-specific risk).
- 8.5 VSCodium slim-down: reduce `extensions/vscode/` to the `open-diff` endpoint only.

**Phase 8 Exit:** signed/notarized artifacts for all three OSes; auto-update verified incl. sidecar swap.

---

## Cross-cutting: risks to keep visible (from `design-native-app` R1–R8)

- **R1** open CDP port = local RCE surface → the reason to consider D1→Option-B later (esp. once users log into real sites in the controlled view).
- **R2** binary blob marshalling (screenshots/PDF/HAR) — prefer side channels.
- **R3** resolved (no remaining instance — emulation verified).
- **R4** token lifecycle in proxy mode (safeStorage, refresh, atomic revoke on switch).
- **R5** multi-`WebContentsView`/tab model (Level 3 switcher).
- **R6** sidecar process model: `child_process.spawn` vs `UtilityProcess` (crash isolation, asar interplay).
- **R7** target-discovery race — de-risked by spike; still add an explicit "browser ready" handshake.
- **R8** remote MCP latency for browser commands across the network.
