# Blueprint: Multi-Server Watch Aggregation

## Source Artifacts
- `design-multi-server-watch` (connected-vs-watch-set split; main-process aggregator; passive status-only)

## 1. Structure Summary

### Files
- [ ] `desktop/src/main/watch-aggregator.ts` — NEW. `WatchAggregator`: holds a set of watched upstreams, opens a `ws` per server, filters `claude_session_*` frames, forwards via an injected callback. Reconnect w/ backoff.
- [ ] `desktop/src/main/index.ts` — MOD. Instantiate `WatchAggregator` (forward → `mainWindow.webContents.send('mc:watch-event', evt)`); IPC `mc:setWatchedServers` (resolve ids→creds via `ConnectionStore.get`, call `aggregator.setWatched`); `before-quit` → `aggregator.stop()`.
- [ ] `desktop/src/preload/index.ts` — MOD. `mc.setWatchedServers(ids)` + `mc.onWatchEvent(cb)` (returns unsubscribe).
- [ ] `ui/src/stores/watchStore.ts` — NEW. Persisted `watchedIds: string[]` + `toggleWatched(id)` / `isWatched(id)`; on change, push to `window.mc?.setWatchedServers`.
- [ ] `ui/src/hooks/useWatchEvents.ts` — NEW. Subscribe `mc.onWatchEvent` → dispatch into `subscriptionStore`; mounted once in `App.tsx`.
- [ ] `ui/src/App.tsx` — MOD. Mount `useWatchEvents()`.
- [ ] `ui/src/contexts/ServerContext.tsx` — MOD. Extend `McBridge` type: `setWatchedServers?`, `onWatchEvent?`.
- [ ] `ui/src/components/ServerSwitcher.tsx` — MOD. 👁 watch toggle per row (wired to `watchStore`), independent of the ✓ active selection; header count.

### Type Definitions
- `WatchUpstream = { id: string; host: string; port: number; token?: string }`
- `WatchEvent = { serverId: string; type: 'claude_session_registered'|'claude_session_status'|'claude_context_update'; project: string; session: string; [k:string]: unknown }`
- `McBridge += { setWatchedServers?(ids: string[]): Promise<void>; onWatchEvent?(cb: (e: WatchEvent) => void): () => void }`

### Component Interactions
```
ServerSwitcher 👁 → watchStore.toggleWatched → mc.setWatchedServers(ids)
   → main: resolve ids→creds (ConnectionStore) → WatchAggregator.setWatched
   → ws per server → claude_session_* → webContents.send('mc:watch-event')
   → useWatchEvents → subscriptionStore.updateStatus/updateContextPercent (no-ops on unsubscribed keys)
   → SubscriptionsPanel renders merged live status
```

---

## 2. Function Blueprints

