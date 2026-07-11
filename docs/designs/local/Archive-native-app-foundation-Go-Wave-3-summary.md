# Wave 3 Implementation

## Tasks
- **supervisor-instance-dedup** ✅ — Implemented `ServerSupervisor.checkExistingInstance()` in `desktop/src/main/server-supervisor.ts`: uses injectable `discoveryImpl` to list instances, matches (project, session), health-checks the advertised port, and attaches (returns `{attached:true}`) only if healthy — otherwise falls through to spawn. `stop()` is a no-op when attached. Added 4 dedup tests (attach-on-healthy, spawn-on-different-session, spawn-on-dead-instance, stop-noop-when-attached).
- **browser-pane** ✅ — Created `desktop/src/main/browser-pane.ts`: `createBrowserPane(win, bounds)` adds a `WebContentsView` loading a marker page titled `mc-browser-pane` (matches `ELECTRON_VIEW_MARKER`). Rewired `desktop/src/main/index.ts`: `bootstrap()` sets `remote-debugging-port` on a free loopback port before `ready`, starts the supervisor with `cdpPort` (→ sidecar env `CDP_PORT` + `MC_BROWSER_TARGET=electron-view`), loads the real collab UI from the sidecar, creates the pane, and stops the supervisor on `before-quit`.

## Verification
- Tests: 18/18 pass across the 3 native-app test files (server-supervisor 11, cdp-session.target 4, cdp-session.config 3).
- `electron-vite build`: clean — `out/main/index.js` (7.3k) built with supervisor + pane wiring.
- tsc: no errors in touched backend files.

## Manual verification still recommended (GUI runtime — not headless-testable here)
- Launch `cd desktop && npm run dev`: confirm window loads the collab UI from the spawned sidecar, and a connected Claude can `browser_open`/`browser_screenshot` the embedded pane (registers via the marker, then drives by target id).
- Pane currently created at zero bounds (not visible) — renderer-driven layout/IPC is a later phase (R5).

## Wave TSC
clean
