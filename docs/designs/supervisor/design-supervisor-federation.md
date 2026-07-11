# Design: Global supervisor via the desktop router (Option B, proxy-reuse)

SUPERSEDES the mDNS/shared-secret plan. Decision: **reuse the existing desktop cross-machine router** (`/_per-server/<serverId>/` WS proxy + `invokeOnServer` REST, both in the desktop main process) instead of building server-to-server federation. Assume the proxy works; fix it if not. Desktop-alive is required (accepted). No mDNS, no shared secret — reuse the desktop's existing per-server `{host,port,token}`.

## Why this shape
The desktop already is the cross-machine router: it holds every server's `{host,port,token}` (connection-store) and proxies REST (`invokeOnServer`) + WS (`/_per-server/<serverId>/`, see `ui/src/lib/terminal-ws.ts`) to the right machine. The cross-server **terminal** feature already rides this. So: the UI half of the supervisor is nearly free, and only the autonomous Claude loop needs a small bridge to reach peers — supplied by the desktop.

## Components
### A. UI launch-and-bind (cross-machine, via proxy)
- Server endpoint `POST /api/ide/launch-session { project, session, role?, allowedTools?, invokeSkill? }` (runs on the OWNING server's host): `tmux new-session -d -s <tmuxBaseName> -c <project>` → `sendTmuxKeysRaw('claude'+flags)` → readiness (poll `/tmp/.claude-session-id-<pid>` + delay) → `/collab <session>` → optional `invokeSkill` (e.g. `/supervisor`). Best-effort, returns `{started, tmux, bind}`.
- UI: per-row **Start** button (SubscriptionsPanel) → `invokeOnServer(sub.serverId, launch-session)`. **Start supervisor** button (SupervisorPanel) → GET that server's `/api/supervisor/config` then `invokeOnServer(serverId, launch-session{ project:supervisorProject, session:supervisorSession, role:'supervisor', invokeSkill:'/supervisor' })`.
- Viewing a remote worker's tmux already works (the existing terminal proxy).

### B. Standardized supervisor location
- `src/config.ts`: `SUPERVISOR_PROJECT` (env `MERMAID_SUPERVISOR_PROJECT` ?? server root) + `SUPERVISOR_SESSION` (env ?? 'supervisor'). `GET /api/supervisor/config` advertises them. The supervisor is the singleton identity already in supervisor-store.

### C. Cross-machine PUSH (desktop-driven)
- In desktop main `WatchAggregator.forward` (already receives every server's `claude_session_status`, tagged with serverId): on a supervised `(serverId,project,session)` transition to `waiting`/`permission`, `invokeOnServer(homeServerId, '/api/ide/tmux-send-keys', { project:supProject, session:supSession, text:'[mc-supervisor] <server>/<project>/<session> → <status>' })`.
- Desktop learns supervised-set + home identity by polling the home server (`GET /api/supervisor/supervised`, `/api/supervisor/identity`). Remove/disable the per-server session-notify local push (replaced by this cross-machine one).

### D. Autonomous outbound ops (reconcile / nudge / read across machines)
- The desktop pushes its **live peer registry** `[{serverId, baseUrl, token}]` over its existing WS connection to the supervisor's HOME server (new WS msg `peer_registry`). Home server caches it.
- Supervisor MCP tools gain an optional `serverId`. For a remote target, the home server calls the peer directly using the cached registry:
  - `read_last_assistant_turn` → peer `GET /api/transcript/last-turn?claudeSessionId=` (new peer-callable route; today MCP-only).
  - `nudge` → peer `POST /api/ide/tmux-send-keys`.
  - `supervisor_reconcile` → aggregate local statuses + per-peer `GET /api/session-status` + todo counts.
- Local target = no hop (current behavior).

### E. serverId-aware state
- `supervised_session` / `escalation` / `attended_lock` add a `serverId` column. `register_supervisor` records the home serverId too. Stable serverId from instance-discovery / the desktop's connection id.

## Tasks (waves)
- W1: config (SUPERVISOR_PROJECT/SESSION) + `/api/supervisor/config` + `/api/supervisor/identity` ; `claude-launch` helper + `launch-session` route ; peer-callable `/api/transcript/last-turn` route.
- W2: serverId-aware supervisor state (migration) + `register_supervisor` records home serverId ; home-server peer-registry cache (WS `peer_registry` receiver) ; supervisor MCP tools serverId-aware routing (reconcile/nudge/read).
- W3 (desktop): desktop pushes `peer_registry` to home server ; desktop cross-machine push in WatchAggregator (replaces per-server session-notify push).
- W4: UI Start + Start-supervisor buttons ; skill update (serverId targets) ; smoke verify.

## Risks
1. **Proxy correctness unverified** — assumed working per user; if broken, harden it (WS proxy through Electron main is the fiddly bit). Gate real cross-machine use on a manual "remote terminal streams" check.
2. **Readiness/trust** — launched dirs must be pre-trusted or `/collab` keystrokes are swallowed; bind is best-effort.
3. **Desktop-alive** — push + peer-registry require the desktop running (accepted).
4. **serverId identity** — must be stable + consistent between desktop connection-store and the home server's records.
