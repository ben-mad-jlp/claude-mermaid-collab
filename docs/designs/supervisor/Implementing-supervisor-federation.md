# Blueprint: Global supervisor via desktop router (proxy-reuse)

## Source
[[design-supervisor-federation]] (Option B, proxy-reuse) · [[research-supervisor-discovery-federation]] · [[research-ui-launch-and-supervisor-location]]

## Premise
Reuse the desktop cross-machine router (`invokeOnServer` + `/_per-server/` proxy + connection-store tokens). No mDNS, no shared secret. Desktop-alive required. Build order: testable launch-and-bind core first, then cross-machine federation. Reuse `sendTmuxKeysRaw` (Enter-fixed), `tmuxBaseName`, supervisor-store, WatchAggregator pattern.

---

## 1. Structure Summary

### Files
- [ ] `src/config.ts` — MODIFY. `SUPERVISOR_PROJECT` (env `MERMAID_SUPERVISOR_PROJECT` ?? server root dir) + `SUPERVISOR_SESSION` (env ?? 'supervisor').
- [ ] `src/services/claude-launch.ts` — NEW. `launchAndBind({project,session,allowedTools?,invokeSkill?})`.
- [ ] `src/routes/ide-routes.ts` — MODIFY. `POST /api/ide/launch-session` → launchAndBind.
- [ ] `src/routes/api.ts` — MODIFY. `GET /api/transcript/last-turn?claudeSessionId=` (peer-callable, wraps transcript-reader.lastAssistantTurn).
- [ ] `src/routes/supervisor-routes.ts` — MODIFY. `GET /api/supervisor/config` ({supervisorProject,supervisorSession}); `GET /api/supervisor/identity` ({project,session}|null); peer-registry receiver is WS (handler) not REST.
- [ ] `src/services/supervisor-store.ts` — MODIFY. add `serverId` column to supervised_session/escalation/attended_lock (migration); `register_supervisor`/identity records home serverId; peer-registry cache (in-memory) get/set.
- [ ] `src/websocket/handler.ts` — MODIFY. accept a `peer_registry` WS message (from the desktop) → store in supervisor-store peer-registry cache.
- [ ] `src/mcp/setup.ts` — MODIFY. supervisor MCP tools (reconcile/nudge-equivalent/read_last_assistant_turn) gain optional `serverId`; route to peer via cached registry (peer REST) when remote, local otherwise; register_supervisor takes serverId.
- [ ] `desktop/src/main/watch-aggregator.ts` (+ index.ts) — MODIFY. (a) push `peer_registry` to the home server over its WS; (b) on supervised-worker transition (any server), `invokeOnServer(homeServerId, tmux-send-keys)` push. Needs supervised-set + home identity (poll home server).
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — MODIFY. per-row **Start** button → `invokeOnServer(serverId, launch-session)`.
- [ ] `ui/src/components/layout/SupervisorPanel.tsx` — MODIFY. **Start supervisor** button → GET supervisor/config then `invokeOnServer(serverId, launch-session{role:supervisor, invokeSkill:'/supervisor'})`.

---

## 2. Function Blueprints (key)

### claude-launch.ts `launchAndBind(opts)`
1. `tmux = tmuxBaseName(project,session)`; `tmux has-session || tmux new-session -d -s tmux -c <project>` (verify project dir exists; no-tmux/no-dir → `{started:false,reason}`).
2. `sendTmuxKeysRaw(tmux, 'claude' + (allowedTools?' --allowedTools "'+allowedTools+'"':''))`.
3. Readiness: poll ~15s for a claude child under the pane + `/tmp/.claude-session-id-<pid>`; fallback ~10s.
4. `sendTmuxKeysRaw(tmux, '/collab '+session)`.
5. if invokeSkill: sleep ~12s; `sendTmuxKeysRaw(tmux, invokeSkill)`.
6. return `{started:true,tmux,bind:'pending'}`. try/catch → `{started:false,reason}`. Doc: dir must be pre-trusted.

### /api/transcript/last-turn
`const id = url.searchParams.get('claudeSessionId'); if(!id) 400; return Response.json(await lastAssistantTurn(id));` (import transcript-reader).

### supervisor-store serverId
Migration: `ALTER TABLE ... ADD COLUMN serverId TEXT` for supervised_session/escalation/attended_lock (default '' / local). Update fns to take+store serverId; isSupervised(serverId,project,session). Peer-registry: `let _peers: Array<{serverId,baseUrl,token}> = []; setPeerRegistry(p); getPeer(serverId); listPeers();`.

