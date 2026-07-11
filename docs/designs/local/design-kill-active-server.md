# Design: Kill `activeServerId` — All Servers Always Active

## Problem

Despite the cross-server epic making watching, terminals, and todos work uniformly across all connected servers, the UI still has a global "active server" selector. The user must pick one server at a time; "switching" repoints the Electron `ServerProxy` to a different upstream and remounts the whole subtree.

This is incoherent with the rest of the unified UX. Every other panel works across servers — only the artifact tree and the proxy itself remain single-server.

**Goal:** Remove the `activeServerId` concept entirely. Every connected server is always active. Server-id becomes a property of each artifact, session, and action — never global state.

## Current State (see `active-server-usage` diagram + `research-active-server-audit`)

`activeServerId` lives in `ui/src/contexts/ServerContext.tsx`, backed by `desktop/src/main/connection-store.ts` + `ServerProxy`. It has 14 reader sites in 3 categories:

| Category | Count | Disposition |
|---|---|---|
| (a) Needs default | 3 | All non-essential — see below |
| (b) Legacy WS-tagging hacks | 7-9 | Replace with aggregator-tagged stream |
| (c) Should be per-action | 2 | IDE/tmux gates → per-server capability flags |
| (u) Upstream proxy target | the real driver | Replace with `/srv/<id>/...` routing (see Q4) |

### Why each "needs default" doesn't actually

- **A1 — legacy-entry migration (`App.tsx:297`)**: one-shot on first load. Hardcode to local server or delete.
- **A2 — TerminalDrawer "+" fallback**: a new-terminal dialog asks which server, or defaults to the server of the currently-selected session. Per-action context.
- **A3 — server switcher UI**: self-referential; deleted with the concept.

### The real driver: Electron `ServerProxy`

Per `research-kill-active-server-open-qs` (Q4), `ServerProxy` does **more** than HTTP forwarding — it also:
- Proxies WS to the active upstream (single connection, no `serverId` in messages — *this* is why `App.tsx` + `SidebarView.tsx` tag incoming Claude/context events with `activeServerId`).
- Bridges per-server WS via `/_per-server/<id>/...` (already multi-server — this is what the cross-server aggregator uses).
- **Serves the renderer's own origin**, so `fetch('/api/...')` and `<img src="/api/...">` / embed iframes work without CORS or absolute URLs.

`mc.invokeOnServer` cannot replace the last point (no streaming, no WS, no DOM-element URL sources, no static asset serving). So the proxy must stay — but it doesn't need a global "active."

## Constraint from this conversation

**The artifact tree fetches from the server that owns the currently-selected session.** No global default needed; `currentSession.serverId` is the source of truth. When no session is selected, no artifact-tree query runs.

This eliminates category (a) outright: the only "default" the system needs is "the server of the currently-selected session," which is already a property of the session itself.

## Open Questions — Resolved

(Full detail in `research-kill-active-server-open-qs`.)

- **Q1 Routes** — Only two app routes (`/` and `/sidebar`). **Scheme:** `?srv=<id>&project=&session=` (query params, extends existing pattern). Updates: `SidebarView.tsx`, `useDataLoader` hook, `parseDeepLink` in `desktop/src/main/index.ts:127`.
- **Q2 VSCodium extension** — Already strictly diff-only (`extensions/vscode/src/extension.ts`). Receives only `ide_open_diff`, sends only `subscribe` + `ide_connected`. Single-server `serverUrl` config is fine for diff-only. **No code changes needed.**
- **Q3 No-session UX** — `ArtifactTree.tsx:932-941` already renders a "Select a session" empty state when `!currentSession`. `SubscriptionsPanel` is already the cross-server picker. Optional copy polish; no structural work.
- **Q4 ServerProxy fate** — **Refined Option B:** keep `ServerProxy`, drop `setUpstream`/active concept. Route HTTP via `/srv/<id>/api/...` and extend `resolveImageSrc.ts` + `milkdownEmbedBridge.ts` to inject `/srv/<id>` for non-fetch URLs (images, embeds). Minimal-disruption shipping fallback: keep upstream pinned to local sidecar permanently, use `mc.invokeOnServer` for non-local data, retrofit `/srv/<id>/...` only for image/embed URL resolvers.
- **Q5 Persistence** — Design doc was wrong. `Session` type (`ui/src/types/session.ts`) has **no `serverId` field**, and `sessionStore` is plain `create()` (no persist middleware). Both must be added — new **Step 0** prerequisite.
- **Q6 New-X picker inventory** — Only 3 sites need a server picker: **Create Session dialog** (`App.tsx:1347` / `CreateSessionDialog`), **TerminalDrawer `+`** (`TerminalDrawer.tsx:90`), **Add Project** (`MobileHeader.tsx:369` / `ProjectSelector.tsx:303`). Everything else already inherits server from context.

## End State

- No `activeServerId`, no `ServerContext.activeId`, no server switcher in the UI.
- `Session` carries `serverId`; `sessionStore` persists `currentSession` (with online-server validation on restore — fall back to picker if the server is gone).
- Every panel that lists artifacts/sessions/todos shows *all* servers' content (the unified pattern).
- Selecting a session implicitly selects its server — artifact tree, current-session view, and queries fetch via `mc.invokeOnServer(currentSession.serverId, ...)` or via `/srv/<id>/api/...` through the proxy when an origin-served URL is needed.
- "New X" actions either inherit server from context (3 sites prompt explicitly — see Q6) or default to the current session's server.
- WS events: Claude session / context messages ride the cross-server `WatchAggregator`, which already tags by `serverId`. No more consumer-side tagging.
- `ServerProxy` stays as a same-origin convenience for `fetch('/api/...')` + image/embed URLs, but is keyed by path (`/srv/<id>/...`), not by a mutable "active."
- Deep links use `?srv=<id>&project=&session=`.

