# Research — Cross-Server Unified Watching

_Goal: enable a single "Watching" list that shows sessions from multiple servers concurrently, decoupled from "active server" selection._

## 1. Architecture summary (current state)

### Main process

- **`desktop/src/main/connection-store.ts`** — persisted server list.
  - `ServerEntry` shape: `{ id, label, host, port, token?, status, lastProject?, lastSession?, source: 'local'|'manual' }` (lines 18–28).
  - Single global `activeId: string | null` (line 53). `setActive(id)` / `getActive()` (lines 129–138).
  - Tokens encrypted via `safeStorage`; `list()` strips tokens before exposing to renderer (line 97).

- **`desktop/src/main/watch-aggregator.ts`** — **already multi-server**, read in full.
  - Public interface: `setWatched(servers: WatchUpstream[])` (line 16), `stop()` (line 59), ctor takes `forward: (e: WatchEvent) => void`.
  - `WatchUpstream = { id, host, port, token? }`; `WatchEvent = { serverId, type, project, session, ... }` (lines 3–4).
  - Opens one independent `ws://{host}:{port}/ws` per server (line 33), forwards only `claude_session_registered | claude_session_status | claude_context_update` (line 6), tags each event with `serverId` (line 38).
  - Reconnect with exponential backoff capped at 15s (line 47); idempotent diff in `setWatched` (lines 17–19).

- **`desktop/src/main/server-proxy.ts`** — **single-upstream** loopback HTTP+WS proxy.
  - `setUpstream(u)` (line 36) terminates all open client/upstream WS pairs so renderer reconnects to the new upstream. All renderer `/api/*` and `/ws` traffic flows through this one proxy. Does NOT participate in cross-server watching.

- **`desktop/src/main/index.ts`** — wires it together.
  - `mc:switchServer` (lines 34–41): writes `store.setActive(id)` AND `proxy.setUpstream(...)` — repointing the renderer-visible origin.
  - `mc:setWatchedServers` (lines 62–66): resolves ids → `{ id, host, port, token }` from `store` and calls `aggregator.setWatched()`. Tokens never cross IPC.
  - Aggregator pushes events to renderer via `mainWindow.webContents.send('mc:watch-event', e)` (line 215).

### Preload (`desktop/src/preload/index.ts`)
- `mc.setWatchedServers(ids)` (line 15), `mc.onWatchEvent(cb)` (lines 16–20). Plus `listServers / getActiveServer / switchServer / addServer / removeServer / probeServer`.

### Renderer

- **`ui/src/contexts/ServerContext.tsx`** — single `activeId` (line 76); `switchServer()` calls `mc.switchServer`, resets the WS singleton via `resetWebSocketClient()`, bumps `version` to remount the subtree (lines 114–124). Global "active server" only.

- **`ui/src/stores/watchStore.ts`** — `watchedIds: string[]` (line 7), persisted to localStorage key `watched-servers`. `toggleWatched`/`setWatched` push to `mc.setWatchedServers` (lines 24, 30). **This is the per-server watch toggle.**

- **`ui/src/components/ServerSwitcher.tsx`** — each row in the dropdown has TWO controls:
  - Checkbox bound to `useWatchStore.toggleWatched(s.id)` (lines 79–85) — server-level watch.
  - Label-button → `switchServer(s.id)` (line 89) — sets active server.
  - So "watching" and "active" are already orthogonal at the UI layer.

- **`ui/src/hooks/useWatchEvents.ts`** — bridges `mc.onWatchEvent` into `subscriptionStore.updateStatus / updateContextPercent` (lines 14–28). Mounted from `App.tsx:283`. **Discards `e.serverId`** — only `(project, session)` flow through.

