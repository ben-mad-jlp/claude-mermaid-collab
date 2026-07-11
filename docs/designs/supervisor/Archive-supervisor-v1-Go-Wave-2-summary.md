# Wave 2 Implementation

## Tasks
- **api-status-wire** — `src/routes/api.ts`. Import recordStatus/getStatuses (extensionless). In `/api/session-notify`, persist status via `recordStatus(...)` in a try/catch before the broadcast (failure logs only). New `GET /api/session-status?project=` → `{ statuses: getStatuses(project) }`, 400 if no project.
- **ws-status-replay** — `src/websocket/handler.ts`. Import getStatuses. Widened subscribe WSMessage variant with `project?: string`. After the ide_status replay, replays `claude_session_status` rows when `data.channel==='updates' && data.project`. **Minimal-safe: inert until a client passes `project` on subscribe** (documented inline) — no behavior change for current callers.
- **supervisor-api** — NEW `src/routes/supervisor-routes.ts` (`handleSupervisorRoutes(req,url)`, GET/POST/DELETE `/api/supervisor/targets`) + mounted in `src/server.ts` after the `/api/ide` block.
- **ui-supervisor-panel** — NEW `ui/src/components/layout/SupervisorPanel.tsx`. Collapsible "Supervisor" section mirroring SubscriptionsPanel; reads assigned targets from supervisorStore, live status from subscriptionStore by composite key, pulsing escalation badge on `permission`, add-target picker, remove button.

## Verification
- All tasks STATUS done. Semantic review passed.
- tsc: no new errors. Only pre-existing TS5097 (`.ts` import extensions) and the replicated `allowtransparency` TS2322 (also present in SubscriptionsPanel).

## Known v1 limitations (carried forward)
- Status replay is inert until the WS client passes `project` on subscribe (companion UI task, out of scope).
- Supervisor targets not also in the Watching set render `unknown` live status (TODO in panel; supervisor skill handles via /api/session-status poll).

## Wave TSC
clean (no new errors)