### setup.ts tool routing
Helper `peerFetch(serverId, path, method, body)`: if serverId == local/undefined → call local fn; else look up peer baseUrl+token from supervisor-store registry, `fetch(baseUrl+path, {headers:{Authorization:'Bearer '+token}, ...})`. reconcile aggregates local + each watched peer; nudge/read route via peerFetch.

### desktop watch-aggregator
- On connect / server-list change: send each home server `{type:'peer_registry', peers:[{serverId,baseUrl,token}]}` over its WS (the aggregator already holds connections + the connection-store has host/port/token).
- In `forward(e)` for `claude_session_status`: if supervised (cache from home server) and transition→waiting/permission, `invokeOnServer(homeServerId, '/api/ide/tmux-send-keys', {project:supProj,session:supSess,text:'[mc-supervisor] ...'})`.

---

## 3. Task Dependency Graph

```yaml
tasks:
  - id: config-and-supervisor-config-routes
    files: [src/config.ts, src/routes/supervisor-routes.ts]
    tests: []
    description: "SUPERVISOR_PROJECT/SESSION config + GET /api/supervisor/config + /api/supervisor/identity"
    parallel: true
    depends-on: []
  - id: claude-launch
    files: [src/services/claude-launch.ts]
    tests: [src/services/claude-launch.test.ts]
    description: "launchAndBind: tmux -c cwd, launch claude, readiness, /collab, optional skill"
    parallel: true
    depends-on: []
  - id: transcript-route
    files: [src/routes/api.ts]
    tests: []
    description: "GET /api/transcript/last-turn (peer-callable, wraps lastAssistantTurn)"
    parallel: true
    depends-on: []
  - id: launch-route
    files: [src/routes/ide-routes.ts]
    tests: []
    description: "POST /api/ide/launch-session -> launchAndBind"
    parallel: false
    depends-on: [claude-launch]
  - id: serverid-state
    files: [src/services/supervisor-store.ts]
    tests: [src/services/supervisor-store.test.ts]
    description: "serverId column on supervised/escalation/lock (migration); peer-registry cache; register_supervisor records home serverId"
    parallel: true
    depends-on: []
  - id: peer-registry-ws
    files: [src/websocket/handler.ts]
    tests: []
    description: "Accept peer_registry WS message from desktop -> supervisor-store.setPeerRegistry"
    parallel: false
    depends-on: [serverid-state]
  - id: tools-serverid-routing
    files: [src/mcp/setup.ts]
    tests: []
    description: "supervisor tools gain serverId; peerFetch routes reconcile/nudge/read to peers via registry; register_supervisor takes serverId"
    parallel: false
    depends-on: [serverid-state, transcript-route]
  - id: desktop-federation
    files: [desktop/src/main/watch-aggregator.ts, desktop/src/main/index.ts]
    tests: []
    description: "Desktop pushes peer_registry to home server; cross-machine push in WatchAggregator (replaces per-server session-notify push)"
    parallel: false
    depends-on: [peer-registry-ws, tools-serverid-routing]
  - id: ui-start-buttons
    files: [ui/src/components/layout/SubscriptionsPanel.tsx, ui/src/components/layout/SupervisorPanel.tsx]
    tests: []
    description: "Per-row Start button + Start-supervisor button -> invokeOnServer launch-session"
    parallel: false
    depends-on: [launch-route, config-and-supervisor-config-routes]
  - id: skill-and-smoke
    files: [skills/supervisor/SKILL.md]
    tests: []
    description: "Skill: serverId-aware ops; register_supervisor with serverId. Smoke verify local launch-and-bind + (if desktop) cross-machine."
    parallel: false
    depends-on: [tools-serverid-routing, ui-start-buttons, desktop-federation]
```

### Waves
- **W1 (testable core):** config-and-supervisor-config-routes, claude-launch, transcript-route, serverid-state
- **W2:** launch-route, peer-registry-ws
- **W3:** tools-serverid-routing, ui-start-buttons
- **W4:** desktop-federation, skill-and-smoke

### Summary
- Total tasks: 10 · Waves: 4 · Max parallelism: 4
- Note: launch-route + ui-start-buttons are smoke-testable on the LOCAL server immediately (proxy-independent same-machine); cross-machine (desktop-federation) needs the desktop + verified proxy.
