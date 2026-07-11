# Design — Sidebar Servers + Header Simplification + Modal add-Project/Session

A single coordinated reshape of the navigation surface that grows out of the
cross-server unified watching arc. Today's header carries three selection
controls (server dropdown, project dropdown, session dropdown), and the
Subscribe modal only lists existing sessions on each server. After this
change:

- **The header has no dropdowns.** It shows the *current* project and session
  as plain labels (read-only). All selection moves elsewhere.
- **Servers move into the sidebar** as a dedicated `Servers` section that sits
  **above Watching**. Clicking a server label still selects "active" for any
  caller that still needs it (terminal-via-`+`-button, browser pane creates),
  but switching is a sidebar click, not a header click.
- **Subscribe modal** (the `+` next to Watching) grows two new affordances:
  - **Add project** — point at a project root not currently tracked on a
    selected server, register/select it there.
  - **Add session** — create a new session under a selected project on a
    selected server.
  - The existing per-server session list still appears for direct subscription.

## Why now
With watching, terminals, and icons already cross-server (commit `ea1e63a`)
and the `mc:invokeOnServer` IPC available, the header dropdowns are vestigial
— they bias the renderer toward a single "active" server when the actual model
is "every subscription targets its own server." Moving servers to the sidebar
makes selection visible alongside watching, removes the modal mismatch (you
shouldn't have to switch active server to subscribe to a different one), and
declutters the header.

## Source artifacts the agents should consult
- `research-cross-server-watching` — current architecture map (what the per-
  server IPC supports, where active-server still matters, etc.).
- Commit `ea1e63a` — cross-server unified watching + terminals + icons.
- `Header.tsx`, `ServerSwitcher.tsx`, `SubscriptionsPanel.tsx` for the current
  state of each surface.

## 1. Structure Summary

Three roughly-independent file groups:

1. **Header (`ui/src/components/layout/Header.tsx`)** — remove the project +
   session selectors. Replace with non-interactive labels showing the current
   project's basename + session name. Keep the theme toggle, zoom controls,
   VSCode-connected pill, server-switcher icon (now opens a tiny menu that
   focuses the sidebar Servers section — or remove the header's server icon
   entirely since it duplicates the sidebar). Probably **remove** the header
   `<ServerSwitcher />` mount; the sidebar takes over.

2. **Sidebar Servers section** (new — `ui/src/components/layout/sidebar-tree/
   ServersTreeSection.tsx`, mounted above `<SubscriptionsPanel />` in
   whichever component owns the sidebar — `SidebarView.tsx` likely). Each row
   shows: `<ServerIcon name={s.icon}> <label> <host:port>` and a connection
   dot. Clicking a row sets it active (mirrors today's `switchServer`). An
   `+ Add server` row at the bottom opens the existing add-server form
   (relocated from `ServerSwitcher`'s manual-add UI).

3. **Subscribe modal additions (`SubscriptionsPanel.tsx`)** — under each
   server group in the existing modal, add two affordances:
   - `+ New project on <server>` opens a one-shot project-path input
     (reuses `/api/projects` POST if it exists, otherwise add it; needs a
     `mc:invokeOnServer` round-trip).
   - `+ New session in <project>` opens a session-name input under each
     server's project list. POSTs `/api/sessions` on that server via
     `mc.invokeOnServer`, then auto-subscribes.

## 2. Function / Task Blueprints

Per-task file scope + acceptance criteria:

### Task A — `header-strip-dropdowns`
Files:
- `ui/src/components/layout/Header.tsx`
- Possibly `ui/src/views/MainView.tsx` or wherever Header receives props
- Tests in `ui/src/components/layout/__tests__/*.test.tsx` that assert the
  removed dropdowns — update to assert label rendering.

Description: Remove the project `<select>` and session `<select>` from
Header. Render the current project (basename, full path as tooltip) and the
current session name as plain `text-sm` labels in their place. Keep
everything else (theme toggle, zoom +/-, VSCode-connected pill, refresh
button). Decide whether to keep the `<ServerSwitcher />` mount in the
header; **default: remove it**, the sidebar takes over. If kept, drop the
duplicate label-button + reduce to icon only.

Acceptance:
- Header height unchanged (or smaller).
- Current project basename + session name visible; tooltip shows full path.
- No `<select>` elements in the header.
- `ServerSwitcher` no longer mounted in header (or stripped to icon-only).
- Existing tests updated / new test asserts labels render.

### Task B — `sidebar-servers-section`
Files:
- NEW `ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx`.
- `ui/src/views/SidebarView.tsx` (mount the new section above
  `<SubscriptionsPanel />`).
- May factor pieces out of `ui/src/components/ServerSwitcher.tsx` (the add-
  server form, the remove/probe buttons) into the new section or a
  shared component.

Description: A new `Servers` tree section, collapsible like Watching. Each
row:
- `<ServerIcon name={s.icon}>` + status dot + `{label}` + `{host:port}` muted.
- Hover: shows a small `Switch` action — sets this server active. The current
  active server row gets a left-edge accent bar (mirror `SubscriptionRow`).
- Hover: shows a remove `×` for manual servers (NOT for `source: 'local'`).
At the bottom of the section: an `+ Add server` row that toggles an inline
form (label / host / port / token) — the same fields the old
`ServerSwitcher` had. On submit, calls `mc.addServer({...})` and refreshes
the server list.

Acceptance:
- Servers list renders with icon + label + host:port + status dot.
- Clicking a row switches active (uses existing `useServer().switchServer`).
- Manual add works end-to-end (no regression vs. today's `ServerSwitcher`).
- Manual remove works (only manual servers; local entries refuse with a
  tooltip explaining `forgotten`).

### Task C — `header-remove-server-switcher`
Files: `ui/src/components/layout/Header.tsx` (final pass after Task A — drop
the `<ServerSwitcher />` mount cleanly), and possibly a test cleanup.

Description: A cleanup pass that removes `<ServerSwitcher />` from the
header layout entirely, deletes the import, and removes any header-side
state that only supported it. The sidebar section now owns server selection.

Acceptance:
- `Header.tsx` no longer imports or mounts `ServerSwitcher`.
- Layout settles without the dropdown's width contribution.

### Task D — `modal-add-project`
Files:
- `ui/src/components/layout/SubscriptionsPanel.tsx`
- Possibly server-side `src/routes/api.ts` if a project-registration
  endpoint doesn't already exist (verify first — there's likely
  `/api/projects` POST or sessions auto-create on first reference).

Description: Under each server group in the Subscribe modal, add a small
`+ Add project` button that toggles an inline absolute-path input. On
submit, call `mc.invokeOnServer(serverId, { path: '/api/projects', method:
'POST', body: { path } })` (or whichever existing endpoint registers a
project). On success, refresh `crossServerSessions` for that server so the
modal's group re-fetches its session list — the new project will appear
empty until a session is added (Task E).

Acceptance:
- Pressing `+ Add project` reveals the input; submit creates the project on
  the chosen server.
- Modal refreshes that server's group so new projects appear.

### Task E — `modal-add-session`
Files: `ui/src/components/layout/SubscriptionsPanel.tsx`.

Description: Under each project in the modal (each server's session group is
already grouped by project — verify), add `+ New session`. On submit, call
`mc.invokeOnServer(serverId, { path: '/api/sessions', method: 'POST', body:
{ project, session } })` (REST endpoint already exists). On success,
auto-subscribe via `subscribe(serverId, project, sessionName)` and refresh
that server's group.

Acceptance:
- `+ New session` button under each project (or per-server) creates the
  session on the chosen server and subscribes to it automatically.
- The new subscription appears in the Watching list (composite key includes
  serverId).
- Plays nicely with the cross-server fan-out — no active-server switch.

### Task F — `modal-cleanup-and-back-compat`
Files: `ui/src/components/layout/SubscriptionsPanel.tsx`,
`ui/src/components/ServerSwitcher.tsx` (if any of its responsibilities move).

Description: Tighten up the modal after D + E land: visual order is
`+ Add server (link to sidebar) · per-server group [ + project / + session ·
existing sessions ]`. Remove anything the sidebar Servers section now owns
that's still duplicated. Document the new mental model briefly in a
file-header comment.

Acceptance:
- Modal is the single place for subscribe + create-new flows.
- ServerSwitcher.tsx is deleted OR reduced to an inline component
  (decision: delete if the sidebar fully covers it).

## 3. Task Dependency Graph

### YAML

```yaml
tasks:
  - id: header-strip-dropdowns
    files:
      - ui/src/components/layout/Header.tsx
    tests: []
    description: "Remove project + session <select>s from header; render plain text labels for current project basename and session name."
    parallel: true
    depends-on: []
  - id: sidebar-servers-section
    files:
      - ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx
      - ui/src/views/SidebarView.tsx
      - ui/src/components/ServerSwitcher.tsx
    tests: []
    description: "New ServersTreeSection above Watching: icon + label + host:port + status dot per row; click switches active; manual add-server form; manual remove. Reuse logic from ServerSwitcher."
    parallel: true
    depends-on: []
  - id: header-remove-server-switcher
    files:
      - ui/src/components/layout/Header.tsx
    tests: []
    description: "Remove the <ServerSwitcher /> mount from Header now that the sidebar Servers section owns selection."
    parallel: false
    depends-on: [header-strip-dropdowns, sidebar-servers-section]
  - id: modal-add-project
    files:
      - ui/src/components/layout/SubscriptionsPanel.tsx
    tests: []
    description: "Under each server group in the Subscribe modal, add `+ Add project` that POSTs a new project path via mc.invokeOnServer and refreshes the group."
    parallel: true
    depends-on: []
  - id: modal-add-session
    files:
      - ui/src/components/layout/SubscriptionsPanel.tsx
    tests: []
    description: "Under each project in the modal, add `+ New session` that POSTs /api/sessions via mc.invokeOnServer and auto-subscribes to the new session."
    parallel: false
    depends-on: [modal-add-project]
  - id: modal-cleanup-and-back-compat
    files:
      - ui/src/components/layout/SubscriptionsPanel.tsx
      - ui/src/components/ServerSwitcher.tsx
    tests: []
    description: "Final pass: tighten modal layout post-D+E; delete ServerSwitcher.tsx if the sidebar fully covers its surface area, else reduce to a single icon entry-point."
    parallel: false
    depends-on: [modal-add-project, modal-add-session, sidebar-servers-section]
```

### Execution Waves

- **Wave 1 (parallel):** header-strip-dropdowns, sidebar-servers-section, modal-add-project
- **Wave 2 (parallel):** header-remove-server-switcher (← header-strip-dropdowns + sidebar-servers-section), modal-add-session (← modal-add-project)
- **Wave 3:** modal-cleanup-and-back-compat (← Wave 2)

### Summary
- Total tasks: 6
- Total waves: 3
- Max parallelism: 3
- Touches `Header.tsx` twice (Wave 1 then Wave 2) — agents handling header must coordinate by reading the file fresh in Wave 2.
- One new file: `ServersTreeSection.tsx`. Possibly one deletion: `ServerSwitcher.tsx`.
- Server-side: probably nothing new needed (verify `/api/projects` POST exists or just rely on session POST auto-creating the project dir).

## Verify gates per task

- After each task: `npx vite build` succeeds; no new tsc errors on touched files.
- After Wave 3: full UI vite build; manual smoke (open the app, subscribe to a session from each server, switch active via sidebar, header shows labels only).

## Risks / open questions

1. **`/api/projects` POST endpoint** — may not exist on the server. If so, two
   options: (a) lazily auto-create on first session creation under that
   project (existing behavior?), making "add project" effectively the same
   gesture as "add session under a new project name"; (b) add the endpoint.
   Verify before implementing Task D — if (a) is true, Task D becomes a
   no-op or a thin UX-only affordance that pre-pends a path validation step
   before "add session."
2. **Active server still required by some flows** (terminal `+` button uses
   `activeId`, browser pane creates use it). The sidebar Servers section's
   "switch active" affordance covers this — but agent should verify nothing
   else couples to header's dropdowns.
3. **ServerSwitcher deletion**: needs care if anything else imports it. Grep
   before deleting.
