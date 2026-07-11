# Design: UI launch-and-bind + standardized per-server supervisor

Informed by [[research-ui-launch-and-supervisor-location]]. Automates the manual bootstrap (open Claude in tmux → /collab) from the UI, handling cross-machine servers and a standardized supervisor location.

## Constraints (from user)
1. **Cross-machine** — launch must run on the server that owns the project, in that machine's project dir.
2. **Standardize where the supervisor starts** — canonical dir + session name per server.

## Decisions
- **Cross-machine = per-server routing.** UI calls `mc.invokeOnServer(serverId, {path:'/api/ide/launch-session', ...})` → the launch runs on that host. The row's `project` is already the remote-host path. (Mirrors the existing create-terminal button routing.)
- **Supervisor = one per server (v1)**, started in a standardized `(MERMAID_SUPERVISOR_PROJECT, MERMAID_SUPERVISOR_SESSION)` pair (default project = server's primary/install dir; default session = `supervisor`). Single global supervisor across machines is a **follow-up** (push/nudge/transcript-read are host-local; cross-machine needs per-server hops).
- **Launched dirs must be pre-trusted** (Claude's trust-folder prompt would otherwise swallow the bind keystrokes). The standardized supervisor dir should be trusted; document the constraint for worker dirs.

## Files
- [ ] `src/config.ts` — MODIFY. Add `SUPERVISOR_PROJECT` (env `MERMAID_SUPERVISOR_PROJECT`, default = server root/cwd) and `SUPERVISOR_SESSION` (env `MERMAID_SUPERVISOR_SESSION`, default `'supervisor'`).
- [ ] `src/routes/ide-routes.ts` — MODIFY. Add `POST /api/ide/launch-session`. Also add an optional `cwd`/project to create-terminal? No — new endpoint owns the `-c` launch.
- [ ] `src/services/claude-launch.ts` — NEW (or inline in ide-routes). `launchAndBind({project, session, allowedTools?, invokeSkill?})`: tmux new-session -d -s `tmuxBaseName(project,session)` -c `project`; `sendTmuxKeysRaw(tmux, 'claude' + flags)`; readiness wait; `sendTmuxKeysRaw(tmux, '/collab ' + session)`; optionally `sendTmuxKeysRaw(tmux, invokeSkill)` (e.g. `/supervisor`). Returns `{ started, tmux, bind: 'pending'|'ok' }`.
- [ ] `src/routes/api.ts` or a supervisor route — add `GET /api/supervisor/config` → `{ supervisorProject, supervisorSession }` so the UI knows the standardized location to start the supervisor on a server.
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — MODIFY. Per-row **Start** (play) button → `invokeOnServer(sub.serverId, {path:'/api/ide/launch-session', method:'POST', body:{project:sub.project, session:sub.session}})`.
- [ ] `ui/src/components/layout/SupervisorPanel.tsx` — MODIFY. **Start supervisor** button in the header → fetch the server's `/api/supervisor/config`, then `invokeOnServer(serverId, {path:'/api/ide/launch-session', body:{project:supervisorProject, session:supervisorSession, role:'supervisor', invokeSkill:'/supervisor'}})`.

## launch-session endpoint
`POST /api/ide/launch-session { project, session, role?: 'worker'|'supervisor', allowedTools?: string, invokeSkill?: string }` (runs on the server's host):
1. `tmuxBaseName(project, session)`; `tmux new-session -d -s <name> -c <project>` (if exists, reuse). 400 if project/session missing.
2. Launch: `sendTmuxKeysRaw(tmux, 'claude' + (allowedTools ? ' --allowedTools "'+allowedTools+'"' : ''))`.
3. **Readiness:** poll for any new `claude` child under the tmux pane + its `/tmp/.claude-session-id-<pid>` file (up to ~15s), else fixed-delay fallback (~10s).
4. Bind: `sendTmuxKeysRaw(tmux, '/collab ' + session)`.
5. If `invokeSkill` (e.g. `/supervisor`): after another short delay, `sendTmuxKeysRaw(tmux, invokeSkill)`.
6. Return `{ started: true, tmux, bind: 'pending' }`. Best-effort; tmux/trust failures degrade gracefully (`{started:false, reason}`).

## Supervisor config (standardization)
`src/config.ts`:
- `SUPERVISOR_PROJECT = process.env.MERMAID_SUPERVISOR_PROJECT ?? <server root dir>` (the dir the server treats as its primary project / install root; must be trusted).
- `SUPERVISOR_SESSION = process.env.MERMAID_SUPERVISOR_SESSION ?? 'supervisor'`.
- `GET /api/supervisor/config` returns these so each server advertises its canonical supervisor location to the UI.

## Cross-machine supervision (FOLLOW-UP, documented)
A supervisor on machine A cannot today drive workers on machine B: the `session-notify` push, the nudge (`tmux-send-keys`), and `read_last_assistant_turn` are all host-local. Cross-machine would require routing each through the owning server (server-to-server, or the desktop relaying). Out of scope for v1; v1 = per-server supervisor doing local supervision.

## Tasks
- W1: config (SUPERVISOR_PROJECT/SESSION) ; claude-launch helper + launch-session route ; supervisor-config route.
- W2: UI Start button (SubscriptionsPanel) ; UI Start-supervisor button (SupervisorPanel).
- W3: smoke verify (launch a worker via the endpoint on the local server; confirm it boots + binds; launch supervisor).

## Risks
1. Trust-folder prompt blocks bind → require pre-trusted dirs; surface a clear result if bind doesn't land (status stays unbound).
2. Readiness timing → pidfile poll + fallback; bind is best-effort/idempotent (re-runnable).
3. Cross-machine supervision silently no-ops → documented; v1 is per-server.
