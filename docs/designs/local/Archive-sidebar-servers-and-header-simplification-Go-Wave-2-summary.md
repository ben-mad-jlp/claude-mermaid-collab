# Wave 2 — sidebar-servers-and-header-simplification

## Tasks
- **header-remove-server-switcher**: dropped the `<ServerSwitcher />` import + mount from `Header.tsx`. The sidebar `ServersTreeSection` (Wave 1) now owns all server selection. Wrapper kept (had non-ServerSwitcher siblings).
- **modal-add-session**: added per-project `+ New session` affordance inside each server's `<details>` block in the Subscribe modal. New state: `addSessionOpenFor`, `addSessionInput`, `addSessionError`. New callback `handleAddSession(serverId, project)` POSTs `/api/sessions` via `mc.invokeOnServer`; on success it auto-subscribes (so the new session lands in Watching immediately), promotes the project out of `pendingProjects` if it was a Wave-1 pending, and bumps `refreshTick` to re-fetch. Items within each server group are now grouped by project (union of real items + pending), each with its `+ New session` button keyed by `${serverId}|${project}`.

## Verification
- Each implement agent ran tsc and reported no new wave-related errors.
- Wave-level tsc filtered to wave surface: clean (only pre-existing `allowtransparency` errors).
- Wave-level `npx vite build`: ✓ built in 27.75s.

## Wave TSC
Clean.
