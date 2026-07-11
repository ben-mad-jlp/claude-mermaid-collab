# Wave 4+5 Implementation (combined for tsc continuity)

## Tasks
- **server-context-cleanup** — `ServerContext.tsx`: removed `activeId`/`switchServer`/`getActiveServer`; renamed `useServer` → `useServers`; exposes `{ available, servers, refresh, addServer, removeServer }`. Updated readers (`App.tsx`, `SupervisorPanel`, `SubscriptionsPanel`, `ServersTreeSection`, `TerminalDrawer`, `SidebarView`): each derives any needed `activeId`-shaped local var from `currentSession?.serverId` via the session store. SidebarView drops the context entirely (uses `?srv=` or `'local'` fallback).
- **proxy-setupstream-remove** — `server-proxy.ts`: immutable `localUpstream` constructor param; removed mutable `upstream` field and `setUpstream()`. Legacy `/api/...` and WS handlers forward to `localUpstream` unconditionally; no more 503/socket-destroy "no upstream" paths. `desktop/src/main/index.ts`: proxy constructed with `localUpstream`; removed `mc:switchServer` + `mc:getActiveServer` IPCs; `dispatchDeepLink` falls back to local-server-id only. `connection-store.ts`: removed `activeId`/`setActive`/`getActive`; `init`/`persist` no longer touch `activeId`. `preload/index.ts`: dropped `getActiveServer` and `switchServer` bridge methods.
- **delete-switcher-ui** — `ServersTreeSection.tsx`: removed click-to-switch handler, active-row highlight, and font-semibold active styling. The Servers section is now a non-interactive status display (status dot + icon + label + host:port + remove button on manual servers).

## Wave TSC
Clean across UI and desktop packages. No `useServer`, `activeId`, `switchServer`, `getActiveServer`, or `setUpstream` references remain.

## Status
**All 20 tasks of the kill-active-server blueprint complete.** Active server is dead. Server identity is now derived from `currentSession.serverId` everywhere it matters.

## Next
- Smoke-test the desktop app in the running instance (server list, session selection, terminal creation, IDE diff).
- Commit Wave 4+5 changes.
- Run /vibe-review for bug/completeness sweep.
