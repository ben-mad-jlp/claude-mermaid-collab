# Blueprint: Sidebar Servers + Header Simplification + Modal add-Project/Session

## Source Artifacts
- `design-sidebar-servers-and-header-simplification` — the design intent.
- `research-cross-server-watching` — current architecture map (per-server IPC, where "active" still matters, store shapes).
- Commit `ea1e63a` — cross-server unified watching + terminals + icons (the foundation this builds on).

## 1. Structure Summary

A single coordinated reshape of the navigation surface:

- **Header loses its dropdowns.** Current project basename + session name become non-interactive labels.
- **Servers move to a new sidebar tree section** above Watching. Selection, add, remove, switch all happen there.
- **Subscribe modal grows two affordances** under each server group: `+ New project` and `+ New session`.

### Files

#### New
- [ ] `ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx` — the new Servers section. Mirrors `TodosTreeSection`/`SubscriptionsPanel` styling. Each row: `<ServerIcon> · status-dot · label · host:port` + hover-revealed `Switch` / `Remove`. A `+ Add server` row at the bottom toggles an inline form (label / host / port / token).

#### Modified
- [ ] `ui/src/components/layout/Header.tsx` — strip the two `<select>`s and the `<ServerSwitcher />` mount. Render the current project basename + session name as plain `text-sm` labels (with full path tooltips). Keep theme toggle, zoom controls, VSCode-connected pill.
- [ ] `ui/src/views/SidebarView.tsx` — mount `<ServersTreeSection />` above `<SubscriptionsPanel />`.
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — under each server group in the Subscribe modal, add `+ New project` (inline path input → `POST /api/projects` if it exists, else falls through to session-create which auto-creates the project dir on the server) and per-project `+ New session` (inline name input → `POST /api/sessions` via `mc.invokeOnServer`, then `subscribe(serverId, project, sessionName)`). Re-fetch that server's session list after a successful create.

#### Possibly Deleted
- [ ] `ui/src/components/ServerSwitcher.tsx` — its surface (label-button to switch, manual add form, remove button) is fully absorbed by `ServersTreeSection`. Delete after Task C confirms no other importers remain.

### Type Definitions

No new persisted types. The `ServerInfo` shape exposed by `ServerContext` already carries `{ id, label, host, port, status, source, icon }` — sufficient for the new section.

A small local prop type for the new section:

```ts
interface ServersTreeSectionProps {
  collapsed?: boolean;
  onToggle?: () => void;
}
```

### Component Interactions

```
SidebarView
├── ServersTreeSection            ← NEW (above Watching)
│   ├── useServer() · servers, activeId, switchServer
│   ├── window.mc.addServer / removeServer / probeServer
│   └── + Add server inline form
└── SubscriptionsPanel            ← MODIFIED (add-project / add-session)
    ├── existing subscribe flow
    └── modal: per-server [ icon · label ] → [ + New project · + New session · existing sessions ]

Header                            ← MODIFIED (strip dropdowns)
├── (labels) current project basename + session name
├── theme toggle / zoom / VSCode-connected
└── (REMOVED) project select / session select / ServerSwitcher
```

`useServer()` keeps doing what it does — `switchServer(id)` still exists; only its UI affordance moves from header → sidebar.

---

## 2. Function Blueprints

### `ServersTreeSection` (new component)

**Pseudocode:**
1. Read `{ servers, activeId, switchServer }` from `useServer()`.
2. Render `<SectionBranchRow id="servers" title="Servers" count={servers.length} />`.
3. When expanded: map each `s` to a row:
   - `<ServerIcon name={s.icon} size={14} />`
   - Status dot (re-use the existing color logic from current `ServerSwitcher.tsx` — `dot[s.status]`).
   - Label + `{host}:{port}` muted.
   - `s.id === activeId` → left-edge accent bar (mirror `SubscriptionRow`).
   - Click row → `switchServer(s.id)`.
   - Hover: `× Remove` (manual servers only — `s.source === 'manual'`); titled "remove" / disabled with tooltip for local.
4. Bottom: `+ Add server` toggle. Inline form with `label`, `host`, `port`, optional `token`. Submit → `window.mc.addServer({...})` → refresh.

**Error handling:** add-server errors render under the form in a small red text span; row-level remove failures fall back silently (store sync covers).

**Edge cases:** no servers (empty state row); add form open when collapsed (close on collapse); duplicate host:port (existing add API rejects — surface the error).

**Test strategy:** lightweight unit (mock `window.mc` + `useServer`) — render list, click switch, click +, submit add. Mirror `TodosTreeSection.test.tsx` style if present, otherwise skip tests in this pass (the surface is well-covered by manual + the existing `ServerSwitcher` tests).

### `Header` (modified)

**Pseudocode:**
1. Read `currentSession` from the session store as today.
2. Replace the project `<select>` with a `<span>` showing `currentSession?.project?.split('/').pop() ?? '—'`, with full path as `title=`.
3. Replace the session `<select>` with a `<span>` showing `currentSession?.name ?? '—'`, with `data-testid="header-session-label"` (preserved test hook).
4. Remove the `<ServerSwitcher />` mount (after Task C; in Task A leave it in place to keep layout balanced).
5. Keep refresh button (it still triggers `refreshProjectsAndSessions` for the active server — useful when servers section adds new ones).

