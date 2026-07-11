# Wave 3 Implementation (multi-server-watch)

## Tasks
- **watch-feed** — `ui/src/contexts/ServerContext.tsx`: added exported `WatchEvent` interface + extended `McBridge` with `setWatchedServers?(ids)` and `onWatchEvent?(cb)`. NEW `ui/src/hooks/useWatchEvents.ts`: `useEffect` subscribes `window.mc.onWatchEvent` and routes `claude_session_registered`→updateStatus(.., 'active', ..), `claude_session_status`→updateStatus(.., status, ..), `claude_context_update`→updateContextPercent(..) into `subscriptionStore`; cleanup via the returned unsubscribe; no-op without `window.mc`. `ui/src/App.tsx`: imported + called `useWatchEvents()` right after `usePrefetchWatchedSessions()`.

## Verification
- ui tsc: ServerContext + useWatchEvents + App.tsx clean.
- Passive status-only confirmed: `subscriptionStore.updateStatus` bails on unsubscribed keys, so watched-but-unsubscribed sessions are ignored.

## Wave TSC
Clean.
