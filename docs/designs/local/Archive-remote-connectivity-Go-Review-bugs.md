# Bug Review (remote-connectivity)

Scope: introduced correctness bugs only (not design/style). Reviewed the new auth/proxy/connection-store/context/switcher code and the modified server/config/index/preload/api files.

## Critical

### 1. WS proxy converts text frames to binary — breaks all collab/terminal messages
`desktop/src/main/server-proxy.ts:96-97`
```js
client.on('message', (data) => { if (upConn.readyState === WebSocket.OPEN) upConn.send(data); });
upConn.on('message', (data) => { if (client.readyState === WebSocket.OPEN) client.send(data); });
```
In `ws` v8 (8.21.0 installed), the `message` event delivers `(data: Buffer, isBinary: boolean)` and `data` is ALWAYS a Buffer regardless of the original frame type. Calling `ws.send(buffer)` defaults to sending a **binary** frame. The collab server sends JSON as **text** frames; the browser client does `JSON.parse(event.data)` (`ui/src/lib/websocket.ts:167`), which assumes `event.data` is a string. With the proxy in the path, the browser receives a Blob/ArrayBuffer instead, `JSON.parse` throws, the catch swallows it, and **every WS message is silently dropped**. This makes the entire native-app collab connection non-functional through the proxy (status updates, session state, task graph, terminal output all break).

The proxy unit test only exercises HTTP, so this is uncaught.

Fix: preserve the frame type using the `isBinary` flag:
```js
client.on('message', (data, isBinary) => { if (upConn.readyState === WebSocket.OPEN) upConn.send(data, { binary: isBinary }); });
upConn.on('message', (data, isBinary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary }); });
```

## Minor

### 2. checkAuth `/mcp` exemption over-matches via startsWith
`src/auth.ts:15`
```js
if (url.pathname === '/api/health' || url.pathname.startsWith('/mcp')) return null;
```
`startsWith('/mcp')` exempts not just `/mcp` but any path beginning with `/mcp` (e.g. `/mcpfoo`, `/mcp-anything`). The only real route is the exact `/mcp` (`src/server.ts:223` uses `=== '/mcp'`), so there is no currently-exploitable bypass, but the exemption is broader than the route. Recommend `url.pathname === '/mcp'` for symmetry with the route check. (Noting per instructions; not currently a live route.)

### 3. ConnectionStore add() returns before persist completes (fire-and-forget)
`desktop/src/main/connection-store.ts:111,118,124`
`add`/`remove`/`setActive` call `void this.persist()` and return synchronously. The returned id/result is reported to the renderer before the write to `servers.json` is durable. If the process crashes (or quits via `before-quit`, which does not await the store) immediately after, the entry/active change is lost. In normal use the store is not reloaded mid-session so there is no read-after-stale race within a run; impact is limited to a crash/quit window. Low severity, but if durability matters, make these `async` and `await this.persist()` (the IPC handlers already `invoke`/await). Note `refreshLocal()` correctly awaits persist, so the inconsistency is only in the mutators.

## Checked and OK (no bug)

- `handleUpgrade`: `head` is correctly forwarded to `wss.handleUpgrade`; no-upstream and no-wss paths destroy the socket; error/close cleanup is symmetric on both sockets and removes the pair from `openPairs`; `setUpstream`/`stop` terminate all pairs and clear the set. Upstream `http.request` has an `error` handler with a `headersSent` guard for the 502 path. `req.pipe(proxyReq)` — Node auto-ends on client error. No leak found.
- `setUpstream` racing in-flight: in-flight HTTP requests already captured `up` locally and complete against the old upstream; new requests use the new one. Open WS pairs are force-terminated so the renderer reconnects. Acceptable.
- Auth header injection: proxy injects `authorization` (lowercase) on both HTTP (`authHeaders`) and WS upgrade; Bun/`ws` header matching is case-insensitive, and `checkAuth` reads `req.headers.get('authorization')` (case-insensitive). Token comparison `Bearer ${token}` matches. Correct.
- Token never leaks to renderer: `ConnectionStore.list()` and `init`/`persist` strip/encrypt the token; preload bridge has no token-returning method; `getActive().id` only returns the id. safeStorage decrypt failure is caught and drops only the token, keeping the entry.
- `index.ts` IPC handlers use `store?`/`proxy?` optional chaining and `?? null`/`{ ok: false }` fallbacks, so a renderer call before bootstrap completes is safe. switchServer to unknown id returns `{ ok: false }`. The local sidecar upstream is set directly on the proxy (not via store), so `getActive()` returning null at startup is expected and the switcher falls back to a "This Mac" label (cosmetic only).
- `ServerContext`: all `window.mc` access is guarded (`if (!mc) return`); `available` gates the switcher; the keyed `React.Fragment` remount on switch is fine — `resetWebSocketClient()` disconnects the old singleton before remount, so no socket leak. `useMemo`/`useCallback` deps are correct.
- `refreshLocal` pruning: manual entries take precedence over local for the same host:port; `pruneLocalNotIn` removes only `source:'local'` entries absent from liveKeys and clears `activeId` if it pointed at a pruned entry; corrupt/non-`.json` registry files are skipped; missing registry dir prunes all local entries. Correct.
- `config.ts`: `MERMAID_BIND_HOST ?? HOST ?? '127.0.0.1'` precedence is correct; `MERMAID_AUTH_TOKEN` default `''` disables auth. No NaN issue introduced (port validation unchanged).
- `ServerSwitcher` port parse: `Number(form.port)` with `Number.isFinite` guard rejects NaN before add. OK.
- `onboarding-api.ts buildUrl`: now relative, resolves against document origin (the proxy). Consistent with the single-origin design; no bug.

## Summary
1 Critical (WS binary-frame breaks all messages), plus 1 Minor over-exemption and 1 Minor durability note.