**Error handling:** none introduced.

**Edge cases:** no current session → render an em-dash. Long project paths → truncate with `max-w-[200px] truncate`.

**Test strategy:** update existing Header tests that asserted `<select>`s — they now assert `<span>` with the same content via `data-testid`.

### `SubscriptionsPanel` (modified, two new sub-features)

**`+ New project` (inline form under each server group):**
1. State: `{[serverId]: { open: bool, draft: string }}` — local component state.
2. Toggle button reveals a tiny input + submit button.
3. On submit:
   - Validate absolute path (starts with `/`).
   - Call `mc.invokeOnServer(serverId, { path: '/api/projects', method: 'POST', body: { path } })`.
   - On 404 (endpoint may not exist), fall back to a no-op success (we'll auto-create with the next session POST).
   - On success/fallback: clear draft, close form, re-fetch `mc.listSessionsForServer(serverId)` and merge into `crossServerSessions`.

**`+ New session` (inline form under each project in a server group):**
1. State: `{[serverId+project]: { open, draft }}`.
2. On submit:
   - Validate non-empty name.
   - Call `mc.invokeOnServer(serverId, { path: '/api/sessions', method: 'POST', body: { project, session: draft } })`.
   - On success: `subscribe(serverId, project, draft)` so it lands in Watching immediately.
   - Re-fetch the server's group so the new session appears as already-subscribed and ungrouped from the create-new affordance.

**Error handling:** failed POSTs surface a small red text inline under the form; preserves form state for retry.

**Edge cases:**
- Project path that doesn't exist on the remote (server returns 4xx — surface message).
- Duplicate session name (existing endpoint will reject — surface).
- Tokens stay in main; renderer just calls `mc.invokeOnServer`.

**Test strategy:** mock `window.mc.invokeOnServer` and `subscribe` — assert form flows and subscribe call.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: header-strip-dropdowns
    files: [ui/src/components/layout/Header.tsx]
    tests: []
    description: "Replace project + session <select>s in Header with non-interactive labels (project basename + session name). Keep ServerSwitcher mount + theme/zoom/VSCode pill in place for now."
    parallel: true
    depends-on: []
  - id: sidebar-servers-section
    files:
      - ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx
      - ui/src/views/SidebarView.tsx
      - ui/src/components/ServerSwitcher.tsx
    tests: []
    description: "New ServersTreeSection above Watching: icon + label + host:port + status dot per row; click switches active; manual add-server form; manual remove. Reuse shape/affordances from ServerSwitcher; coexist with the header mount until Task C."
    parallel: true
    depends-on: []
  - id: modal-add-project
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Under each server group in the Subscribe modal, add `+ New project` that posts a new project path via mc.invokeOnServer (or falls back to lazy create via the next session POST) and refreshes the server group."
    parallel: true
    depends-on: []
  - id: header-remove-server-switcher
    files: [ui/src/components/layout/Header.tsx]
    tests: []
    description: "Cleanup pass: remove the <ServerSwitcher /> mount + import from Header now that the sidebar Servers section owns selection. Layout settles without the dropdown's width contribution."
    parallel: false
    depends-on: [header-strip-dropdowns, sidebar-servers-section]
  - id: modal-add-session
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Under each project in the modal, add `+ New session` that posts /api/sessions via mc.invokeOnServer and auto-subscribes to the new session. Plays nicely with cross-server fan-out (no active-server switch)."
    parallel: false
    depends-on: [modal-add-project]
  - id: modal-cleanup-and-back-compat
    files:
      - ui/src/components/layout/SubscriptionsPanel.tsx
      - ui/src/components/ServerSwitcher.tsx
    tests: []
    description: "Final pass: tighten modal layout after Tasks D/E; if no remaining importers, delete ServerSwitcher.tsx (its surface is fully owned by ServersTreeSection now). Document the new mental model briefly in a file-header comment."
    parallel: false
    depends-on: [header-remove-server-switcher, modal-add-session, sidebar-servers-section]
```

### Execution Waves

**Wave 1 (parallel):**
- header-strip-dropdowns
- sidebar-servers-section
- modal-add-project

**Wave 2 (depends on Wave 1):**
- header-remove-server-switcher (← header-strip-dropdowns + sidebar-servers-section)
- modal-add-session (← modal-add-project)

**Wave 3 (depends on Wave 2):**
- modal-cleanup-and-back-compat (← all of Wave 2)

### Summary
- Total tasks: 6
- Total waves: 3
- Max parallelism: 3
- New file: 1 (`ServersTreeSection.tsx`).
- Possibly deleted file: 1 (`ServerSwitcher.tsx`).
- No persisted-data changes; no MCP/REST schema changes.
- Verify gate per task: `npx vite build` succeeds; no new tsc errors on touched files.
- Final manual smoke: open app, sidebar Servers section renders + switches; header shows labels only; Subscribe modal lets you add a new project + session on either server without flipping the active server.