- **`ui/src/stores/subscriptionStore.ts`** — the Watching list itself.
  - `SubscribedSession = { project, session, claudeSessionId?, claudePid?, status, lastUpdate, contextPercent? }` (lines 4–12) — **NO `serverId`**.
  - Keyed by `${project}:${session}` (line 39). Two servers with the same `project:session` collide into one row.
  - Persisted to localStorage (`session-subscriptions`).
  - `updateStatus` early-returns if key doesn't exist (line 84): events for non-subscribed sessions are silently dropped. So subscriptions are "passive" — aggregator events only update already-subscribed rows.

- **`ui/src/components/layout/SubscriptionsPanel.tsx`** — renders the Watching list.
  - Source: `useSubscriptionStore()` directly (line 285); no server filter (line 294–299).
  - Subscribe modal pulls from `useSessionStore().sessions` (line 286, 332) — sessions of the **active server only** (sessions are fetched through the proxied origin).
  - Row click handler (lines 182–196): calls `setCurrentSession`, then relative-URL fetches `/api/ide/create-terminal`, `/api/browser/focus-tab` — all hit the **active server** through the proxy, regardless of which server the watched session actually lives on.

### Iframe / preview routing
- The renderer is a single-origin app loaded from `http://127.0.0.1:{proxyPort}` (`index.ts:218`). All clicks → relative URLs → proxy → **active server**. There is no per-row server-aware routing today.

## 2. The exact UX gap

> Today, the user can already check the watch boxes for `trimaxion` AND `local` in the server switcher — the main-process `WatchAggregator` will open WebSockets to both, and `claude_session_*` events from both will be forwarded into `subscriptionStore`. **But:**
>
> 1. The subscribe modal (`SubscriptionsPanel` line 332) only lists sessions of the **currently active server** (those known to `sessionStore`). You can only add a `(project, session)` to the watch list if it lives on the active server. To watch a `trimaxion` session you'd have to first switch active to `trimaxion`, subscribe, then switch back.
> 2. Even after subscribing, `subscriptionStore` keys by `(project, session)` only — no `serverId`. Events from both servers update the SAME row; if two servers happen to host the same `(project, session)` they collide (last-write-wins).
> 3. Row interactions (click-to-open terminal, focus browser, navigate to session) all fire relative-URL fetches that go to whatever the active server is. A `trimaxion` session row in the list, clicked while connected to `local`, would silently target the wrong server.
> 4. There is no server label on the row, so the user can't tell which server a watched session lives on.

So the multi-server WS plumbing is in place; the **data model and UI are still mono-server**.

## 3. Change surface

### Data-model changes
- **`SubscribedSession`** (`ui/src/stores/subscriptionStore.ts:4`): add `serverId: string` (required for new entries). Composite key becomes `${serverId}:${project}:${session}`.
- **localStorage migration**: existing keys `${project}:${session}` need a one-time rewrite. Options:
  - (a) Tag all existing entries with the current active server's `id` at load time and rewrite keys (safest; preserves existing watches).
  - (b) Drop the legacy entries (acceptable — user just re-subscribes).
- `subscribe(project, session)` signature must become `subscribe(serverId, project, session)`.
- `updateStatus` / `updateContextPercent` need `serverId` parameters and must look up the new composite key. `useWatchEvents.ts:14` already receives `e.serverId` — just forward it.

### Main-process changes
- **Almost nothing.** `WatchAggregator` is already multi-server. The aggregator is currently driven by `useWatchStore.watchedIds` (server-level opt-in). For true unified watching, you may want to instead derive the watched-server set from the **union of `serverId`s present in `subscriptionStore`** — so as soon as a session from server X is subscribed, the aggregator auto-opens X's WS, regardless of any "watch this whole server" checkbox.
  - That means `mc.setWatchedServers(ids)` should be called with `unique(subscriptions.map(s => s.serverId))` instead of (or in addition to) the manual `watchStore.watchedIds`.
  - Keeps server-level "watch everything from this server" as an optional power-user mode, but per-session subscriptions become first-class.
