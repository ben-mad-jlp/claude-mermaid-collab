# Wave 2 Implementation

## Tasks
- **server-supervisor** ✅ — Created `desktop/src/main/server-supervisor.ts`: `ServerSupervisor` class (spawn `bun run src/server.ts` with PORT/HOST/MERMAID_PROJECT/MERMAID_SESSION/MERMAID_BIND_HOST + conditional CDP_PORT/MC_BROWSER_TARGET/MERMAID_AUTH_TOKEN), `getFreePort`, health polling, `stop()` (SIGTERM + Windows taskkill), `isHealthy()`. Injectable `spawnImpl`/`fetchImpl` + `healthTimeoutMs`/`healthPollMs` for tests. `checkExistingInstance()` is a seam (returns null) for the dedup task. Added `desktop/src/main/__tests__/server-supervisor.test.ts` (7 tests). Added `desktop/src/**/*.test.ts` to root `vitest.config.ts`.
- **cdp-electron-target** ✅ — Added `ELECTRON_VIEW_MARKER = 'mc-browser-pane'` + pure `selectElectronViewTarget(tabs)` helper to `src/services/cdp-session.ts`; `createOrReplaceTab` now branches on `MC_BROWSER_TARGET==='electron-view'` → `CDP.List` + select marked view, never `Target.createTarget`. Default path unchanged. Added `src/services/__tests__/cdp-session.target.test.ts` (4 tests). Diagram: `Implementing/Go/Wave 2/cdp-electron-target/cdp-session.ts`.
- **desktop-deeplink** ✅ — `desktop/src/main/index.ts`: `setAsDefaultProtocolClient('mermaid-collab')`, `parseDeepLink()`, `second-instance` (focus + parse argv), macOS `open-url` handler. Diagram: `Implementing/Go/Wave 2/desktop-deeplink/index.ts`.

## Verification
- Tests: 14/14 pass (server-supervisor 7, cdp-session.target 4, cdp-session.config 3).
- `electron-vite build`: clean (covers deeplink edit).
- tsc: no errors in `cdp-session.ts` / `config.ts`.

## Note (test infra)
- `cdp-session.ts` loads chrome-remote-interface via `createRequire`, which bypasses `vi.mock`. Resolved by extracting the marker-matching as the pure `selectElectronViewTarget` helper and testing it directly (no live CDP needed). The implement-vs-spec deviation is an improvement (more testable), behavior matches the blueprint.

## Wave TSC
clean
