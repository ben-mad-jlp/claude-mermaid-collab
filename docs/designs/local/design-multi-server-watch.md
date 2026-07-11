# Design — Multi-Server Watch Aggregation

_Branch target: `feat/native-app-foundation`. Status: design. Source: user request 2026-05-27 — "have multiple [servers] selected at once and show all the watching together from different servers."_

## Context
The desktop app connects its main UI to **one** server (the active server, via the main-process proxy — single origin). The "Watching" card therefore only reflects `claude_session_*` events from that one server. The user wants to **aggregate live session status from several servers at once** into a single Watching card — e.g. watch the plugin hub (`:9002`), a remote machine, and the app's own sidecar simultaneously.

This is cross-server **federation for watching only** (read-only status aggregation) — explicitly NOT making the whole UI multi-server (editing/browser/terminal still target the single connected server).

### Decisions (locked)
- **Two distinct concepts:** the **connected server** (single; drives UI via the proxy) vs the **watch set** (multi; feeds the Watching card). They're independent — you can watch servers you aren't connected to.
- **Aggregation in the Electron main process.** Main can open `ws://` to any localhost/LAN server with no CORS; it forwards `claude_session_*` events to the renderer over IPC. (The renderer can't cross-origin-WS to other servers — that's the whole reason the proxy exists.)
- **Reuse `subscriptionStore`** — it already merges by `project:session` key, so events from N servers naturally coalesce into one card. No data-model change.
- Watch-set is **persisted** (localStorage / ConnectionStore) and survives relaunch.

## Current state (grounded in code)
| Piece | Today | File |
|------|-------|------|
| Watching card | `SubscriptionsPanel`, backed by `subscriptionStore` (keyed `project:session`) | `ui/src/components/layout/SubscriptionsPanel.tsx`, `ui/src/stores/subscriptionStore.ts` |
| Status feed | single shared WS (`ws://<location.host>/ws` → proxy → active server) → `App.tsx:916-941` → `subscriptionStore.updateStatus/updateContextPercent` | `ui/src/lib/websocket.ts`, `ui/src/App.tsx` |
| Server broadcasts | `claude_session_registered/status/context_update` from `api.ts:2359/2414/2456` | `src/routes/api.ts`, `src/websocket/handler.ts:55-57` |
| Server list + tokens | `ConnectionStore` (host/port/token, label, source) + switcher | `desktop/src/main/connection-store.ts`, `ui/src/components/ServerSwitcher.tsx` |
| `ws` lib in main | already a dependency (used by `server-proxy.ts`) | `desktop/package.json` |

## Target architecture

### Main — `WatchAggregator` (new, `desktop/src/main/watch-aggregator.ts`)
- `setWatched(servers: Array<{ id; host; port; token? }>)`: diff against current connections; open a `ws` to each new server's `ws://host:port/ws` (header `Authorization: Bearer <token>` when present); close removed ones.
- On each socket: parse JSON frames; forward only `claude_session_registered | claude_session_status | claude_context_update` to the renderer via `mainWindow.webContents.send('mc:watch-event', evt)`. Tag each event with its `serverId` (for future per-server UI; subscriptionStore keys on project:session regardless).
- **Reconnect** with backoff (a watched server may be offline / come up later). Cap backoff (~15s).
- Lifecycle: close all sockets on `before-quit`; idempotent `setWatched`.
- Dedup: if the connected server is also in the watch set, its events arrive both via the proxied UI WS and the aggregator — harmless because `updateStatus` is keyed + idempotent.

### Preload — `desktop/src/preload/index.ts`
- `mc.setWatchedServers(ids: string[])` → IPC `mc:setWatchedServers` (main resolves ids → {host,port,token} from ConnectionStore, calls aggregator.setWatched).
- `mc.onWatchEvent(cb)` → `ipcRenderer.on('mc:watch-event', (_e, evt) => cb(evt))`; return an unsubscribe.

### Renderer
- New hook/effect (e.g. in `App.tsx` or a small `useWatchAggregator()`): subscribe via `mc.onWatchEvent` and dispatch into `subscriptionStore` using the SAME logic as the existing `claude_session_*` handlers (registered→active, status, context). No-op when `window.mc` absent.
- **Watch-set state** (`watchStore` or extend `ServerContext`): `watchedIds: string[]`, `toggleWatched(id)`, persisted (localStorage). On change → `mc.setWatchedServers(watchedIds)`.

### UI — `ServerSwitcher`
- Each server row gets a small **👁 watch toggle** (independent of the ✓ active radio). Highlighted when in the watch set. Header could show a count ("watching 3").
- Active selection (click label) unchanged; watch toggle is additive.

## Waves (for blueprint)
- **W1:** `watch-aggregator` (main ws multiplexer + reconnect) · `watch-store` (renderer persisted watch-set). _Parallel._
- **W2:** `watch-ipc` (preload setWatchedServers/onWatchEvent + main IPC resolving ids→creds via ConnectionStore, wire aggregator + before-quit close) ←watch-aggregator · `watch-feed` (renderer hook → subscriptionStore) ←watch-store.
- **W3:** `switcher-multiselect` (👁 toggles + count) ←watch-store, watch-ipc.

## Risks / open details
- **Token availability:** the aggregator needs each watched server's token. Tokens live in ConnectionStore (not exposed to the renderer). So id→creds resolution happens in **main** (renderer sends ids only). Good — tokens never cross to renderer.
- **Cross-server key collision:** two servers with the same `project:session` would merge into one card entry (last-write-wins). Accepted (rare; same logical session). The `serverId` tag enables disambiguation later if needed.
- **Offline watched server:** reconnect-with-backoff; show its switcher dot as offline (probing already added).
- **Event volume / churn:** status updates are low-frequency; no batching needed.
- **subscriptionStore is localStorage-backed manual subscriptions.** DECIDED: **passive status-only** — aggregated events update ONLY sessions the user has already subscribed to; they do NOT auto-add new rows for sessions merely seen on a watched server. So the `watch-feed` hook calls `updateStatus`/`updateContextPercent` (which no-op on unknown keys) but never creates subscriptions. Implication: `updateStatus` must NOT create a row for unsubscribed keys. **VERIFIED already true** — `subscriptionStore.updateStatus` opens with `if (!existing) return state;` (it only updates subscribed rows). So the `watch-feed` hook can call `updateStatus`/`updateContextPercent` directly with no extra guard; watched-but-unsubscribed sessions are ignored for free.

## Verification
- Two servers running (e.g. `:9002` plugin hub + a second `bun run src/server.ts` on another port), a Claude session reporting to each.
- Watch both in the switcher → the Watching card shows sessions from both, with live status/context updates, regardless of which one is the connected server.
- Unwatch one → its sessions stop updating; sockets closed (no leak). Relaunch → watch-set persists.
- `scripts/debug-app.sh` + `app-debug.ts eval` to drive; confirm `mc.setWatchedServers` opens/closes main sockets.
