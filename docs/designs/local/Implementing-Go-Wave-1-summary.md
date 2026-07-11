# Wave 1 Implementation

## Tasks
- **session-type-serverid** — Added `serverId: string` (+ comment) to `Session` interface between `project` and `name` in `ui/src/types/session.ts`.
- **connection-capabilities** — `desktop/src/main/connection-store.ts`: added `ServerCapabilities` interface, private `capabilities` Map, `getServerCapabilities`/`setServerCapabilities` methods (merge guarded by `entries.has(id)`), cleanup in `remove()` and `pruneLocalNotIn`. `desktop/src/main/index.ts`: `mc:invokeOnServer` records `tmux` capability from `/api/ide/create-terminal` responses; new `mc:getServerCapabilities` IPC handler. `desktop/src/preload/index.ts`: exposed `getServerCapabilities` on `mc` contextBridge.
- **aggregator-claude-events** — No-op (already implemented). `desktop/src/main/watch-aggregator.ts` already subscribes to `claude_session_registered`, `claude_session_status`, `claude_context_update` and emits tagged with `serverId` via `mc:watch-event`. Renderer consumer is `useWatchEvents.ts`.
- **proxy-srv-routing** — `desktop/src/main/server-proxy.ts`: added `/srv/<id>/<rest>` branch at the top of `handleRequest`. Resolves via `this.resolver`, 404 on miss, forwards via `http.request` (cloned headers minus `host`, Bearer token injected), 502 on proxy error. Legacy `/api/...` fall-through unchanged.

## Verification
All 5 files verified done by verify agents. Per-file tsc clean.

## Wave TSC
Clean for Wave 1 files. (Pre-existing tsc errors in `src/agent/__tests__/*.ts` are unrelated `.ts` import extension issues — predate this work.)

## Notes for later waves
- Real Claude event types: `claude_session_registered`, `claude_session_status`, `claude_context_update` (blueprint had `_started`/`_ended` wrong — adjust Wave 2 consumer tasks).
- `SidebarView.tsx` does not exist — Wave 2 `sidebarview-consume-aggregator` task needs to be re-scoped or skipped.
