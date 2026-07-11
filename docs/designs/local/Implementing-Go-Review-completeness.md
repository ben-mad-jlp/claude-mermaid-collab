# Completeness Review — kill-active-server

## Summary
All 20 tasks of the blueprint are implemented. End-state goals met. 2 minor stale-reference gaps (test file + comment) — non-functional.

## Task / Wave Status
- Wave 1 summary: complete (session-type-serverid, connection-capabilities, aggregator-claude-events, proxy-srv-routing).
- Wave 2 summary: complete (13 tasks).
- Wave 3 summary doc was NOT found by id `Implementing-Go-Wave-3-summary`, but its tasks (artifact-tree-multi-server, create-session-picker, terminal-drawer-picker, add-project-picker) all show up implemented in wave 2 doc and in code.
- Wave 4-5 summary: complete (server-context-cleanup, proxy-setupstream-remove, delete-switcher-ui).

## End-State Goal Verification
- No activeServerId / ServerContext.activeId / switcher: confirmed. `useServers()` exposes `{ available, servers, refresh, addServer, removeServer }`. App.tsx and SubscriptionsPanel locally derive `activeServerId = currentSession?.serverId` (allowed pattern per Wave 4-5 doc).
- Session.serverId + sessionStore persist + restore validation: present (`ui/src/types/session.ts:7`, `ui/src/stores/sessionStore.ts:215 persist(...)`, `validateAgainstServers` at 592, `hydrated` at 53/183, `onRehydrateStorage` at 609).
- Per-panel all-server display: confirmed (SubscriptionsPanel iterates `servers`).
- Implicit server selection via session: confirmed (`currentSession.serverId`).
- "New X" pickers: CreateSessionDialog has `<select>` server picker (line 69-71); TerminalDrawer `+` has dropdown (`menuServers`, defaults to `currentSession.serverId`); AddProjectDialog exists with picker and is exported.
- WS via cross-server aggregator: confirmed (Wave 1 aggregator already had it; consumers updated).
- ServerProxy keyed by path: `/srv/<id>/...` route in `desktop/src/main/server-proxy.ts`; `localUpstream` is `readonly` constructor param; no `setUpstream`.
- Deep links `?srv=...`: `parseDeepLink` at `desktop/src/main/index.ts:124` extracts `srv`.

## Specific Verifications
- `useServer` → `useServers`: renamed in production code. STRAGGLER: `ui/src/contexts/ServerContext.test.tsx` still imports `useServer` and references `activeId`/`switchServer`/`getActiveServer` — stale test file, will fail.
- `setUpstream` removed: gone from production. STRAGGLER: `desktop/src/main/__tests__/server-proxy.test.ts` still calls `proxy.setUpstream(...)` in 6 places — stale test file, will fail.
- `mc:switchServer` / `mc:getActiveServer` removed from preload + main: confirmed (no hits in `desktop/src`). Stale doc comment in `ui/src/stores/subscriptionStore.ts:40` mentions `mc.getActiveServer()` — comment only, harmless.
- `/srv/<id>/api/...` routing: confirmed in `desktop/src/main/server-proxy.ts`.
- `apiFetch` helper: confirmed at `ui/src/lib/api.ts:62` and used throughout the file.
- `resolveImageSrc` + `milkdownEmbedBridge` `/srv/<id>` prefix: confirmed. NOTE: blueprint listed paths under `ui/src/utils/`, actual location is `ui/src/lib/resolveImageSrc.ts` and `ui/src/lib/milkdownEmbedBridge.ts` — fine, just relocated.
- `Session.serverId: string`: confirmed (`ui/src/types/session.ts:7`).
- `sessionStore` wrapped in `persist(...)` with `validateAgainstServers`: confirmed.
- `AddProjectDialog.tsx` exists and exported from `dialogs/index.ts:5`.
- `CreateSessionDialog.tsx` has server picker: confirmed (`<select>` at line 69-71, prop `defaultServerId`).
- `TerminalDrawer.tsx` has `+` dropdown: confirmed.
- `ServersTreeSection.tsx` no click-to-switch: confirmed — only onClick handlers are for toggle, add, remove, cancel; no row selection.

## Stubs / TODOs introduced
None of substance. No `TODO`, `Not implemented`, or load-bearing `as any` introduced in the touched files. One pre-existing `(window as any).mc` cast in `ui/src/lib/api.ts:63` (standard bridge access, not new).

## Gaps (minor / test-only)
1. **Stale test file** — `ui/src/contexts/ServerContext.test.tsx` references the removed `useServer`/`activeId`/`switchServer`/`getActiveServer` API. Will fail when test suite runs. Needs to be rewritten against new `useServers()` shape or deleted.
2. **Stale test file** — `desktop/src/main/__tests__/server-proxy.test.ts` calls removed `proxy.setUpstream(...)` (6 sites: lines 52, 64, 75, 102, 119, 126, 128). Will fail; needs rewrite against `localUpstream` constructor or deletion.
3. **Stale comment** — `ui/src/stores/subscriptionStore.ts:40` mentions `mc.getActiveServer()` in a docblock. Cosmetic.
4. **Wave 3 summary doc missing** — `Implementing-Go-Wave-3-summary` returned not-found. Wave 3 work appears implemented (verified in code) but lacks the per-wave summary artifact.

## Files inspected (absolute paths)
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/types/session.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/stores/sessionStore.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/contexts/ServerContext.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/contexts/ServerContext.test.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/lib/api.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/lib/resolveImageSrc.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/lib/milkdownEmbedBridge.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/dialogs/AddProjectDialog.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/dialogs/CreateSessionDialog.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/dialogs/index.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/terminal/TerminalDrawer.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/layout/sidebar-tree/ServersTreeSection.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/layout/SubscriptionsPanel.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/components/layout/SupervisorPanel.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/ui/src/App.tsx
- /Users/benmaderazo/Code/claude-mermaid-collab/desktop/src/main/server-proxy.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/desktop/src/main/__tests__/server-proxy.test.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/desktop/src/main/connection-store.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/desktop/src/main/index.ts
- /Users/benmaderazo/Code/claude-mermaid-collab/desktop/src/preload/index.ts
