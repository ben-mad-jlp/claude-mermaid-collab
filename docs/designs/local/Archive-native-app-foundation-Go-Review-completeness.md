# Completeness Review — Native App Foundation (Phases 0–2)

**Verdict: Everything complete. 0 gaps found.**

All 7 blueprint tasks implemented with real (non-stub) code. Tests pass, build clean, markers consistent.

## Tasks (7/7)
| Task | Status | Evidence |
|---|---|---|
| desktop-shell | ✅ | electron.vite.config.ts, src/main/index.ts, src/preload/index.ts; spikes moved to desktop/spikes/ |
| cdp-port-config | ✅ | src/config.ts CDP_PORT export; cdp-session.ts imports + re-exports |
| desktop-deeplink | ✅ | index.ts: setAsDefaultProtocolClient, parseDeepLink, second-instance + open-url |
| server-supervisor | ✅ | server-supervisor.ts: full ServerSupervisor + getFreePort |
| cdp-electron-target | ✅ | cdp-session.ts: selectElectronViewTarget + electron-view branch in createOrReplaceTab (line 185) |
| supervisor-instance-dedup | ✅ | checkExistingInstance() now fully implemented (discoveryImpl + health check), NOT a stub |
| browser-pane | ✅ | browser-pane.ts createBrowserPane; index.ts bootstrap() wires it |

## Files — all exist with real implementations
- desktop/electron.vite.config.ts — main/preload/renderer roots
- desktop/src/main/index.ts — single-instance lock, deeplink, bootstrap() sets remote-debugging-port BEFORE whenReady, supervisor start, loadURL sidecar, createBrowserPane, before-quit stop
- desktop/src/preload/index.ts — minimal `mc` contextBridge
- desktop/src/main/server-supervisor.ts — ServerSupervisor class
- desktop/src/main/browser-pane.ts — createBrowserPane
- src/config.ts:92 — CDP_PORT env-configurable, NaN→9333
- src/services/cdp-session.ts:8 — imports CDP_PORT; :185 electron-view branch
- test files: server-supervisor.test.ts, cdp-session.config.test.ts, cdp-session.target.test.ts

## Functions — all present, non-stub
- ServerSupervisor.start (dedup→free port→spawn bun w/ env→waitForHealth), stop (SIGTERM/win32 taskkill, no-op when attached), isHealthy, checkExistingInstance (discoveryImpl + /api/health, returns null on no-discovery/mismatch/dead — falls through to spawn)
- getFreePort — net server on port 0
- selectElectronViewTarget — matches by url-includes-marker OR title===marker
- parseDeepLink, createBrowserPane, bootstrap — all real

## checkExistingInstance (specifically verified)
Wave 1 seam (returned null) is now genuinely implemented (server-supervisor.ts:66–87): calls discoveryImpl, matches (project, session), health-checks advertised port with 1.5s timeout, returns port only if `r.ok`, else null → spawn path. Confirmed NOT an unconditional `return null`.

## Tests
`npx vitest run` on the 3 files → **18/18 pass** (server-supervisor 11, cdp-session.target 4, cdp-session.config 3).

## Build
`cd desktop && npx electron-vite build` → clean. out/main/index.js (7.26 kB), out/preload/index.js, out/renderer/index.html.

## Stubs
grep for TODO/FIXME/'Not implemented'/throw-stubs across desktop/src + cdp-session.ts → **no matches**.

## Marker consistency
ELECTRON_VIEW_MARKER === 'mc-browser-pane' in BOTH src/services/cdp-session.ts:21 and desktop/src/main/browser-pane.ts:11. ✅ Consistent.

## Notes
- Phases 3–8 intentionally deferred per design — not in scope, not reported as gaps.
- Pane created at zero bounds (renderer layout/IPC is a later phase, R5) — matches Wave 3 summary intent.
- Wave 2 deviation (pure selectElectronViewTarget helper to bypass createRequire/vi.mock) is an improvement; behavior matches blueprint.
- GUI runtime (npm run dev launching window + live browser_* drive) not headless-testable here; recommended for manual verification.
