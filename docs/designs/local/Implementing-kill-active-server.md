# Blueprint: Kill `activeServerId` — All Servers Always Active

## Source Artifacts
- `design-kill-active-server` (design doc, 5 steps + Step 0 prerequisite)
- `research-active-server-audit` (14 reader sites, 3 categories)
- `research-kill-active-server-open-qs` (Q1-Q6 resolved)
- `active-server-usage` (diagram)

---

## 1. Structure Summary

### Files

**Step 0 — `serverId` on Session + persist**
- [ ] `ui/src/types/session.ts` — add `serverId: string` to `Session`
- [ ] `ui/src/stores/sessionStore.ts` — wrap in `persist(...)`; on restore, validate server is connected & online, else clear + show picker
- [ ] Session-creation call sites — backfill `serverId` at creation (grep `createSession`, `Session.create`, MCP `create_session` callers)

**Step 1 — capability flags replace IDE/tmux gates**
- [ ] `desktop/src/main/connection-store.ts` — record per-server `capabilities: { tmux: boolean }` from create-terminal response / probe
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — replace `sub.serverId === activeServerId` at lines 199-227, 304-313, 622-631 with `sub.capabilities?.tmux === true`

**Step 2 — Claude session/context WS via aggregator**
- [ ] WatchAggregator (find in `ui/src/services/` or `ui/src/stores/`) — add `claude_session_started`, `claude_session_ended`, `claude_context_update` to per-server subscription set; emit tagged
- [ ] `ui/src/App.tsx:962-992` — consume tagged stream from aggregator; drop `activeServerId` tagging
- [ ] `ui/src/components/layout/SidebarView.tsx:25-33` — same

**Step 3 — per-action server pickers (3 sites)**
- [ ] `ui/src/App.tsx:1347` (`CreateSessionDialog`) — add server picker; default to selected SubscriptionsPanel row's server
- [ ] `ui/src/components/.../TerminalDrawer.tsx:90` — convert `+` to dropdown "New terminal on ▾"; default to `currentSession.serverId`
- [ ] `ui/src/components/layout/MobileHeader.tsx:369` + `ui/src/components/.../ProjectSelector.tsx:303` — add server picker to Add Project; default to local
- [ ] `ui/src/App.tsx:297` — legacy-entry migration: hardcode to local server id (or delete if unreachable)

**Step 4 — multi-server artifact tree + `/srv/<id>/...` proxy routing**
- [ ] `desktop/src/main/server-proxy.ts` (ServerProxy) — add `/srv/<id>/api/...` route → forwards to upstream `<id>`; keep legacy `/api/...` → local sidecar
- [ ] Artifact-tree fetcher hook (likely `ui/src/hooks/useDataLoader.ts` per Q1) — accept `serverId`; call `mc.invokeOnServer(serverId, ...)` for JSON
- [ ] `ui/src/utils/resolveImageSrc.ts` — inject `/srv/<id>/` prefix based on owning artifact's server
- [ ] `ui/src/utils/milkdownEmbedBridge.ts` (or equivalent) — same `/srv/<id>/` prefix for embed iframes
- [ ] Current-session view queries — same pattern (accept `serverId` from `currentSession.serverId`)

**Step 5 — delete activeId, switcher, setUpstream**
- [ ] `ui/src/contexts/ServerContext.tsx` — remove `activeId`, `setActive`; rename hook to `useServers()`; expose `{ connected, capabilities, healthByServer }`
- [ ] Server switcher UI (likely in `Header.tsx` or a dedicated component) — delete
- [ ] `desktop/src/main/server-proxy.ts` — remove `setUpstream(...)` and active-upstream pinning
- [ ] `desktop/src/main/index.ts:127` (`parseDeepLink`) — parse `?srv=<id>&project=&session=`
- [ ] `ui/src/components/layout/SidebarView.tsx` — read `?srv=<id>` via `useSearchParams`
- [ ] `desktop/src/main/connection-store.ts` — remove `active`/`setActive` storage

### Type Definitions

```ts
// ui/src/types/session.ts
interface Session {
  name: string;
  project: string;
  serverId: string; // NEW — owning server
  // ...existing
}

// ui/src/contexts/ServerContext.tsx (post Step 5)
interface ServersContextValue {
  connected: ConnectedServer[];                 // all online
  capabilities: Record<string, ServerCapabilities>;
  healthByServer: Record<string, HealthState>;
  // NO activeId, NO setActive
}

interface ServerCapabilities {
  tmux: boolean;
  // future: ide, browser, etc.
}
```

### Component Interactions

```
SubscriptionsPanel ──selects session──> sessionStore.currentSession (incl. serverId)
                                              │
                                              ├─> ArtifactTree(serverId) ─> mc.invokeOnServer or /srv/<id>/api/...
                                              ├─> CurrentSessionView(serverId)
                                              └─> Embeds/<img> use /srv/<id>/ prefix

WatchAggregator (per-server WS bridge) ─emits {serverId, msg}─> App.tsx + SidebarView (no tagging)

ServerProxy:
  /srv/<id>/api/...  → upstream[id]    (multi-server, replaces "active")
  /api/...           → local sidecar   (legacy, kept until migrations done)
  /_per-server/<id>/ → upstream[id] WS (unchanged)
```

