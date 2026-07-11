# Bug Review

Findings against changes in 6c28b8c..HEAD.

## Critical

### 1. `validateAgainstServers` clears currentSession on initial probe — never recovers
- File: `ui/src/contexts/ServerContext.tsx` (validate effect, ~lines 107-118) + `ui/src/stores/sessionStore.ts` (`validateAgainstServers`)
- What's wrong: `refresh()` does `setServers(list.map(s => ({...s, status: 'connecting'})))` synchronously, then probes asynchronously. The validate effect fires as soon as `loadedOnceRef.current` is true and `hydrated` is true, with all servers in `'connecting'` state. `validateAgainstServers` requires `server.status === 'online'`, so the persisted `currentSession.serverId` (whose status is still `'connecting'`) gets cleared via `clearSession()`. The effect's de-dup key is the sorted server id list — it does NOT change when statuses flip from `connecting` → `online` after probing, so validation never re-runs to "rescue" the session. The persisted session is gone for the rest of the lifetime.
- Fix: in `validateAgainstServers`, only clear when the server is *missing*. Treat both `'online'` and `'connecting'` as "keep". Alternatively, include status fingerprint in the dedupe key so the effect re-runs after the probe lands and only clears once a server is known-offline (or absent) for some period.

### 2. Tmux capability bootstrap deadlock
- File: `ui/src/components/layout/SubscriptionsPanel.tsx` `fetchCapabilities`; `desktop/src/main/index.ts` `mc:invokeOnServer` + `mc:getServerCapabilities`; `desktop/src/main/connection-store.ts` `getServerCapabilities` default
- What's wrong: `getServerCapabilities` defaults to `{ tmux: false }` until the main process observes a `/api/ide/create-terminal` response with `tmux:true` and calls `setServerCapabilities`. But the only path that *calls* `/api/ide/create-terminal` is gated client-side by `if (caps.tmux)`. Result: on a brand-new server (including the local one) `caps.tmux` is always false → terminal create is never invoked → caps are never learned → tmux UI is permanently disabled. The "Open all watched in IDE" button has the same gate. Also `getServerCapabilities` in `SubscriptionsPanel` caches the negative result in `capsCache` for the renderer lifetime, so even if the server later flips capable, nothing refreshes.
- Fix: probe capabilities eagerly when a server first comes online (e.g., one-shot `GET /api/ide/capabilities` or a tmux-detect endpoint on connect); or unconditionally try `create-terminal` and read `tmux:false` in the response to set caps; or default unknown to `true` and downgrade on the first failure. Also invalidate `capsCache` on server-list changes / status flips.

## Important

### 3. Prefetch never runs — wrong subscription key shape
- File: `ui/src/hooks/usePrefetchWatchedSessions.ts` line ~20
- What's wrong: subscriptions are stored under composite key `${serverId}:${project}:${session}` (see `subscriptionStore.compositeKey`), but the prefetch guard uses `const key = `${project}:${session}``. `currentSubs[key]` is therefore always `undefined` and the `if (!currentSubs[key]) return;` short-circuits every prefetch. The feature is dead code.
- Fix: build the composite key with the same helper: `const key = `${serverId}:${project}:${session}`;`

### 4. `apiFetch` Response headers type mismatch
- File: `ui/src/lib/api.ts` (`apiFetch`, ~lines 180-216)
- What's wrong: `headers: res.headers ?? {}` is passed straight into `new Response(...)`. `res.headers` comes back from the IPC bridge (Electron `node-fetch`/undici) and can be a plain object, an array, or a `Headers`-like (with non-string values, e.g. `set-cookie` arrays). `new Response()` will throw `TypeError` on non-string header values or unknown shapes. Errors here bubble synchronously out of `apiFetch`, breaking any caller that expected a `Response`.
- Fix: Normalize headers: `const headers = new Headers(); for (const [k, v] of Object.entries(res.headers ?? {})) { if (Array.isArray(v)) v.forEach(x => headers.append(k, String(x))); else if (v != null) headers.set(k, String(v)); }` then pass `headers`.

### 5. Body re-parse in `apiFetch` swallows valid JSON-shaped strings
- File: `ui/src/lib/api.ts` (`apiFetch`, body handling)
- What's wrong: If `init.body` is a string that happens to be valid JSON (e.g., a stringified array) the helper `JSON.parse`s it before re-stringifying on the other side. If a caller intentionally sends a JSON-encoded string as the API payload (the server expects a string body in some shape, e.g., `JSON.stringify("hello")` → `'"hello"'`), the IPC bridge will end up sending the *unwrapped* primitive instead. Similarly on the response side, `respBody` is recomputed by `JSON.stringify(res.body)` when `res.body` is not a string — so the renderer-side `response.json()` works, but `response.text()` returns serialized JSON, not raw text. Minor mismatches in callers that mix `.text()` and `.json()` for non-JSON endpoints will break.
- Fix: don't unwrap JSON strings; pass `init.body` through as-is when the bridge supports it. Have the main process always return a string body + content-type so renderer can choose `.text()` vs `.json()`.

