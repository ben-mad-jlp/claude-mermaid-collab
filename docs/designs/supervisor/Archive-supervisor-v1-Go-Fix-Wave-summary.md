# Fix Wave Summary

## Issues Fixed
- **bug-important-status-source** — `SupervisorPanel` showed `unknown` for any supervised target not also in the Watching set, because it read status only from the WS-fed `subscriptionStore` and the persisted store (`GET /api/session-status`) was unused (handler.ts replay is gated on a `project` the client never sends). Fixed by polling `GET /api/session-status` per distinct target (serverId, project) every 10s, merging into a `${serverId}:${project}:${session}` map with 120s staleness, and deriving status as `live ?? fetched ?? 'unknown'`. Escalation badge now uses the same merged status. This makes the persistence path authoritative for the panel.
- **cleanup** — Removed the deprecated `allowtransparency` iframe attribute from SupervisorPanel's ClaudePixAvatar (it caused 2 TS2322 errors; transparency already comes from `background:'transparent'`). The file is now tsc-clean.

## Accepted (not fixed)
- Minor: replayed `claude_session_status` omits `claudeSessionId` — moot (panel now uses the fetch path; server replay remains inert scaffold).
- Minor: no `_closeProject` test helper on session-status-store — test-isolation only.

## Deferred (filed as todo)
- **watch-tmux-push** — event-driven fast-path push into supervisor tmux. Deferred pending cross-project supervisor-discovery design + nudge-UX decision. Filed as a session todo linked to the blueprint.

## Files Changed
- ui/src/components/layout/SupervisorPanel.tsx — implement (fetch-based status) + verify clean; control-char check clean; tsc clean.

## Final TSC
clean for supervisor files (no new errors; pre-existing project-wide TS5097 unrelated)
