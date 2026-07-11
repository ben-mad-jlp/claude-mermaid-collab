# Wave 2 (supervisor-federation)

## Tasks
- **launch-route** — `src/routes/ide-routes.ts`: `POST /api/ide/launch-session {project,session,role?,allowedTools?,invokeSkill?}` → `launchAndBind(...)`. tsc clean.
- **peer-registry-ws** — `src/websocket/handler.ts`: WSMessage `peer_registry` member + handleMessage branch → `setPeerRegistry(data.peers)`. tsc clean.

## SMOKE TEST (shipped endpoint, local server) — PASSED
- `POST /api/ide/launch-session {project: repo, session: 'launch-smoke', allowedTools: '...'}` → `{started:true, tmux:'mc-claudemermaidcollab-launchsmoke', bind:'pending'}`.
- A real worker Claude (pid 26690) launched in the repo dir and **bound** to `launch-smoke` (binding file created; status `active`) — proving launchAndBind does tmux→claude→/collab→register via the endpoint, no manual steps.
- `GET /api/supervisor/config` returns `{supervisorProject: <repo>, supervisorSession: 'supervisor'}` (W1 verified).
- Cleaned up the smoke worker.

## Result
The launch-and-bind core is VERIFIED working end-to-end via the shipped endpoint. The W3 UI "Start" button is just a call to this. Remaining: W3 (tools serverId routing + UI Start buttons), W4 (desktop federation: WatchAggregator push + peer_registry; skill; cross-machine smoke).