- Optional: a new IPC `mc:listSessionsForServer(serverId)` that has the main process fetch `http://{host}:{port}/api/sessions` directly so the subscribe modal can offer sessions from any known server, not just the active one. Currently the renderer can only see sessions from the proxied (active) server.

### UI changes
- **`SubscriptionsPanel.tsx`**:
  - Subscribe modal (`availableSessions`, lines 328–343): replace single-server `useSessionStore` source with a cross-server list. Either (a) fan out `mc:listSessionsForServer` over `servers` from `ServerContext` and merge, or (b) keep a renderer-side `crossServerSessionsStore` populated by the main process. Group by server in the modal.
  - Row rendering (lines 224–229): add a small server-label chip (use `servers.find(s => s.id === sub.serverId)?.label`). The roadmap design doc already calls this out.
  - Row click handler (lines 182–196): for off-active-server rows, either (a) auto-switch active server then perform the action, or (b) issue the action via a new main-process route that targets the correct server's host:port directly. Cleanest: a `mc.invokeOnServer(serverId, path, body)` IPC so terminal / browser-focus actions don't depend on which server is active.
  - `useSessionStore` lookup in `handleNavigate` (lines 345–356) also needs to be cross-server aware.

- **`ServerSwitcher.tsx`**: existing per-server watch checkbox can remain as a "watch all sessions from this server" power-toggle, or be removed in favor of per-session subscription only. (Recommendation: remove if going full per-session — simpler mental model.)

- **`ServerContext.tsx`**: no change needed for the watch feature, but `switchServer`'s subtree-remount-via-`key={version}` (line 151) should NOT blow away the cross-server watching state. `subscriptionStore` is a zustand singleton outside the subtree, so it survives — verified. But any per-row data fetched against the active server (e.g. tmux session presence on line 287) IS cleared. Acceptable; tmux probing should probably also become server-scoped.

### Per-row server label
- Add `serverLabel?: string` derived from `useServer().servers` in `SubscriptionsPanel.tsx` and render a `<span>` chip in the row metadata block (around line 226).

### Migration of existing watched entries
- One-time on `subscriptionStore` rehydrate (line 28): if any keys lack a leading `${serverId}:`, tag them with the current `activeId` (fetched via `mc.getActiveServer()` at app boot before the store hydrates) and rewrite. Alternative: just clear `session-subscriptions` localStorage and force re-subscribe.

## 4. Trickiest parts / open questions

1. **Subscribe-from-non-active-server data path.** Today `sessionStore.sessions` is populated by the active server only. Cross-server subscribe needs either (a) main-process fan-out fetch (new IPC), or (b) accept that you can only subscribe to a server's sessions while connected to it (still useful — once subscribed, the entry persists and aggregator keeps it updated even after you switch away).
2. **Action routing for off-active-server rows.** Clicking a `trimaxion` row while connected to `local` currently fires `/api/ide/create-terminal` against `local` — wrong server. Need either auto-switch-on-click, or per-server IPC for these actions. Auto-switch is simpler but defeats the point of unified watching (you'd be constantly toggling).
3. **Subscription-driven vs explicit-watch-set aggregator.** Two viable models: (a) per-session subscriptions implicitly drive which servers the aggregator connects to; (b) keep the explicit `watchStore.watchedIds` server-level toggle and let users subscribe-without-watching (events drop on the floor). Recommend (a); simpler UX, no orphan subscriptions.
4. **Collision semantics** when two servers expose the same `(project, session)` name. Composite key fixes it but introduces two rows that look identical except for the server chip — fine, but worth confirming the user wants that.
5. **`ServerSwitcher` remount on `switchServer`** (line 121, `setVersion`) blows away the subtree — the Watching panel re-renders, but `subscriptionStore` survives (singleton). Confirm no transient flicker.
6. **Tokens for newly-watched-but-not-active servers.** Already handled — main resolves ids → tokens from `ConnectionStore`; tokens never enter the renderer.