### `WatchAggregator` (main)
**`constructor(forward: (e: WatchEvent) => void)`** — store the forward sink.
**`setWatched(servers: WatchUpstream[]): void`**
1. Diff incoming ids vs current connections.
2. For removed ids → close + delete their socket/state.
3. For added ids → `connect(server)`.
4. For unchanged → leave as-is (don't churn live sockets).
**`private connect(s: WatchUpstream)`**
1. `const ws = new WebSocket(\`ws://${s.host}:${s.port}/ws\`, s.token ? { headers: { authorization: \`Bearer ${s.token}\` } } : undefined)`.
2. `ws.on('message', raw => { try { const m = JSON.parse(raw.toString()); if (WATCHED_TYPES.has(m.type)) this.forward({ ...m, serverId: s.id }); } catch {} })`.
3. `ws.on('close'|'error', () => scheduleReconnect(s))` — backoff `min(15000, 1000 * 2^attempt)`, unless the id was removed.
4. Track `{ ws, attempt, timer }` per id; clear timer on close.
**`stop()`** — close all sockets, clear all timers.
**Error handling:** all socket errors → schedule reconnect (never throw to caller). JSON parse failures ignored.
**Edge cases:** server offline at watch time (reconnect picks it up when it boots); same id re-added while reconnecting (dedupe by id); rapid setWatched calls (diff is idempotent).
**Test strategy:** inject a fake WebSocket (or use a real local `ws` server in-test); assert: only `claude_session_*` forwarded with `serverId`; removed id closes its socket; setWatched diff doesn't reconnect unchanged ids.

### `watchStore` (renderer)
**State:** `{ watchedIds: string[] }` seeded from `localStorage['watched-servers']`.
**`toggleWatched(id)`** → flip membership, persist, then `void window.mc?.setWatchedServers?.(next)`.
**`setWatched(ids)`** / **`isWatched(id)`** helpers.
**Edge:** no-op push when `window.mc` absent (web).
**Test:** toggle adds/removes + persists; pushes the new id list to a mocked `mc.setWatchedServers`.

### `useWatchEvents()` (renderer hook)
1. `useEffect`: if no `window.mc?.onWatchEvent`, return.
2. `const off = mc.onWatchEvent(e => { switch(e.type){ registered→updateStatus(.., 'active', ..); status→updateStatus(.., e.status, ..); context_update→updateContextPercent(..) } })` — reuse the exact mapping from `App.tsx:916-941`.
3. cleanup → `off()`.
**Note:** `subscriptionStore.updateStatus` already bails on unsubscribed keys (`if(!existing) return state`) → passive status-only for free.
**Test:** covered indirectly; optional.

### IPC wiring (`index.ts`)
**`mc:setWatchedServers(ids: string[])`** → `const ups = ids.map(id => store.get(id)).filter(Boolean).map(e => ({ id: e.id, host: e.host, port: e.port, token: e.token })); aggregator.setWatched(ups)`. Tokens resolved here (never sent to renderer).
**forward sink** = `(e) => mainWindow?.webContents.send('mc:watch-event', e)`.
**`before-quit`** → `aggregator.stop()`.

### `ServerSwitcher` 👁 toggle
- Per row: a small eye button; filled/highlighted when `useWatchStore.isWatched(s.id)`; onClick `toggleWatched(s.id)` (stopPropagation so it doesn't switch active).
- Header/button: optional "watching N" when `watchedIds.length > 0`.
**Test:** optional (UI).

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: watch-aggregator
    files: [desktop/src/main/watch-aggregator.ts]
    tests: [desktop/src/main/__tests__/watch-aggregator.test.ts]
    description: "Main-process WS multiplexer: per-server ws, filter claude_session_* frames, forward with serverId, reconnect with backoff, setWatched diff, stop()."
    parallel: true
    depends-on: []
  - id: watch-store
    files: [ui/src/stores/watchStore.ts]
    tests: [ui/src/stores/__tests__/watchStore.test.ts]
    description: "Persisted watch-set (watchedIds) + toggleWatched/isWatched; pushes id list to window.mc.setWatchedServers; no-op without mc."
    parallel: true
    depends-on: []
  - id: watch-ipc
    files: [desktop/src/preload/index.ts, desktop/src/main/index.ts]
    tests: []
    description: "preload setWatchedServers/onWatchEvent; main: instantiate WatchAggregator (forward→webContents.send mc:watch-event), IPC mc:setWatchedServers resolving ids→creds via ConnectionStore, before-quit stop()."
    parallel: false
    depends-on: [watch-aggregator]
  - id: watch-feed
    files: [ui/src/hooks/useWatchEvents.ts, ui/src/App.tsx, ui/src/contexts/ServerContext.tsx]
    tests: []
    description: "McBridge type (setWatchedServers/onWatchEvent); useWatchEvents hook subscribes mc.onWatchEvent → subscriptionStore (passive, reuses App.tsx mapping); mount in App.tsx."
    parallel: false
    depends-on: [watch-store, watch-ipc]
  - id: switcher-multiselect
    files: [ui/src/components/ServerSwitcher.tsx]
    tests: []
    description: "Per-row 👁 watch toggle wired to watchStore (independent of active ✓), stopPropagation; optional 'watching N' count."
    parallel: false
    depends-on: [watch-store]
```

### Execution Waves
**Wave 1 (parallel):** watch-aggregator, watch-store
**Wave 2 (depends on Wave 1):** watch-ipc (←watch-aggregator)
**Wave 3 (depends on Wave 2):** watch-feed (←watch-store, watch-ipc), switcher-multiselect (←watch-store)

### Summary
- Total tasks: 5
- Total waves: 3
- Max parallelism: 2
