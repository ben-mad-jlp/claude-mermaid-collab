# Completeness Review — multi-server-watch

## Verdict: Implementation complete. End-to-end chain connects. 0 functional gaps. 2 test-coverage gaps (one notable).

## Tasks (5/5 implemented)
- watch-aggregator — DONE. `desktop/src/main/watch-aggregator.ts`
- watch-store — DONE. `ui/src/stores/watchStore.ts`
- watch-ipc — DONE. `desktop/src/main/index.ts` + `desktop/src/preload/index.ts`
- switcher-multiselect — DONE. `ui/src/components/ServerSwitcher.tsx`
- watch-feed — DONE. `ui/src/hooks/useWatchEvents.ts` + `ui/src/App.tsx` + `ui/src/contexts/ServerContext.tsx`

## Files exist, real (non-stub) implementations
All new + modified files present. No TODO / "Not implemented" / throw-stubs in any new file (grep clean).

## Function Blueprints — all present & non-stub
- WatchAggregator: `setWatched` (diff: disconnect removed, connect added, leave unchanged ✓), `connect` (ws://host:port/ws + Bearer header ✓, claude_session_* filter + `{...m, serverId}` forward ✓), `scheduleReconnect` (backoff `min(15000, 1000*2^attempt)`, guarded by `removed` set ✓), `disconnect`, `stop`. Plus the blueprint-noted `open`→reset-attempt robustness fix.
- watchStore: `toggleWatched`/`setWatched`/`isWatched`, persisted to localStorage `watched-servers`, pushes id list to `window.mc?.setWatchedServers?.` (no-op without mc ✓).
- useWatchEvents: subscribes `mc.onWatchEvent`, switch over 3 types into subscriptionStore, cleanup via returned unsub, no-op without window.mc. Mapping matches App.tsx:918-943 exactly (registered→updateStatus active, status→updateStatus, context_update→updateContextPercent).
- IPC `mc:setWatchedServers`: resolves ids→creds via `store.get(id)` → `{id,host,port,token}` → `aggregator.setWatched(ups)`. Tokens resolved in main only, never sent to renderer ✓.
- preload: `setWatchedServers(ids)` (invoke) + `onWatchEvent(cb)` (on + returns removeListener unsub) ✓.
- ServerSwitcher: per-row 👁 toggle with `e.stopPropagation()` calling `toggleWatched`, opacity reflects watched state, header `👁 N` count badge ✓.
- ServerContext McBridge: `WatchEvent` interface (with status/contextPercent/claudeSessionId/claudePid optional fields) + `setWatchedServers?`/`onWatchEvent?` ✓.

## Acceptance — chain connects (no broken link)
👁 toggle (ServerSwitcher:88) → watchStore.toggleWatched (push next ids) → mc.setWatchedServers → preload invoke `mc:setWatchedServers` → main resolves creds via ConnectionStore.get (ServerEntry has id/host/port/token) → aggregator.setWatched → ws per server → claude_session_* filtered + forwarded with serverId → `mainWindow.webContents.send('mc:watch-event')` → preload onWatchEvent cb → useWatchEvents switch → subscriptionStore.updateStatus/updateContextPercent (signatures match call sites). Mounted once in App.tsx:282. before-quit calls `aggregator?.stop()`.
Type shapes consistent end-to-end (claudeSessionId/status/contextPercent optional in WatchEvent, used with `!` in hook).

## Test coverage
- watch-ipc, switcher-multiselect, watch-feed marked `tests: []` in blueprint → no tests = EXPECTED, not a gap.
- watchStore: blueprint task graph specified `tests: [ui/src/stores/__tests__/watchStore.test.ts]` — MISSING. Minor (pure store logic).
- **NOTABLE GAP: watch-aggregator** — blueprint specified `tests: [desktop/src/main/__tests__/watch-aggregator.test.ts]` and a detailed test strategy (fake/local ws; assert only claude_session_* forwarded with serverId, removed id closes socket, diff doesn't reconnect unchanged). This file does NOT exist. The most logic-heavy component (diff/reconnect/backoff/teardown) has ZERO automated coverage. Wave 1 summary verified it only via tsc + manual semantic read.

## Summary
Functionally complete and fully wired. The only deviations from the blueprint are two missing test files that the task graph DID specify: `watchStore.test.ts` (minor) and `watch-aggregator.test.ts` (notable — critical logic uncovered).
