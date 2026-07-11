# Completeness Review

All six blueprint tasks are implemented; build passes; no stubs found.

## Task verification

### 1. header-strip-dropdowns — COMPLETE
`ui/src/components/layout/Header.tsx`
- No `<select>` elements (verified).
- `data-testid="header-project-label"` (line 205) with `title={currentSession?.project ?? ''}` (line 206).
- `data-testid="header-session-label"` (line 213).
- NavMenu still mounted (line 98) — spec only required ServerSwitcher be absent.
- No `ServerSwitcher` import or mount.

### 2. sidebar-servers-section — COMPLETE
`ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx` exists with:
- Status dot, ServerIcon, label, host:port, active-row accent bar (left, w-1).
- Inline `+ Add server…` form with label/host/port/token inputs.
- Manual servers (`s.source === 'manual'`) get hover-revealed remove button; local servers don't.
- Mounted in `ui/src/components/layout/Sidebar.tsx` (line 81) above `SubscriptionsPanel` (line 82).
- Mounted in `ui/src/views/SidebarView.tsx` (line 66) above `SubscriptionsPanel` (line 67).

### 3. header-remove-server-switcher — COMPLETE
Header.tsx no longer imports or mounts `ServerSwitcher`.

### 4. modal-add-project — COMPLETE
`ui/src/components/layout/SubscriptionsPanel.tsx`
- `pendingProjects`, `addProjectOpenFor`, `addProjectInput`, `addProjectError`, `refreshTick` state present (lines 350–357).
- `refreshTick` is in fan-out effect deps (line 484).
- `handleAddProject` POSTs `/api/projects` via `mc.invokeOnServer` with fallback to `pendingProjects[serverId]` (lines 486–520).
- Empty-state branch reworked: every known server gets a group via the `rendered` array even when items are empty (lines 672–687), so users can add a project to an empty server.

### 5. modal-add-session — COMPLETE
- `addSessionOpenFor`, `addSessionInput`, `addSessionError` state present (lines 354–356).
- `handleAddSession` POSTs `/api/sessions` via `mc.invokeOnServer`, auto-subscribes on success (line 547).
- Promotes pending projects by dropping them from `pendingProjects` on success (lines 550–555).
- Per-project + New session affordance rendered inside each project group.
- Visual order: server header → + New project → pending projects → existing projects, each with + New session (lines 765–772).

### 6. modal-cleanup-and-back-compat — COMPLETE
- `ui/src/components/ServerSwitcher.tsx` and `ServerSwitcher.test.tsx` deleted (glob returned no matches).
- `SubscriptionsPanel.tsx` carries the new top-of-file JSDoc explaining the mental model (lines 1–12).

## Other spec checks

- Modal tree indentation: project headers `pl-7` (line 781), session rows `pl-10` (line 793) — just session name shown (`s.displayName || s.name`), no `project / session` prefix.
- `handleNavigate` no longer calls `switchServer` for cross-server rows: it returns early when `sub.serverId !== activeId` (lines 568–578).

## Stub scan
No `TODO`, `throw new Error('Not implemented')`, or `NotImplementedError` in any of the changed files.

## Build
`npx vite build` → `built in 28.79s` (passes).

## Result
Everything complete. 0 gaps found.