---

## 2. Function Blueprints

### `restoreCurrentSession()` (sessionStore, Step 0)

**Pseudocode:**
1. Read persisted `currentSession` from storage.
2. If absent, leave `currentSession = null`.
3. Validate: `connections.has(currentSession.serverId) && isOnline(currentSession.serverId)`.
4. If invalid, clear `currentSession`; emit a one-time toast "Previous session's server is offline."
5. Never silently switch servers.

**Edge cases:** server-id deleted from connections, server connected but unhealthy, persisted session predates Step 0 (no `serverId`) → clear.

**Tests:** restore-with-online-server / restore-with-offline-server / restore-with-missing-serverId.

### `getServerCapabilities(serverId)` (connection-store, Step 1)

**Pseudocode:**
1. Return cached `capabilities[serverId]` if known.
2. Otherwise default to `{ tmux: false }` (conservative).
3. On every `/api/ide/create-terminal` response, update cache from `{ tmux }` field.
4. On manual `probeCapabilities(serverId)`, hit a cheap GET endpoint (or call `/api/ide/create-terminal` with `dryRun: true` if available).

**Error handling:** failed probe → leave cache as-is; don't mark unhealthy.

### Aggregator extension (Step 2)

**Pseudocode (in WatchAggregator):**
1. On per-server WS connect, subscribe to `claude_session_started`, `claude_session_ended`, `claude_context_update` in addition to current set.
2. On message receipt, emit `{ serverId, type, payload }` on the existing tagged stream.

**App.tsx / SidebarView consumers:**
1. Subscribe to aggregator stream filtered by `type`.
2. Use `msg.serverId` directly. Delete the `serverId: activeId` injection.

### `<NewTerminalDropdown />` (Step 3)

**Pseudocode:**
1. Read `connected` from `useServers()` and `currentSession?.serverId`.
2. Render dropdown items per connected server with icon + label.
3. Default highlight = `currentSession.serverId` || `local`.
4. On select → `useTerminalStore.openFor({ serverId, ... })`.

### `ServerProxy` routing (Step 4)

**Pseudocode:**
1. Incoming request path.
2. If path matches `^/srv/([^/]+)/(.*)`:
   - `id = match[1]`, `rest = match[2]`
   - Look up `upstreams.get(id)`; 404 if unknown.
   - Forward to `upstream.baseUrl + '/' + rest` with method/headers/body.
3. Else if `^/api/`: forward to local sidecar (legacy).
4. Else if `^/_per-server/`: existing handler.
5. Else: static / SPA index.

**Error handling:** unknown serverId → 404 with body `{ error: "unknown server" }`. Upstream offline → 503.

### `resolveImageSrc(src, artifact)` (Step 4)

**Pseudocode:**
1. If `src` is absolute or `data:` / `blob:` — return unchanged.
2. If `src` starts with `/api/` and `artifact.serverId` is set — return `/srv/${artifact.serverId}${src}`.
3. Else return `src` unchanged.

**Edge cases:** artifact missing serverId (legacy) → fall back to legacy `/api/` (hits local sidecar).

### `parseDeepLink(url)` (Step 5)