### 6. Capabilities cache is module-level and never invalidated
- File: `ui/src/components/layout/SubscriptionsPanel.tsx` (`capsCache`)
- What's wrong: `Map<string, { tmux }>` keyed by serverId is never cleared. If a server is removed and re-added (e.g., same id reused), or if tmux becomes available later, the renderer will not re-probe. Also no invalidation when `removeServer` runs from the ServersTreeSection.
- Fix: subscribe to `useServers()` changes (server removal) and invalidate; or use a TTL; or re-validate after a server transitions to `'online'`.

## Minor

### 7. `CreateSessionDialog` default falls back to `'local'` literal
- File: `ui/src/App.tsx` (`handleCreateSession`) and the AddProjectDialog mount
- What's wrong: `defaultServerId: activeServerId ?? 'local'` and `servers.find(s => s.id === 'local')?.id ?? activeServerId ?? ''`. If no server with id `'local'` exists and no current session is set (browser fallback without Electron, or all servers manual), `serverId` becomes `''`. `apiFetch('', ...)` falls into the no-prefix branch (`/api/sessions`) which works fine for same-origin browser, but `Session.serverId` is then persisted as `''`, which downstream code treats as "no server" and will skip every `selectXxxWithContent`. Dialog won't reject the submission either.
- Fix: validate `serverId` non-empty in the dialog's confirm handler; or fall back to `servers[0]?.id` rather than `'local'`.

### 8. `SidebarView` defaults serverId to `'local'` for WS-driven status updates
- File: `ui/src/views/SidebarView.tsx`
- What's wrong: `(message as any).serverId ?? searchParams.get('srv') ?? 'local'`. If the server emitting the event isn't actually id `'local'` (e.g., manual remote), the subscription status update gets attributed to the wrong server, mis-tagging the entry and possibly creating a phantom subscription record under the wrong key.
- Fix: require `serverId` on the message; drop the `'local'` fallback or only use it when `mc` is absent (true browser).

### 9. `apiFetch` FormData/Blob fall-through bypasses Electron bridge
- File: `ui/src/lib/api.ts` (~line 197-200)
- What's wrong: When `init.body` is FormData/Blob the helper does `return fetch(serverId ? '/srv/...' : path, init)`. In the Electron renderer the dev/prod build serves the renderer from `app://` or a custom origin; `/srv/<id>/...` is not routed by the main-process proxy for non-`mc:invokeOnServer` paths — server-proxy only handles `/srv/...` from the renderer's loopback proxy. If the renderer is loaded via `loadFile` the relative `fetch` will resolve to `file:///srv/...` which fails. Image upload via `createImage` (`File`) will be broken for non-local servers.
- Fix: route binary bodies through the proxy explicitly (`http://127.0.0.1:<proxyPort>/srv/<id>/...`), or add a binary-aware `mc:uploadOnServer` IPC handler.

### 10. WS upgrade in `server-proxy.ts` no longer handles legacy `/srv/<id>/ws` paths
- File: `desktop/src/main/server-proxy.ts` (`handleUpgrade`)
- What's wrong: The HTTP branch added a `/srv/<id>/...` path-rewriting fork, but I don't see equivalent treatment in `handleUpgrade` for `wss` over `/srv/<id>/ws` — the WS path falls through to `localUpstream`, so cross-server WS still goes to the local sidecar. The renderer's WS singleton (post-`resetWebSocketClient` removal in ServerContext) will never reach a remote server over WS in the desktop app. (Verify against `per-server` upgrade path; if `/_per-server/<id>/ws` is the only intended WS route, fine — but the API HTTP `/srv/<id>` branch and the WS routing are now asymmetric.)
- Fix: confirm WS upgrade handles `/srv/<id>/...` symmetrically, or document why HTTP and WS branches diverge.

### 11. Pending deep link payload uses `srv` key but parser also stores `srv` (string|null) — no normalization
- File: `desktop/src/main/index.ts` `dispatchDeepLink`
- What's wrong: When `parsed.srv` is null we fall back to `store?.list().find(e => e.source === 'local')?.id ?? null`. If no local server exists yet (e.g., sidecar still spinning up), srv stays null and the renderer receives `{ srv: null }`. `SidebarView`'s default of `'local'` then mislabels the event.
- Fix: hold the deep link until at least one server is known, or send the literal string `'local'` instead of `null` to be consistent with the renderer's expectation.

## Not bugs (verified clean)

- Legacy `activeId` in persisted JSON: parse tolerates it (just ignored via destructuring), confirmed.
- `embedsApi.invoke` json fallback: handles both string and object bodies safely.
- `resolveImageSrc`: correctly passes through absolute and data/blob URIs before applying `/srv/<id>` prefix.
- `connection-store.remove` cleans up capabilities map symmetrically with entries.
