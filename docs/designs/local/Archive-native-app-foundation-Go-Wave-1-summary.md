# Wave 1 Implementation

## Tasks
- **desktop-shell** ✅ — Moved spikes to `desktop/spikes/`. Created `electron.vite.config.ts`, `src/main/index.ts` (single-instance lock, BrowserWindow with contextIsolation+sandbox, placeholder renderer), `src/preload/index.ts` (`mc` contextBridge stub), `src/renderer/index.html`. Updated `package.json` (name, electron-vite scripts, devDeps). Installed electron-vite + vite + typescript.
- **cdp-port-config** ✅ — Added `CDP_PORT` env-configurable export to `src/config.ts` (default 9333, NaN-safe). `src/services/cdp-session.ts` now imports + re-exports it (callers unchanged). Added `src/services/__tests__/cdp-session.config.test.ts`.

## Verification
- `cdp-session.config.test.ts`: 3/3 pass (env=4444→4444, unset→9333, invalid→9333).
- `electron-vite build`: clean — built `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html`.
- tsc: no errors in `config.ts` or `cdp-session.ts`.

## Wave TSC
clean (no errors in touched files)