**Pseudocode:**
1. Parse `mermaid-collab://...` URL.
2. Extract `srv`, `project`, `session` query params.
3. Resolve session by `(project, name, srv)` triple.
4. If `srv` absent (legacy link), fall back to local server.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  # Wave 1 — independent foundations
  - id: session-type-serverid
    files: [ui/src/types/session.ts]
    tests: []
    description: "Add serverId to Session type"
    parallel: true
    depends-on: []

  - id: connection-capabilities
    files: [desktop/src/main/connection-store.ts]
    tests: []
    description: "Track per-server tmux capability"
    parallel: true
    depends-on: []

  - id: aggregator-claude-events
    files: [ui/src/services/WatchAggregator.ts]
    tests: []
    description: "Extend aggregator subscription set with claude_session_* and claude_context_update; emit tagged"
    parallel: true
    depends-on: []

  - id: proxy-srv-routing
    files: [desktop/src/main/server-proxy.ts]
    tests: []
    description: "Add /srv/<id>/api/... routing to ServerProxy"
    parallel: true
    depends-on: []

  # Wave 2 — built on Wave 1
  - id: session-store-persist
    files: [ui/src/stores/sessionStore.ts]
    tests: []
    description: "Persist currentSession; validate server online on restore; fall back to picker"
    parallel: true
    depends-on: [session-type-serverid]

  - id: session-creation-serverid
    files: []
    tests: []
    description: "Backfill serverId at every session-creation call site (grep all callers)"
    parallel: true
    depends-on: [session-type-serverid]

  - id: subscriptions-capability-gates
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Replace activeId gates at lines 199-227, 304-313, 622-631 with capability flag check"
    parallel: true
    depends-on: [connection-capabilities]

  - id: app-consume-aggregator
    files: [ui/src/App.tsx]
    tests: []
    description: "App.tsx:962-992 consume aggregator stream; drop activeId tagging"
    parallel: true
    depends-on: [aggregator-claude-events]

  - id: sidebarview-consume-aggregator
    files: [ui/src/components/layout/SidebarView.tsx]
    tests: []
    description: "SidebarView.tsx:25-33 consume aggregator stream; drop activeId tagging"
    parallel: true
    depends-on: [aggregator-claude-events]

  - id: resolve-image-src-srv
    files: [ui/src/utils/resolveImageSrc.ts]
    tests: []
    description: "Inject /srv/<id>/ prefix based on artifact.serverId"
    parallel: true
    depends-on: [proxy-srv-routing]

  - id: milkdown-embed-bridge-srv
    files: [ui/src/utils/milkdownEmbedBridge.ts]
    tests: []
    description: "Inject /srv/<id>/ prefix for embed iframe URLs"
    parallel: true
    depends-on: [proxy-srv-routing]

  # Wave 3 — needs both Session.serverId and proxy routing
  - id: artifact-tree-multi-server
    files: [ui/src/hooks/useDataLoader.ts]
    tests: []
    description: "Artifact-tree + current-session queries accept serverId; fetch via mc.invokeOnServer or /srv/<id>"
    parallel: true
    depends-on: [session-type-serverid, session-store-persist, proxy-srv-routing]

  - id: create-session-picker
    files: [ui/src/App.tsx]
    tests: []
    description: "CreateSessionDialog gets server picker; default to SubscriptionsPanel row's server"
    parallel: true
    depends-on: [session-type-serverid, session-creation-serverid]

  - id: terminal-drawer-picker
    files: [ui/src/components/terminal/TerminalDrawer.tsx]
    tests: []
    description: "Convert '+' to NewTerminalDropdown; default to currentSession.serverId"
    parallel: true
    depends-on: [session-type-serverid]

  - id: add-project-picker
    files: [ui/src/components/layout/MobileHeader.tsx, ui/src/components/.../ProjectSelector.tsx]
    tests: []
    description: "Add Project flow gets server picker; default local"
    parallel: true
    depends-on: [session-type-serverid]

  # Wave 4 — final cleanup, deletes the concept
  - id: parse-deep-link-srv
    files: [desktop/src/main/index.ts]
    tests: []
    description: "parseDeepLink reads ?srv=<id>&project=&session="
    parallel: true
    depends-on: [session-type-serverid]

  - id: sidebar-view-search-params
    files: [ui/src/components/layout/SidebarView.tsx]
    tests: []
    description: "SidebarView reads ?srv=<id> via useSearchParams"
    parallel: true
    depends-on: [parse-deep-link-srv]

  - id: server-context-cleanup
    files: [ui/src/contexts/ServerContext.tsx]
    tests: []
    description: "Remove activeId/setActive; rename hook useServer→useServers; expose connected/capabilities/health"
    parallel: false
    depends-on: [subscriptions-capability-gates, app-consume-aggregator, sidebarview-consume-aggregator, artifact-tree-multi-server, create-session-picker, terminal-drawer-picker, add-project-picker, resolve-image-src-srv, milkdown-embed-bridge-srv]

  - id: delete-switcher-ui
    files: [ui/src/components/layout/Header.tsx]
    tests: []
    description: "Delete server switcher UI from Header"
    parallel: true
    depends-on: [server-context-cleanup]

  - id: proxy-setupstream-remove
    files: [desktop/src/main/server-proxy.ts, desktop/src/main/connection-store.ts]
    tests: []
    description: "Remove setUpstream/active-upstream pinning; proxy routes by path only"
    parallel: true
    depends-on: [artifact-tree-multi-server, proxy-srv-routing, resolve-image-src-srv, milkdown-embed-bridge-srv]
```

### Execution Waves

**Wave 1 (4 parallel):**
- session-type-serverid, connection-capabilities, aggregator-claude-events, proxy-srv-routing

**Wave 2 (7 parallel):**
- session-store-persist, session-creation-serverid, subscriptions-capability-gates,
- app-consume-aggregator, sidebarview-consume-aggregator,
- resolve-image-src-srv, milkdown-embed-bridge-srv

**Wave 3 (4 parallel):**
- artifact-tree-multi-server, create-session-picker, terminal-drawer-picker, add-project-picker

**Wave 4 (cleanup):**
- parse-deep-link-srv (parallel with Wave 3 finishers logically; placed here for ordering)
- sidebar-view-search-params (depends parse-deep-link-srv)
- server-context-cleanup (sequential — must follow everything above)
- delete-switcher-ui, proxy-setupstream-remove (parallel after server-context-cleanup)

### Summary
- Total tasks: 18
- Total waves: 4
- Max parallelism: 7 (Wave 2)
