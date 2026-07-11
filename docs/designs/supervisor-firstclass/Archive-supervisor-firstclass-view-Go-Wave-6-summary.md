# Wave 6 Implementation (final)

## Tasks
- **notifications-railentry**: 
  - `ui/src/stores/uiStore.ts`: added `supervisorViewOpen` + `setSupervisorViewOpen` + `toggleSupervisorView`.
  - `ui/src/components/layout/Header.tsx`: shield button with open-escalation count badge (red pill), active when supervisorViewOpen, count from useSupervisorStore.
  - `ui/src/App.tsx`: (A) `escalation_created` WS handler → `addToast({type:'warning', title:'New escalation', ...})` (early return, fires regardless of active session, 8s); (B) mounts `SupervisorView` as main content when `supervisorViewOpen` (replaces editor view). No new routing layer.
- **panel-deeplink** (`ui/src/components/layout/SupervisorPanel.tsx`): added optional `onOpenSupervisorView?` prop + a header link button (renders only when provided); clarified start-button tooltip.

## Post-wave wiring (main context)
- `Sidebar.tsx` + `SidebarView.tsx`: pass `onOpenSupervisorView={() => useUIStore.getState().setSupervisorViewOpen(true)}` so the panel deep-link actually opens the view (closed the loose end; added useUIStore imports).

## Verification
- UI tsc clean; root tsc clean (after wiring).

## Deferred follow-ups (not blocking)
- Real "running" heartbeat state on the identity bar (currently neutral dot + TODO).
- 'crashed' onboarding state detection (component supports it; not yet triggered by the shell).
- Escalation toast dedup TOCTOU (acceptable for single-process Bun SQLite).
