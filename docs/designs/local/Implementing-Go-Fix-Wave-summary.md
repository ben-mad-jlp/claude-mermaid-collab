# Fix Wave Summary

Addresses 11 bugs from `Implementing/Go/Review/bugs`.

## Issues Fixed

### Critical
- **bug-critical-validate-against-servers** — `sessionStore.validateAgainstServers` now clears only on `status === 'offline'` (treating `'connecting'` as keep). `ServerContext` validation effect dedupe key includes status fingerprint (`${s.id}:${s.status}`) so it re-runs as probes resolve.
- **bug-critical-tmux-deadlock** — `getServerCapabilities` default flipped to `{ tmux: true }` (optimistic). `SubscriptionsPanel.fetchCapabilities` treats nullish/failure as `true`. `capsCache` is invalidated when servers are removed.

### Important
- **bug-important-prefetch-key** — `usePrefetchWatchedSessions` uses `${serverId}:${project}:${session}` matching `compositeKey`. Prefetch now runs.
- **bug-important-apifetch-headers** — IPC response headers normalized via `new Headers()` (handles arrays / non-string values).
- **bug-important-apifetch-body** — String bodies passed through to bridge unparsed (no `JSON.parse(body)` before IPC).
- **bug-important-caps-cache** — Folded into tmux fix.

### Minor
- **bug-minor-create-session-default** — `AddProjectDialog` defaults fall through to `servers[0]?.id`; both submit handlers (`handleCreateSessionConfirm`, `handleAddProjectSubmit`) guard against empty `serverId`.
- **bug-minor-sidebarview-default** — `views/SidebarView.tsx` drops `'local'` fallback in WS handlers and `setCurrentSession`; requires explicit `message.serverId` or `?srv=` param.
- **bug-minor-formdata-binary** — `apiFetch` browser-fallback URLs built via `window.location.origin` so `/srv/<id>/...` resolves under both `loadURL` and `loadFile`.
- **bug-minor-ws-upgrade-srv** — `server-proxy.handleUpgrade` adds `/srv/<id>/...` WS branch symmetric to HTTP.
- **bug-minor-deeplink-srv** — `dispatchDeepLink` retries every 500ms (up to 30s) when no server is registered yet, instead of sending `{srv: null}`.

### Cosmetic
- **gap-stale-comment-subscriptionStore** — Replaced `mc.getActiveServer()` reference with `currentSession.serverId`.

## Deferred (not fixed in this wave)
- **gap-stale-test-context** — `ui/src/contexts/ServerContext.test.tsx` references removed `useServer`/`activeId`/`switchServer`/`getActiveServer` API.
- **gap-stale-test-proxy** — `desktop/src/main/__tests__/server-proxy.test.ts` calls removed `proxy.setUpstream(...)` in 6 sites.
- **gap-missing-wave3-summary** — Wave 3 summary doc was never created; Wave 3 work itself is committed and verified.

## Final TSC
Clean for all fix-wave files. Only remaining errors are pre-existing iframe `allowtransparency` attrs in `SubscriptionsPanel.tsx` (unrelated).

## Commit
`4fb6642` — fix: review findings — validate, tmux, prefetch, apiFetch, WS /srv, deeplink
