# Design: Remote Connectivity (Phases 4–6)

Second design doc in the native-app series — see [[design-native-app]] (foundation, Phases 0–2, shipped on branch `feat/native-app-foundation`) and [[design-server-switcher]] (the switcher UI sketch this builds on).

## Why these three phases group

Phases 4–6 are the **one coherent capability**: *connect one app window to collab servers on other machines*. They're inseparable:

- **Phase 4** (ServerContext + main-process proxy) is the transport foundation.
- **Phase 5** (server-config binding + auth) is a hard prerequisite — you cannot safely reach a remote server without `0.0.0.0` binding + a token.
- **Phase 6** (server-switcher UI) is the user-facing feature, and it requires both 4 and 5 to exist.

Phase 3 (terminal pane) is independent and excluded. Phases 7 (remote browser) and 8 (packaging) come later and depend on this group being in place.

## The key simplification (decided by D2 in [[design-native-app]])

The earlier research feared a **24+ call-site rewrite** to make every UI `fetch`/WS origin-aware. The main-process proxy decision (D2) makes that unnecessary:

> The proxy is the renderer's **single origin**. The 24+ relative `fetch('/api/..')` calls and the `/ws` WebSocket keep working unchanged — they just resolve to the proxy. Switching servers = repoint the proxy upstream + reset the WS singleton + remount; the UI code is untouched.

So the real refactor surface is tiny (grounded in the code map):
- `ui/src/lib/websocket.ts:374-414` — the `sharedClient` singleton + `getDefaultWebSocketURL()` (window.location.host). Needs a clean teardown/rebuild on switch (`resetWebSocketClient()` already exists).
- `ui/src/lib/onboarding-api.ts:101` — the one hardcoded `window.location.origin`; change to a relative URL so it rides the proxy like everything else.
- Everything else (`pseudo-api.ts:18`, `projects-api.ts:11`, `embeds.ts:7` all `API_BASE=''`, + ~24 relative fetches) stays as-is.

**Browser (non-app) mode is unchanged** — a plain browser tab stays single-origin (one tab = one server, exactly as today). The switcher is a native-app-only feature.

{{diagram:native-app-remote-connectivity-flow}}

## Architecture

### Phase 5 first (it's the prerequisite): server-config binding + auth
Pure addition — the code map confirms **zero** existing auth/CORS/origin checks.

