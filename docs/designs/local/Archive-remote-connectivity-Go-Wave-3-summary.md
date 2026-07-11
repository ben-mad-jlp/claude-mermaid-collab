# Wave 3 Implementation (remote-connectivity)

## Tasks
- **main-ipc-wiring** ✅ — `desktop/src/main/index.ts`: bootstrap now starts a `ServerProxy`, points it at the local sidecar (`setUpstream({host:'127.0.0.1', port})`), creates + `init()`s + `refreshLocal()`s a `ConnectionStore`, registers `mc:*` IPC handlers (listServers/getActiveServer/addServer/removeServer/switchServer — switch repoints the proxy upstream), and loads the renderer through the **proxy URL** instead of the sidecar directly. `before-quit` stops the proxy + supervisor. `desktop/src/preload/index.ts`: expanded the `mc` bridge with the five IPC methods (tokens never cross the bridge).

## Verification
- `electron-vite build`: clean — main bundle 126 kB (bundles ws + proxy + store).
- **Runtime smoke** (`MC_REPO_ROOT=… electron out/main/index.js`): logs `sidecar spawned on 58857` + `proxy on 58863 → sidecar 58857`; `curl` to the PROXY port `/api/health` returns the sidecar health (HTTP 200) → HTTP forwarding works; `websocket connections: 1` → the renderer connected back through the proxy's WS forwarding (WS proxying works end-to-end).

## Wave TSC
clean (only the pre-existing binding-sweeper.ts import-extension warning)
