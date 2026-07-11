# Wave 1 — sidebar-servers-and-header-simplification

## Tasks
- **header-strip-dropdowns**: removed project + session `<select>`s from `Header.tsx`; replaced with plain labels (`header-project-label` / `header-session-label`, full project path in `title=`). Pruned now-unused state/refs/effects/handlers + `react-router-dom` import. `HeaderProps` interface left intact for call-site stability.
- **sidebar-servers-section**: new `ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx` (forwardRef section with status dot + ServerIcon + label + host:port + active-row accent bar + hover-revealed remove for manual servers + inline `+ Add server` form). Mounted in `SidebarView.tsx` immediately above `<SubscriptionsPanel />`. Verified the actual `useServer()` shape includes `available/addServer/removeServer` — no IPC fallback needed. `ServerSwitcher.tsx` gained a JSDoc note flagging it as duplicated and slated for removal in Wave 3.
- **modal-add-project**: `SubscriptionsPanel.tsx` gained per-server `+ New project` affordance (inline absolute-path input under each `<details>` summary, Enter submits / Esc cancels). Calls `mc.invokeOnServer(serverId, '/api/projects')`; falls back to a local `pendingProjects[serverId]` list if the bridge is absent or the server rejects (e.g. remote path doesn't exist). Pending projects render as sub-group headers `{basename} (new — empty)`. Modal's empty-state branch reworked to always render server groups from `servers`, so users can add a project even when a server has no sessions yet. New state: `pendingProjects`, `addProjectOpenFor`, `addProjectInput`, `addProjectError`, `refreshTick` (added to fan-out effect deps).

## Verification
- Each implement agent ran tsc and reported no new errors on its files.
- Wave-level `npx tsc --noEmit` filtered to wave surface: clean (only pre-existing `allowtransparency` errors in `SubscriptionsPanel.tsx` lines 51/69, unrelated `ClaudePixAvatar` iframe attribute).
- Wave-level `npx vite build`: ✓ built in 27.14s.

## Wave TSC
Clean for the wave surface.
