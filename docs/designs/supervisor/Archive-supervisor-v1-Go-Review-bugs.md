# Bug Review — Supervisor Feature

Scope: new supervisor files + supervisor-related edits only. Pre-existing unrelated working-tree changes ignored.

## Important

### 1. Persisted-status WS replay is dead code — fresh subscribers never get current status
- **File:** `src/websocket/handler.ts:144` (also `ui/src/lib/websocket.ts:303-308`)
- **What's wrong:** The replay branch guards on `data.channel === 'updates' && data.project`. The client `subscribe(channel)` helper only ever sends `{ type: 'subscribe', channel }` — it never includes `project` (confirmed at `ui/src/lib/websocket.ts:303` and the only call site `ui/src/App.tsx:496`). So `data.project` is always `undefined` and the `for (const row of getStatuses(...))` loop never runs.
- **Why it matters:** This replay is the whole mechanism by which a freshly-connected supervisor/UI sees the last-known status of sessions it didn't witness change live. `SupervisorPanel.statusForKey` reads `subscriptions[key]?.status ?? 'unknown'`, and `subscriptionStore.updateStatus` early-returns when there is no existing subscription. Net effect: targets that aren't actively producing live status events render `unknown` after a reconnect/reopen even though `session_status.db` holds their real status. The persisted store + GET `/api/session-status` route are written but unused by the live UI path.
- **Fix:** Make the client send the project on subscribe, e.g. extend `subscribe(channel, project?)` to include `project` in the payload, and call `client.subscribe('updates', currentSession.project)` in `App.tsx`. (Server side already handles it correctly.) Alternatively drive the panel from a one-shot `GET /api/session-status` fetch on mount.

## Minor

### 2. Replay message omits `claudeSessionId` that the UI handler reads
- **File:** `src/websocket/handler.ts:145-152` vs `ui/src/views/SidebarView.tsx` `claude_session_status` handler.
- **What's wrong:** The replayed `claude_session_status` payload has no `claudeSessionId`; the SidebarView handler destructures it and passes `undefined` into `updateStatus`. Harmless today because `updateStatus` only overwrites `claudeSessionId` on an existing entry and the replay never fires (bug #1), but if #1 is fixed this would null-out a previously-known `claudeSessionId`. Include `claudeSessionId` in the replayed row (requires storing it, or omit and have updateStatus preserve the prior value).

### 3. session-status-store has no `_closeProject` test escape hatch
- **File:** `src/services/session-status-store.ts:30`
- supervisor-store exposes `_closeProject` to drop cached handles for tests; session-status-store caches connections identically but offers no way to close them. Not a runtime bug; only affects test isolation / handle cleanup. Add a symmetric `_closeProject` if tests need fresh DBs.

## Verified OK (no bug)
- SQLite UPSERT (`ON CONFLICT(project,session) DO UPDATE`) and `INSERT OR IGNORE` with matching UNIQUE constraint are correct.
- Per-project DB connection cache: keyed by project path, created lazily, no staleness issue for the single-process server.
- tmux-send-keys graceful degrade: `has-session` exit≠0 → 404 (correct, returned before the catch); ENOENT/spawn failure → caught → `{success:true, tmux:false}`. The 404 Response is returned from inside the try but is not an exception, so it is not swallowed by the catch. Correct.
- supervisorStore `invoke()`: DELETE carries the 4-field body in the fetch fallback (needed to rebuild identity); optimistic updates are gated on `res?.ok` (no state change on failure) — correct, not truly optimistic.
- compositeKey `${serverId}:${targetProject}:${targetSession}` — supervisor scope stored redundantly on each row so removeTarget rebuilds the full DELETE body from the key alone. No collision within a server.
- SupervisorPanel: status read by `${t.serverId}:${targetProject}:${targetSession}`; candidateSessions filters out cross-server sessions, own session, and already-targeted ones, so target.serverId always == activeId and the status key matches the subscription key. Null guards on activeId/currentProject/currentSession via `canAdd` and non-null assertions only inside the `if (!canAdd) return` guard.
- Status validated against ALLOWED_STATUS before `recordStatus`; recordStatus wrapped in try/catch so a DB error won't break session-notify.
- SKILL.md route references (`GET /api/session-status`, `/api/supervisor/targets`, tmux-send-keys) match the implemented routes.
