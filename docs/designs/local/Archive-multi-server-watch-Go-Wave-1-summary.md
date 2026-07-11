# Wave 1 Implementation (multi-server-watch)

## Tasks
- **watch-aggregator** — NEW `desktop/src/main/watch-aggregator.ts`: `WatchAggregator(forward)` with `setWatched(servers)` (diff: close removed, connect added, leave unchanged), per-server `ws` (`ws` npm pkg, `new WebSocket(ws://host:port/ws, {headers:{authorization}})`), message filter to `claude_session_*` → `forward({...m, serverId})`, exponential reconnect backoff (1s→15s cap) guarded by a `removed` set, `disconnect`/`stop` teardown. Added an `'open'` handler that resets `attempt=0` so repeated blips don't stick at the 15s cap.
- **watch-store** — NEW `ui/src/stores/watchStore.ts`: zustand `useWatchStore` with persisted `watchedIds` (localStorage `watched-servers`), `toggleWatched`/`setWatched` (push id list to `window.mc?.setWatchedServers`, no-op without mc), `isWatched`. Matches browserStore/terminalStore conventions.

## Verification
- desktop tsc: watch-aggregator clean.
- ui tsc: watchStore clean.
- Semantic review of aggregator (read by main agent): diff/reconnect/teardown correct; added open→reset-attempt robustness fix.

## Wave TSC
Both new files clean in their packages.
