# Wave 1 (supervisor-federation) — testable core

## Tasks (all tsc-clean, additive/backward-compatible)
- **config-and-supervisor-config-routes** — `src/config.ts`: `SUPERVISOR_PROJECT` (env MERMAID_SUPERVISOR_PROJECT ?? MERMAID_PROJECT) + `SUPERVISOR_SESSION` (env ?? 'supervisor'). `src/routes/supervisor-routes.ts`: `GET /api/supervisor/config` + `GET /api/supervisor/identity`.
- **claude-launch** — NEW `src/services/claude-launch.ts`. `launchAndBind({project,session,allowedTools?,invokeSkill?})`: tmux new-session -c <project> → `claude [--allowedTools]` → fixed ~10s readiness → `/collab <session>` → optional skill. Best-effort; reasons no-project-dir/no-tmux. (Dir must be pre-trusted.)
- **transcript-route** — `src/routes/api.ts`: `GET /api/transcript/last-turn?claudeSessionId=` (peer-callable, wraps lastAssistantTurn).
- **serverid-state** — `src/services/supervisor-store.ts`: serverId column on supervised_session/escalation/attended_lock/supervisor_identity (DDL + idempotent ADD COLUMN migration); serverId optional trailing params (backward-compatible — no signature breaks); peer-registry cache (PeerInfo/setPeerRegistry/getPeer/listPeers).

## Verification
- Per-file + combined tsc clean (no new errors; only pre-existing TS5097 + the pre-existing pair_mode_changed).
- All changes additive/inert until wired by later waves (no behavior change yet).

## Note
launch-route (W2) + UI Start buttons (W3) make launchAndBind smoke-testable on the LOCAL server. Cross-machine (desktop-federation, W4) needs the desktop + the (assumed-working) proxy.