## Migration Plan

Order chosen so each step is shippable on its own; nothing breaks until the last step.

### Step 0 — Add `serverId` to `Session`, persist `sessionStore` *(new prerequisite, small)*

- Add `serverId: string` to `Session` type in `ui/src/types/session.ts`.
- Backfill from any existing source (current session-creation flows already know which server they're talking to).
- Wrap `sessionStore` in `persist(...)` (or place `currentSession` in the existing persisted `uiStore`).
- On restore: validate `connections.has(serverId) && isOnline(serverId)`; if not, clear `currentSession` and show picker. Never silently route to a different server.
- **Outcome:** the source of truth for "which server am I working with" is now part of the session, not a global selector.

### Step 1 — Capability flags replace IDE/tmux gates *(small, un-regress)*

- `SubscriptionsPanel.tsx:208,310`: replace `sub.serverId === activeServerId` with a per-server capability check (`sub.serverHasTmux` or a probe response). The endpoint already returns `{ tmux: boolean }` after the just-shipped fix — extend the connection registry to remember the last-known capability and gate on that.
- **Outcome:** category (c) gone. Cross-server IDE actions work everywhere they're capable.

### Step 2 — Route Claude session/context WS events through the aggregator *(kills tagging hacks)*

- The `WatchAggregator` already opens a per-server WS bridge (`/_per-server/<id>/...`) and emits `{ serverId, msg }`. Extend its subscription set to include `claude_session_started`, `claude_session_ended`, `claude_context_update`.
- Update `App.tsx:962-992` and `SidebarView.tsx:25-33` to consume from the aggregator stream; drop the `activeId` tagging.
- **Outcome:** category (b) gone. Proxy WS no longer load-bearing for these events.

### Step 3 — Per-action server context for "new X" flows

Only 3 sites (Q6):
- **Create Session dialog** (`App.tsx:1347` / `CreateSessionDialog`) — add server picker, default to the currently-active row's server in `SubscriptionsPanel` (the dialog is usually opened from there).
- **TerminalDrawer "+"** (`TerminalDrawer.tsx:90`) — convert to a dropdown: "New terminal on ▾ Local / trimaxion / ...". Default to `currentSession.serverId` if any.
- **Add Project** (`MobileHeader.tsx:369` / `ProjectSelector.tsx:303`) — add server picker; default to local.
- `App.tsx:297` legacy-entry migration: hardcode to local-server-id, or delete the path entirely if no one hits it anymore.
- **Outcome:** category (a) gone (except the switcher itself, which Step 5 removes).

### Step 4 — Multi-server artifact tree + `/srv/<id>/...` proxy routing

- **Renderer:** the artifact-tree fetcher takes `serverId` and either calls `mc.invokeOnServer(serverId, ...)` or `fetch('/srv/<id>/api/...')` (pick per call-site — `mc.invokeOnServer` for JSON, the proxy path for image/embed `src` and any DOM-resolved URL).
- **Hook:** derive `serverId` from `currentSession.serverId`; no fetch when no session.
- **Proxy:** add `/srv/<id>/api/...` routing in `ServerProxy` that forwards to the matching upstream; keep the old `/api/...` path forwarding to the local sidecar (or remove once nothing uses it).
- **URL resolvers:** extend `resolveImageSrc.ts` and `milkdownEmbedBridge.ts` to inject `/srv/<id>` based on the owning artifact's server.
- Same pattern for current-session view queries.
- **Outcome:** the artifact tree, embeds, and image URLs all become server-aware. The Electron proxy stops needing a mutable "active."

### Step 5 — Delete `ServerContext.activeId`, the switcher UI, the `setUpstream` plumbing

- Once Steps 0-4 land, no reader of `activeId` remains except the switcher itself.
- Remove `useServer().activeId` and `setActive`. Rename `useServer()` → `useServers()`; expose connected list + per-server health/capabilities, no "active."
- Remove the server switcher UI.
- Remove `ServerProxy.setUpstream(...)` and the active-upstream pinning. The proxy now routes purely by path (`/srv/<id>/...`); the local sidecar may still be the "fallback" upstream for legacy `/api/...` paths until those are migrated.
- Update `parseDeepLink` (Q1) to set `serverId` + session from `?srv=&project=&session=`.

## Risks & Open Questions (residual)

- **Performance:** N servers means N parallel fetches for tree refresh. Already true for watching; should be fine. Verify with 3+ servers connected before Step 5.
- **Multi-server image URLs:** `/srv/<id>/api/images/...` must be resolved at the *artifact* level — an artifact from server A must not get a server-B path. Touchpoints: `resolveImageSrc.ts`, `milkdownEmbedBridge.ts`, anywhere a `<img>` is rendered from an artifact.
- **Legacy `/api/...` paths in the proxy:** keep the same-origin local-sidecar passthrough until all callers are migrated; flag dead callers as the migration proceeds.

## Suggested Order to Build

0. Step 0 (`serverId` + persist) — prerequisite, ~1 hour
1. Step 1 (un-regress capability flags) — ~30 min
2. Step 2 (WS via aggregator) — medium
3. Step 3 (per-action pickers — 3 sites) — small/medium
4. Step 4 (multi-server tree + `/srv/<id>/...`) — biggest change
5. Step 5 (delete active concept + switcher) — small once 0-4 land

Each step is independently shippable. The user-visible "no more switcher" moment is Step 5.
