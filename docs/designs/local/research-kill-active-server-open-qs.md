# Open Questions — Kill `activeServerId`

Companion to `design-kill-active-server` + `research-active-server-audit`.

---

## Q1 — Deep linking / URL routes

**Recommendation: query-param scheme (`?srv=<id>&project=<p>&session=<s>`), NOT a path segment.**

### Audit

Router setup is tiny — `ui/src/main.tsx`:
```
<Route path="/sidebar" element={<SidebarView />} />
<Route path="/*" element={<ServerProvider><App /></ServerProvider>} />
```

There are exactly two route shapes in the renderer:

1. `/` — the main app. Has no path segments. Selection state (current session, selected artifact, open tabs) lives in zustand stores, not in the URL.
2. `/sidebar?project=<p>&session=<s>` — the VS Code webview sidebar mode. `SidebarView.tsx` reads `useSearchParams()` for `project` and `session`. There is NO `serverId` in the URL today.

The deep-link protocol `mermaid-collab://<project>/<session>` is registered in `desktop/src/main/index.ts:127-139` (`parseDeepLink`). Currently parses but does not route (`// Routing comes later.`). It also has no `serverId`.

API URLs (`/api/diagram/:id?project=&session=`, `/api/document/:id?...`, `/api/design/:id/render?...`) all use **query params for project/session** — the codebase convention is "identity = path, scope = query." Adding `serverId` as a query param matches that style.

Other `window.location` reads are non-route (host rewriting in `EmbedViewer.tsx`, WS protocol in `websocket.ts`/`terminal-ws.ts`).

### Why query param over `/srv/<id>/...`

