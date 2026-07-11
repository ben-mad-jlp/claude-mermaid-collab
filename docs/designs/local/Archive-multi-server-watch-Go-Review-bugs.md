# Bug Review — multi-server-watch (working tree vs d1fc80e)

Scope: introduced correctness bugs only.

## Bug 1 — Old WebSocket leaked + double-forward on reconnect (Important)
File: `desktop/src/main/watch-aggregator.ts:22-33` (`connect`)

What's wrong: On reconnect, the timer (line 40) calls `connect(s)` again. Line 26
`this.conns.set(s.id, { ws: NEW, ... })` overwrites the map entry but the PREVIOUS
ws is never `terminate()`d and its 4 listeners (`open`/`message`/`close`/`error`)
are never removed. The only paths into `connect()` are (a) `setWatched` guarded by
`!this.conns.has(s.id)` and (b) the reconnect timer — so the overwrite always
happens against a dead/dying socket from the timer path.

Why it matters:
- A half-open / still-live old socket keeps its `message` listener attached and
  will continue calling `this.forward({...m, serverId: s.id})` → duplicate events
  forwarded to the renderer (double status/context updates).
- A late `close`/`error` from the stale old ws calls `scheduleReconnect(s)`, which
  reads the NEW `conns.get(s.id)` state → spurious `attempt++` / reconnect churn
  (timer guard prevents a duplicate timer, but the attempt counter is polluted).

Fix: before replacing the connection, tear down the old socket. At the top of
`connect()`:
```ts
const prev = this.conns.get(s.id);
if (prev) { try { prev.ws.removeAllListeners(); prev.ws.terminate(); } catch {} }
```
(then keep `prevAttempt = prev?.attempt ?? 0`). This guarantees exactly one live
socket and one listener set per server id.

## Non-bugs verified
- `index.ts mc:setWatchedServers`: `store.get(id)` returns `ServerEntry` with
  `{ id, host, port, token }`; `.filter(Boolean)` drops nulls for unknown ids.
  Mapping shape is correct. OK.
- `disconnect(id)`: clears pending timer, terminates ws, adds to `removed`,
  deletes from map. A reconnect timer scheduled before disconnect is cleared
  (line 46) AND guarded by `removed.has` inside the timer callback. Re-watch via
  `setWatched`→`connect` does `removed.delete(id)` (line 23). OK.
- `scheduleReconnect` timer guard (`state.timer !== null`) prevents duplicate
  timers when both `close` and `error` fire on a failed connect. OK.
- `useWatchEvents`: `[]` deps capture `window.mc` once (set at preload, stable);
  `unsub` (the removeListener closure from preload) is returned from the effect.
  OK. The `!` assertions are TS-only; `updateStatus`/`updateContextPercent` guard
  on missing subscription (`if (!existing) return state`) so undefined fields
  cannot crash. OK.
- `ServerSwitcher`: 👁 onClick has `e.stopPropagation()`; `watchedIds` read via
  zustand selector → reactive re-render. OK.
- `watchStore`: localStorage write precedes mc push in both `toggleWatched`/
  `setWatched`; `mc()?.setWatchedServers?.()` optional-chained for browser tab.
  OK.
- `preload onWatchEvent`: returns a working `removeListener` unsub. OK.