- **Config** (`src/config.ts:46`): add `MERMAID_BIND_HOST` (default `127.0.0.1` — note: change the current `HOST` default from `0.0.0.0` to `127.0.0.1` for safe-by-default) and `MERMAID_AUTH_TOKEN` (default none). Server binds `config.HOST` at `src/server.ts:182-184`.
- **API auth** — single chokepoint at `src/server.ts:280` (the `/api/*` dispatch). If a token is configured, require it (`Authorization: Bearer <token>` header) before dispatching; 401 otherwise. The `/api/health` route stays unauthenticated (needed for probing).
- **WS auth** — the two `server.upgrade()` calls (`src/server.ts:190` `/ws`, `:201` `/terminal/:id`). Check the token (query param, since browsers can't set WS headers — but in the app the *proxy* adds it; see below) + optionally an Origin allowlist, before upgrading.
- **Read by hook + CLI + app** — the bind host + token must come from env/config so a server started by Claude's `SessionStart` hook or the CLI honors them, not just app-spawned ones (per [[design-native-app]] must-address #6). `ServerSupervisor` already forwards `MERMAID_BIND_HOST`/`MERMAID_AUTH_TOKEN` env.
- Default stays safe: `127.0.0.1` + no token = today's open-localhost behavior. Opting into sharing flips server config.

### Phase 4: main-process proxy + thin ServerContext
- **Per-server local proxy** (new `desktop/src/main/server-proxy.ts`): a real Node `http` + `ws` server on a random loopback port (custom `app://`/`registerHttpProtocol` **cannot** proxy WebSockets — confirmed need for a real ws server). It forwards `/api/*`, `/ws`, `/terminal/:id` to the active upstream `{host, port}`, **injecting `Authorization: Bearer <token>`** on every HTTP request and the WS handshake (only the main process can set real WS headers — the renderer can't). Tokens live only in main, persisted via Electron `safeStorage`. The renderer never holds a token.
- **Renderer points at the proxy**: the window loads `http://127.0.0.1:<proxyPort>` instead of the sidecar directly. All relative URLs now flow through the proxy. (Replaces the current `mainWindow.loadURL(http://127.0.0.1:${port})` in `desktop/src/main/index.ts:105`.)
- **Thin ServerContext** (renderer): a small React context holding the active server id + a `switch(id)` that calls `window.mc.switchServer(id)`, then `resetWebSocketClient()`, then triggers a remount/refetch. It does NOT need to thread a base URL through 24 files — relative URLs already work.
- **`mc` preload bridge** (`desktop/src/preload/index.ts`) gains: `listServers()`, `getActiveServer()`, `switchServer(id)`, `addServer(opts)`, `removeServer(id)` — all IPC to main.

### Phase 6: connection store + switcher UI
- **Connection store** (main, persisted): `{ id, label, host, port, token?, status, lastProject, lastSession }`. Auto-populate **local** servers from `readInstances()` (`src/services/instance-discovery.ts:101`) → these are `127.0.0.1:<port>` (Instance has **no host field**, so local is assumed). Remote servers added manually (host:port + token).
- **Switch lifecycle**: `switchServer(id)` → main repoints the proxy's upstream + swaps the injected token → renderer `resetWebSocketClient()` + refetch session list + remount collab views. No stale subscriptions from the previous server.
- **UI**: build **Level 1** of [[design-server-switcher]] first (active-server pill + sidebar + add/edit dialog with a live `/api/health` probe), then Level 2 (auto-listed local instances). Tabs (L3) / federation (L4) deferred.

## Build order within the group

1. **Phase 5** — config + auth (backend, fully TDD-able: request with/without token → 200/401; WS upgrade rejects bad token; bind host honored). No UI needed.
2. **Phase 4** — proxy + ServerContext + preload IPC. Verify: app still works end-to-end through the proxy (relative URLs proxied; WS reconnects); token injected to a token-required local server.
3. **Phase 6** — connection store + switcher UI (Level 1 → 2). Verify: connect to a second machine's server (0.0.0.0 + token) and switch back to local.

## Open questions / risks (carried from [[design-native-app]])

- **R4 — token lifecycle**: where stored (`safeStorage`/keychain), how rotated, **atomic revoke of the previous server's token on switch** (don't leak the old upstream's auth to a new connection). The proxy holds exactly one active upstream+token at a time.
- **WS token transport**: browsers can't set WS headers, so a token must ride a query param on `/ws?token=` — which can leak into logs. In the app, the *proxy* adds the header to the upstream handshake, so the renderer→proxy hop needs no token (it's loopback). Decide whether the browser (non-app) case ever needs authed WS; if not, query-param token is only used proxy→remote and is acceptable.
- **Origin allowlist on upgrade**: once servers bind `0.0.0.0`, add an Origin check on `/ws` + `/terminal` upgrades so arbitrary web pages can't connect.
- **Health probe + status**: reuse `/api/health` (unauthenticated) for the switcher's status dots; poll on interval + on-demand retry.
- **No cross-machine discovery** (Instance has no host field) — remote servers are manual entry. mDNS/registry-service discovery is a separate future feature, not in this group.
- **Multi-instance proxy ports**: each saved server could get its own proxy (Grok's suggestion) or one proxy that repoints. Start with **one repointing proxy** (simpler; matches single-active-server Level 1); revisit if tabs (L3) land.

## Not in this group
- Phase 3 terminal pane (independent).
- Phase 7 remote browser-control (depends on this group's reachable-server + token work; D3 in [[design-native-app]]).
- Phase 8 packaging/signing/auto-update.
- Server-side federation / multi-server-in-one-view (the not-built piece from the topology research).
