# Blueprint: Remote Connectivity (Phases 4–6)

## Source Artifacts
- `design-remote-connectivity` (authoritative design for this group)
- `design-native-app` (D2 proxy decision, must-address #6 auth, risks R4/R8)
- `design-server-switcher` (switcher UI Level 1→2)
- Diagram `native-app/remote-connectivity-flow`
- Code map: auth chokepoint `src/server.ts:186` fetch entry; WS upgrades `:190`/`:201`; bind `src/config.ts:46`; UI anchors `ui/src/lib/websocket.ts:374-414`, `ui/src/lib/onboarding-api.ts:101`; registry `src/services/instance-discovery.ts`.

**Scope:** Phases 4–6 (connect to remote servers). Build order: Phase 5 (auth/binding) → Phase 4 (proxy/ServerContext/IPC) → Phase 6 (switcher UI). Phase 3 terminal + 7–8 are out of scope.

---

## 1. Structure Summary

### Files
- [ ] `src/config.ts` — Modify: add `MERMAID_BIND_HOST` (default `127.0.0.1`; change current `HOST` default from `0.0.0.0`), `MERMAID_AUTH_TOKEN` (default `''`)
- [ ] `src/server.ts` — Modify: add an auth gate at the top of `fetch()` (before WS/MCP/API dispatch)
- [ ] `src/__tests__/server-auth.test.ts` — Test (auth gate behavior)
- [ ] `desktop/src/main/server-proxy.ts` — Create: per-server local HTTP+WS proxy, token injection, repointable upstream
- [ ] `desktop/src/main/__tests__/server-proxy.test.ts` — Test
- [ ] `desktop/src/main/connection-store.ts` — Create: persisted server list + safeStorage + local auto-list from registry
- [ ] `desktop/src/main/__tests__/connection-store.test.ts` — Test
- [ ] `desktop/src/main/index.ts` — Modify: start proxy, wire store, register IPC, load proxy URL (not sidecar directly)
- [ ] `desktop/src/preload/index.ts` — Modify: expand `mc` bridge (listServers/getActiveServer/switchServer/addServer/removeServer)
- [ ] `ui/src/lib/websocket.ts` — Modify: clean teardown/rebuild on switch (already has `resetWebSocketClient`)
- [ ] `ui/src/lib/onboarding-api.ts` — Modify: drop `window.location.origin`, use relative URL
- [ ] `ui/src/contexts/ServerContext.tsx` — Create: thin active-server context + `switch()`
- [ ] `ui/src/components/ServerSwitcher.tsx` — Create: switcher UI (pill + sidebar + add/edit dialog)

### Type Definitions
```ts
// connection-store.ts
interface ServerEntry {
  id: string; label: string; host: string; port: number;
  token?: string;                 // stored via safeStorage, never sent to renderer
  status: 'online' | 'offline' | 'connecting';
  lastProject?: string; lastSession?: string;
  source: 'local' | 'manual';     // local = auto-listed from instance registry
}
// preload mc bridge (renderer-visible — NO token field)
interface McBridge {
  listServers(): Promise<Array<Omit<ServerEntry, 'token'>>>;
  getActiveServer(): Promise<string | null>;
  switchServer(id: string): Promise<{ ok: boolean }>;
  addServer(opts: { label: string; host: string; port: number; token?: string }): Promise<string>;
  removeServer(id: string): Promise<void>;
}
```

### Component Interactions
Renderer (relative URLs, unchanged) → **proxy** (`127.0.0.1:<proxyPort>`) → active upstream (`{host,port}`, token injected). Switch = `mc.switchServer(id)` → main repoints proxy upstream + swaps token → renderer `resetWebSocketClient()` + remount. Auth gate on the upstream server enforces the token. See diagram `native-app/remote-connectivity-flow`.

---

## 2. Function Blueprints

### `checkAuth(req: Request, url: URL): Response | null`  (src/server.ts)
**Pseudocode:**
1. If `config.MERMAID_AUTH_TOKEN` is empty → return `null` (auth disabled, today's behavior).
2. Exempt paths: `/api/health` and `/mcp` (Claude's MCP transport is a separate concern — note follow-up) → return `null`.
3. Read `Authorization` header; expect `Bearer <token>`. (The proxy sets this on both HTTP and the WS upstream handshake; Node `ws` can set headers.)
4. If missing or mismatched → return `new Response('Unauthorized', { status: 401 })`.
5. Else return `null` (allow).
**Wire-in:** at the very top of `fetch(req, server)` (after `const url = new URL(req.url)`, before the `/ws` check at :190): `const denied = checkAuth(req, url); if (denied) return denied;`. This single gate covers `/ws`, `/terminal/:id`, `/api/*`, pseudo/files — all before upgrade/dispatch.
**Error handling:** constant-time compare not required for a local PIN-style token, but avoid early-exit length leak if easy.
**Edge cases:** token set but request to `/api/health` (must still pass — switcher probes it); WS upgrade with no header from a non-proxy browser (acceptable: blocked when token on, which is the intent).
**Test strategy:** token unset → all pass; token set → `/api/foo` without header 401, with correct header 200-path, `/api/health` always 200-path, `/ws` upgrade blocked without header.

### `config` additions (src/config.ts)
**Pseudocode:** `HOST: process.env.MERMAID_BIND_HOST ?? process.env.HOST ?? '127.0.0.1'` (flip default to loopback); `export const MERMAID_AUTH_TOKEN = process.env.MERMAID_AUTH_TOKEN ?? ''`.
**Test:** env set/unset → expected host + token; default host is `127.0.0.1`.

### `class ServerProxy` (desktop/src/main/server-proxy.ts)
**Signature:** `constructor(); start(): Promise<{ port }>; setUpstream(u: { host; port; token? } | null): void; stop(): Promise<void>`
**Pseudocode:**
1. `start()`: create a Node `http.createServer` on `127.0.0.1:0` (free port). On request: if no upstream → 503; else forward method/path/headers/body to `http://${host}:${port}`, **adding `Authorization: Bearer <token>`** if token set, pipe response back.
2. Handle `upgrade` event (WebSocket): open an upstream `ws` connection to `ws://${host}:${port}${path}` with the `Authorization` header set; pipe frames both ways. (Use the `ws` package — `registerHttpProtocol` cannot proxy WS.)
3. `setUpstream(u)`: store the active upstream; new requests use it. Existing WS connections from the old upstream should be closed so the renderer reconnects cleanly.
4. `stop()`: close server + any open upstream sockets.
**Error handling:** upstream connection refused → 502; never crash on a dropped socket.
**Edge cases:** switch mid-request (in-flight requests finish against old upstream, fine); WS reconnect storm on switch (renderer drives one reconnect via resetWebSocketClient).
**Test strategy:** spin a fake upstream http server; assert proxy forwards a GET and **injects the Authorization header** when a token is set; assert 503 when no upstream; assert `setUpstream` swaps target. (WS proxying can be a lighter assertion or deferred to manual.)

### `class ConnectionStore` (desktop/src/main/connection-store.ts)
**Signature:** `list(): ServerEntry[]; add(opts): string; remove(id); get(id); setActive(id); getActive(): ServerEntry | null; refreshLocal(): Promise<void>`
**Pseudocode:**
1. Persist entries to Electron `userData/servers.json`; **tokens encrypted via `safeStorage.encryptString`** (stored separately or as ciphertext), decrypted only in main.
2. `refreshLocal()`: read `~/.mermaid-collab/instances/*.json` (the registry, format = `Instance`), map each to a `ServerEntry { host:'127.0.0.1', port, source:'local', label: project/session }`. Merge with manual entries.
3. `add/remove/setActive`: mutate + persist. `list()` returns entries **without tokens** (for the renderer).
**Error handling:** corrupt/partial registry JSON → skip that file; missing safeStorage (Linux without keyring) → fall back to obfuscated-at-rest with a warning.
**Edge cases:** a local instance and a manual entry pointing at the same host:port → dedupe by host:port.
**Test strategy:** inject a fake registry dir + fake safeStorage; assert local instances auto-listed, manual add/remove, tokens never returned by `list()`.

### `switchServer(id)` lifecycle (main IPC in index.ts + renderer in ServerContext.tsx)
**Pseudocode (main):** `store.setActive(id)` → `proxy.setUpstream({host, port, token})` → return ok.
**Pseudocode (renderer `ServerContext.switch(id)`):** `await window.mc.switchServer(id)` → `resetWebSocketClient()` → bump a context `version` value that remounts collab views (so they refetch session list against the new upstream via the same relative URLs/proxy).
**Edge cases:** switch to an offline server → proxy returns 502/503; UI shows offline status from the health probe; don't tear down the old WS until the new target is set.
**Test strategy:** renderer unit test that `switch()` calls `mc.switchServer` then `resetWebSocketClient` in order (mock both).

### `ui/src/lib/websocket.ts` + `onboarding-api.ts`
**Changes:** ensure `resetWebSocketClient()` fully disconnects + nulls the singleton (already does) and that the next `getWebSocketClient()` rebuilds from the (proxy) origin. `onboarding-api.ts:101`: `new URL(\`/api/onboarding${path}\`, window.location.origin)` → relative `\`/api/onboarding${path}\`` (rides the proxy).
**Test strategy:** existing websocket tests stay green; add a test that after `resetWebSocketClient()` a new client is constructed.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: config-bind-auth
    files: [src/config.ts]
    tests: [src/__tests__/config-bind-auth.test.ts]
    description: "Phase 5 — add MERMAID_BIND_HOST (default 127.0.0.1) + MERMAID_AUTH_TOKEN to config; flip HOST default to loopback"
    parallel: true
    depends-on: []
  - id: connection-store
    files: [desktop/src/main/connection-store.ts]
    tests: [desktop/src/main/__tests__/connection-store.test.ts]
    description: "Phase 6 — persisted ServerEntry store; safeStorage tokens; auto-list local instances from registry; list() omits tokens"
    parallel: true
    depends-on: []
  - id: ws-singleton-switch
    files: [ui/src/lib/websocket.ts, ui/src/lib/onboarding-api.ts]
    tests: [ui/src/lib/websocket.test.ts]
    description: "Phase 4/6 — clean WS singleton teardown/rebuild on switch; onboarding-api uses relative URL (rides proxy)"
    parallel: true
    depends-on: []
  - id: server-auth-gate
    files: [src/server.ts]
    tests: [src/__tests__/server-auth.test.ts]
    description: "Phase 5 — checkAuth gate at top of fetch(); Bearer token required when configured; exempt /api/health and /mcp; covers /ws + /terminal + /api/*"
    parallel: true
    depends-on: [config-bind-auth]
  - id: server-proxy
    files: [desktop/src/main/server-proxy.ts]
    tests: [desktop/src/main/__tests__/server-proxy.test.ts]
    description: "Phase 4 — per-server local HTTP+WS proxy; inject Authorization on HTTP + WS upstream; repointable setUpstream; 503/502 handling"
    parallel: true
    depends-on: [config-bind-auth]
  - id: main-ipc-wiring
    files: [desktop/src/main/index.ts, desktop/src/preload/index.ts]
    tests: []
    description: "Phase 4 — start proxy + ConnectionStore; load proxy URL instead of sidecar; expand mc bridge (list/get/switch/add/removeServer) via IPC"
    parallel: false
    depends-on: [server-proxy, connection-store]
  - id: server-context
    files: [ui/src/contexts/ServerContext.tsx]
    tests: [ui/src/contexts/ServerContext.test.tsx]
    description: "Phase 6 — thin React context: active server id + switch() → mc.switchServer + resetWebSocketClient + remount version bump"
    parallel: false
    depends-on: [ws-singleton-switch, main-ipc-wiring]
  - id: switcher-ui
    files: [ui/src/components/ServerSwitcher.tsx]
    tests: [ui/src/components/ServerSwitcher.test.tsx]
    description: "Phase 6 — switcher UI (active pill + sidebar + add/edit dialog with live /api/health probe); Level 1→2 from design-server-switcher"
    parallel: false
    depends-on: [server-context]
```

### Execution Waves

**Wave 1 (parallel, no deps):** `config-bind-auth`, `connection-store`, `ws-singleton-switch`
**Wave 2 (← Wave 1):** `server-auth-gate` (←config), `server-proxy` (←config)
**Wave 3 (← Wave 2):** `main-ipc-wiring` (←server-proxy, connection-store)
**Wave 4 (← Wave 3):** `server-context` (←ws-singleton-switch, main-ipc-wiring)
**Wave 5 (← Wave 4):** `switcher-ui` (←server-context)

### Summary
- Total tasks: 8
- Total waves: 5
- Max parallelism: 3 (Wave 1)

### Notes / risks (from design)
- **R4 token lifecycle:** on switch, the proxy holds exactly one upstream+token; revoke/replace atomically — never carry the old token to a new upstream.
- **WS token:** proxy adds the header to the upstream handshake (Node `ws` can); renderer→proxy hop is loopback and needs none.
- **/mcp exemption** is a deliberate scope cut — authing Claude's MCP transport is a separate follow-up (Phase 7-adjacent).
- **No cross-machine discovery** — remote = manual host:port+token; local auto-listed from the registry.
- GUI/proxy runtime behavior needs a manual launch check (like the foundation), since it's not headless-testable.