- **Migrates cleanly**: old `?project=&session=` URLs keep working; missing `srv` falls back to "first server that has this project/session" or surfaces a picker.
- **The router doesn't actually route on session/project today** — there's no `/session/:name` segment to extend. Switching to a path-based scheme would require introducing a routing layer for no gain.
- **VSCodium webview** (`SidebarView`) already uses `useSearchParams`; adding `srv` is one line.
- **Deep-link protocol** (`mermaid-collab://`) can extend to `mermaid-collab://<serverId>/<project>/<session>` (path-style, since it's not React Router) OR keep `mermaid-collab://<project>/<session>?srv=<id>` — the deep-link parser is custom, so either works.

### Files needing updates

| File | Change |
|---|---|
| `ui/src/views/SidebarView.tsx` | Read `srv` from `searchParams`; pass to data-loader so it routes via `mc.invokeOnServer`. |
| `ui/src/hooks/useDataLoader.ts` (and any callers it uses) | Accept `serverId`; route fetches per-server. |
| `desktop/src/main/index.ts:127-139` | Extend `parseDeepLink` to extract `serverId` (path or `?srv=` query). |
| `desktop/src/main/index.ts:148-159` | After parsing, set `currentSession` (with serverId) — currently TODO. |
| (none) — no `useNavigate`/`Link` in app code uses session/project paths. |

### Followups not in scope here

- If we ever introduce a real `/session/:name` route, revisit; `/srv/<id>/session/<name>` becomes attractive then.
- Outbound share/copy-link UI (if any) should produce URLs with `srv`.

---

## Q2 — VSCodium extension (confirm scope reduction)

**Recommendation: no code removal needed — the extension is already diff-only. One small followup: drop `mermaidCollab.update`'s reliance on `serverUrl` being a single server.**

### What the extension actually does

`extensions/vscode/src/extension.ts` (the only TS source) — 184 lines, fully read.

| Behavior | Lines | Status |
|---|---|---|
| WS connect to `mermaidCollab.serverUrl` (config; default `ws://127.0.0.1:9002/ws`) | 51-93 | Diff-only protocol. |
| Subscribe to channel `ide` | 63 | Required for diff broadcasts. |
| Send `ide_connected` with workspace folders / vscode version | 64-72 | Identification only; server uses it for the resolved-host display. |
| Receive `ide_open_diff` and call `openDiff()` | 75-82 | The single behavior. |
| `openDiff()` — resolve path on this host + `vscode.diff` against `HEAD` | 101-172 | Pure local file/git work. |
| Command `mermaidCollab.reconnect` | 23-25 | Local reconnect. |
| Command `mermaidCollab.update` — HTTP GET `/api/extension/js`, writes over its own bundle | 26-42 | Local extension self-update. |

Confirmed: the extension only **receives** `ide_open_diff` and does NOT send any RPCs/HTTP calls into the collab server beyond fetching its own update bundle. Top-of-file comment is explicit: "Single responsibility: when the collab server broadcasts `ide_open_diff`, open that file's working-tree diff (vs git HEAD) in the editor. Nothing else — terminal/tmux management and browser control were removed; the desktop app owns those now."

The server-side `ide_open_diff` flow lives in `src/services/ide-state.ts` + `src/routes/ide-routes.ts:106`; nothing else from the extension touches an API.

### What to do for the kill-active-server change

Nothing needs to be **removed**. Small considerations:

1. **`mermaidCollab.serverUrl` is single-server.** Today it points to one WS. After the multi-server change, if the user has multiple servers, the extension only listens to one. This is fine for the diff use case (the IDE only needs to react to the server whose workspace it has open). No change required unless we want IDE diffs across servers — not in scope.
2. **`mermaidCollab.update` hits `/api/extension/js`.** That endpoint is per-server (the extension JS is served by whatever server is configured). Already single-server today — no regression.

**Net: zero code removal. Extension is already aligned with the post-change world.**

---

## Q3 — "No session selected" UX

**Recommendation: (a) empty with a helpful "Pick a session" empty-state.** Already implemented; no work needed.

### Today's behavior

`ui/src/components/layout/sidebar-tree/ArtifactTree.tsx:503,932-941` already handles the empty case:

```tsx
const noSession = !currentSession;
...
if (noSession) {
  return (
    <div data-testid="sidebar-empty" className="p-4 text-sm text-gray-500">
      Select a session
    </div>
  );
}
```

The `SubscriptionsPanel` (always rendered, lists cross-server projects/sessions grouped per server, with `+ New project` / `+ New session` per server) IS the picker. Combined with the artifact tree's existing empty state, the post-change "no session selected" UX is already coherent:

- Top: subscriptions list (the picker) — works.
- Middle: terminals drawer / watching — already cross-server.
- Bottom: artifact tree empty state — already says "Select a session."

### Why not (b) browse-server mode

- The subscriptions panel already serves as "browse" UX — it shows all servers' projects/sessions in a tree, and clicking subscribes.
- Adding a separate per-server tree above the empty state would duplicate that and re-introduce a global concept.
- The "empty-state" approach makes the unselected state cheap (no N-server fanout fetches just to render a placeholder).

### Polish (optional)

Improve copy: change "Select a session" → "Pick a session from above to see its artifacts" (with arrow up icon). Cosmetic; no architecture work.

---

## Q4 — ServerProxy fate

**Recommendation: Option B (lightly) — keep ServerProxy as the *renderer's loopback origin* but make per-server fetches go through `mc.invokeOnServer`. ServerProxy keeps two real jobs: serve the renderer assets AND provide the `/_per-server/<id>/...` WS bridge. Drop `setUpstream` / "active" routing.**

### What ServerProxy does today (`desktop/src/main/server-proxy.ts`)

1. **HTTP proxy** to the current "active" upstream (`handleRequest` lines 64-83). Forwards everything, injects bearer token. Single upstream.
2. **WS proxy** to the same active upstream (`handleUpgrade` default branch lines 113-126).
3. **Per-server WS bridge** — URL pattern `/_per-server/<serverId>/<rest>` (lines 90-111) resolves the target via a `resolver` callback, opens a WS with the right token. Used today by terminal WS (`ui/src/lib/terminal-ws.ts`) and the WatchAggregator equivalent.
4. **Renderer origin**: the renderer is loaded as `http://127.0.0.1:<proxyPort>` (main/index.ts:276), so relative URLs work. This is also why the renderer can use `fetch('/api/...')` without CORS pain.

### Why not Option A (retire entirely)

`mc.invokeOnServer` does HTTP only, returns a buffered envelope `{ ok, status, body }`. It does **not** support:

- Streaming responses (e.g. `/api/diagram/:id/render` serving large SVGs, file downloads, SSE if any).
- WebSocket upgrade (terminals, watch events).
- Serving the renderer's own static assets — the renderer page itself loads from the proxy.
- Embeds that load via `<img>`/`<iframe>` with relative `/api/...` URLs (`milkdownEmbedBridge.ts`, `resolveImageSrc.ts`, image refs in diagrams). These are NOT JS fetches; they're DOM elements — `invokeOnServer` cannot serve them.

So killing ServerProxy entirely would require auditing every `<img src="/api/...">` and every embed renderer. Big change.

### Recommended Option B (refined)

1. **Keep ServerProxy**, but reframe it as "renderer origin + per-server WS bridge."
2. **Drop the default-upstream HTTP path.** Replace `/api/...` (which today hits the active server) with `/srv/<id>/api/...` (which routes to that specific server). All renderer fetches become server-explicit.
3. **Static asset path** (the renderer HTML/JS/CSS bundle) still served from the *local* server unconditionally — those are always-local assets, not per-server artifact data.
4. **Per-server image/embed URLs**: extend `resolveImageSrc.ts` / `milkdownEmbedBridge.ts` to inject `/srv/<id>` prefix using the artifact's owning serverId.
5. **Remove `setUpstream` / active concept** from ServerProxy. Resolver stays.

This is meaningfully larger work than Option A would have looked on paper, but it's correct — the `<img>`/`<iframe>` cases are the gotcha.

### Minimal-disruption fallback (recommended for Step 5 of the design)

If we want to ship Step 5 fast without rewriting image-resolution code:

- Keep `setUpstream` pointing at the **local sidecar** as a permanent default (it always exists).
- All `/api/...` paths (no `/srv/<id>/`) go to local. Images for *local* artifacts continue to work.
- For non-local artifacts: use `mc.invokeOnServer` for fetches; use `/srv/<id>/api/...` only for `<img>`/embeds (so we only need to update the URL resolvers, not the JS fetch path).

The full Option B is a followup, not a blocker for killing `activeServerId`.

---

## Q5 — currentSession persistence

**Recommendation: small code change required. `currentSession` is NOT persisted today; the `Session` type lacks `serverId`. Both must be added.**

### What I found

- `ui/src/types/session.ts` `Session` interface: `{ project, name, displayName?, lastActivity?, itemCount? }`. **No `serverId` field.**
- `ui/src/stores/sessionStore.ts`: created with plain `create(...)` — **no `persist` middleware**. `currentSession` is in-memory only; lost on reload.
- The only places that persist (`zustand/middleware/persist`) are `uiStore.ts`, `tabsStore.ts`, and `sidebarTreeStore.ts`. None of them store `currentSession`.

So the design doc's "Persistence: `currentSession` persistence already includes `serverId` (post cross-server epic)" is **incorrect**: neither persistence nor `serverId` exists yet on `currentSession`.

### What needs to change

1. **Add `serverId: string` to `Session` interface** (`ui/src/types/session.ts`). Make it required after a migration window; before that, treat missing as "local".
2. **Persist `currentSession`** — either:
   - Add `persist(...)` to `sessionStore` with `partialize: (s) => ({ currentSession: s.currentSession })`, OR
   - Add a small dedicated `lastSession` slot to `uiStore` (already persisted) and restore it on App mount.
3. **Restore-on-launch logic** in `App.tsx` boot:
   - If persisted `currentSession.serverId` is in `servers` list and online → restore.
   - If server is in list but offline → restore session metadata but show a "server offline" banner; tree shows empty/error state.
   - If server is no longer registered → clear `currentSession` and let the user pick from `SubscriptionsPanel`. Do NOT silently re-route to a different server.

### Set sites that need to include serverId

All `setCurrentSession({ project, name: session })` calls (`SidebarView.tsx:51`, `App.tsx:1359` etc.) must include `serverId`. Any caller that derives session from a subscription has the serverId already (`sub.serverId`); callers from `loadSessions()` need to be threaded through.

---

## Q6 — "New X" creation flows inventory

| Affordance | Location | Category | Notes |
|---|---|---|---|
| `+ New project` (per-server in subscriptions modal) | `SubscriptionsPanel.tsx:761` | **Inherits** (already per-server) | Already scoped by serverId — the button lives inside a `<details>` group keyed by `serverId`. No change. |
| `+ New session` (per-project, inside server group) | `SubscriptionsPanel.tsx:869` | **Inherits** (already per-server, per-project) | Already correct. |
| `Create Session` dialog (from sidebar / Header) | `App.tsx:1347-1359` + `CreateSessionDialog.tsx` | **Needs picker** | Currently calls `api.createSession(project, name)` which hits the proxy → active server. Must accept a `serverId` and route via `mc.invokeOnServer`. If launched without a server in context, prompt. |
| `+ Add server…` | `ServersTreeSection.tsx:154` | n/a | Adds a server entry; not artifact creation. Unaffected. |
| `+ Add variable` (env vars editor) | `EnvVarsEditor.tsx:138` | **Inherits** from current project | Per-project setting. Project already has implicit server. Unaffected as long as project carries its serverId. |
| `+ Add Node` / `+ Add State` / `+ Add Transition` (diagram/design editors) | `DiagramEditor.tsx:704`, `PropertiesPane.tsx:98`, `SmachPropertiesPane.tsx:193` | **Inherits** from currently-open artifact | Edits an existing artifact in the open tab. The artifact already has a `serverId` (transitive from its session). Unaffected. |
| `New terminal` (`+` in TerminalDrawer) | `TerminalDrawer.tsx:90` | **Needs picker** when no session selected | Today uses active server. Per design Step 4, dropdown anchored to current session's serverId, fallback "Choose server…". |
| `New tab` (browser pane) | `BrowserPanel.tsx:127` | n/a | Browser tab, not a server artifact. |
| `+ Add server` (MCP servers panel) | `McpServersPanel.tsx:67` | **Inherits** from current session/server | MCP config is a per-server thing; the panel should already be scoped to the open session's server. Verify but no design change. |
| `Add Project` (mobile header / ProjectSelector) | `MobileHeader.tsx:369`, `ProjectSelector.tsx:303` | **Needs picker** | Top-level "add a project" — needs to ask "to which server?" Default = local. |
| `Diagram` / `Document` / `Design` / `Spreadsheet` / `Snippet` creation | (no UI affordance for these found in renderer outside MCP tools / API) | n/a | Created today via MCP or auto-import flows that already carry `(project, session)` and therefore can carry `serverId`. No UI button to update. |
| Drag-drop import to artifact tree | `ArtifactTree.tsx:505-516` | **Inherits** from `currentSession` | Already uses `currentSession.project/.name`; just needs `serverId` from it. |
| Legacy-entry migration | `App.tsx:297` | Removed by Step 5 | Hardcode to local-server-id per the design doc. |
| Server-switcher UI | `ServersTreeSection.tsx`, plus the header switcher | Removed by Step 5 | Goes away with the concept. |

### Summary

- **Already correct (no work)**: `+ New project`, `+ New session` (subscriptions modal), in-editor adds, env var/MCP adds, drag-drop import.
- **Need serverId threaded through**: `Create Session` dialog (App.tsx), `TerminalDrawer +`, `Add Project` (mobile/ProjectSelector). These are the only real picker work items.
- **Goes away**: legacy-entry migration, switcher UI.
