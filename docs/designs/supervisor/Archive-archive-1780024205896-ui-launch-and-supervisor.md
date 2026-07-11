# Blueprint: UI launch-and-bind + standardized per-server supervisor

## Source
[[design-ui-launch-and-supervisor]] · [[research-ui-launch-and-supervisor-location]]

## Premise
A server-side `launch-session` endpoint (runs on the owning machine, in its project dir) that creates a tmux session, launches `claude`, waits for readiness, and binds via `/collab`. UI Start buttons call it per-server via `invokeOnServer`. A standardized per-server supervisor location via config + `/api/supervisor/config`. Reuse `sendTmuxKeysRaw` (Enter-fixed) + `tmuxBaseName`. Cross-machine supervision deferred.

---

## 1. Structure Summary

### Files
- [ ] `src/config.ts` — MODIFY. Export `SUPERVISOR_PROJECT` (env `MERMAID_SUPERVISOR_PROJECT` ?? a sensible server-root default) and `SUPERVISOR_SESSION` (env `MERMAID_SUPERVISOR_SESSION` ?? `'supervisor'`).
- [ ] `src/services/claude-launch.ts` — NEW. `launchAndBind(opts)` orchestration (tmux -c cwd, launch claude, readiness poll, /collab, optional skill invoke).
- [ ] `src/routes/ide-routes.ts` — MODIFY. `POST /api/ide/launch-session` → delegate to `launchAndBind`.
- [ ] `src/routes/supervisor-routes.ts` — MODIFY. `GET /api/supervisor/config` → `{ supervisorProject, supervisorSession }`.
- [ ] `ui/src/components/layout/SubscriptionsPanel.tsx` — MODIFY. Per-row **Start** button → `invokeOnServer(sub.serverId, launch-session{project:sub.project, session:sub.session})`.
- [ ] `ui/src/components/layout/SupervisorPanel.tsx` — MODIFY. Header **Start supervisor** button → GET that server's `/api/supervisor/config`, then `invokeOnServer(serverId, launch-session{project:supervisorProject, session:supervisorSession, role:'supervisor', invokeSkill:'/supervisor'})`.

### Types
```ts
interface LaunchOpts { project:string; session:string; allowedTools?:string; invokeSkill?:string; }
interface LaunchResult { started:boolean; tmux?:string; bind?:'pending'|'ok'; reason?:string; }
```

### Interactions
```
UI Start (row) --invokeOnServer(serverId)--> server[host] POST /api/ide/launch-session
   → launchAndBind: tmux new-session -c <project> → claude [--allowedTools] → wait ready → /collab <session> [→ /supervisor]
UI Start-supervisor --GET /api/supervisor/config--> {supervisorProject, supervisorSession}
   --invokeOnServer--> launch-session(role:supervisor, invokeSkill:'/supervisor')
```

---

## 2. Function Blueprints

### `config.ts` (MODIFY)
- `export const SUPERVISOR_SESSION = process.env.MERMAID_SUPERVISOR_SESSION ?? 'supervisor';`
- `export const SUPERVISOR_PROJECT = process.env.MERMAID_SUPERVISOR_PROJECT ?? <default>;` — default to the server's primary project dir. READ config.ts to find an existing "root"/cwd notion (e.g. process.cwd() or an install-path const); use that. Document it must be a TRUSTED dir.

### `claude-launch.ts` (NEW)
`export async function launchAndBind(opts: LaunchOpts): Promise<LaunchResult>`:
1. `const tmux = tmuxBaseName(opts.project, opts.session);`
2. Ensure session: `tmux has-session -t tmux || tmux new-session -d -s tmux -c <project>` (Bun.spawn; if tmux missing → `{started:false, reason:'no-tmux'}`). Verify `opts.project` exists as a dir; if not → `{started:false, reason:'no-project-dir'}`.
3. Launch claude: `const flags = opts.allowedTools ? ' --allowedTools "'+opts.allowedTools+'"' : ''; await sendTmuxKeysRaw(tmux, 'claude' + flags);`
4. Readiness: poll up to ~15s — list the tmux pane's child pids (`tmux list-panes -t tmux -F '#{pane_pid}'` then walk children for a `claude` proc) and check `/tmp/.claude-session-id-<pid>` exists; on found, proceed; else after 10s fallback proceed anyway.
5. Bind: `await sendTmuxKeysRaw(tmux, '/collab ' + opts.session);`
6. If `opts.invokeSkill`: `await sleep(~12s); await sendTmuxKeysRaw(tmux, opts.invokeSkill);` (e.g. `/supervisor`).
7. Return `{ started:true, tmux, bind:'pending' }`.
- All best-effort; wrap in try/catch → `{started:false, reason}`.
- **Edge:** trust prompt on an untrusted dir will swallow `/collab` — can't detect headlessly; document that the dir must be pre-trusted. (Bind stays 'pending'/unbound; the supervisor reconcile / binding-file absence reflects it.)

### `ide-routes.ts` launch-session (MODIFY)
```
if (url.pathname === '/api/ide/launch-session' && req.method === 'POST') {
  try {
    const { project, session, allowedTools, invokeSkill, role } = await req.json();
    if (!project || !session) return jsonError('project and session required', 400);
    const result = await launchAndBind({ project, session, allowedTools, invokeSkill });
    return Response.json(result);
  } catch (err) { return jsonError(..., 500); }
}
```
(role is informational; allowedTools optional — UI may pass a default worker allow-list.)

### `supervisor-routes.ts` config (MODIFY)
```
if (url.pathname === '/api/supervisor/config' && req.method === 'GET') {
  return Response.json({ supervisorProject: SUPERVISOR_PROJECT, supervisorSession: SUPERVISOR_SESSION });
}
```
(import SUPERVISOR_PROJECT/SESSION from config.)

### UI SubscriptionsPanel Start button (MODIFY)
Add a play/▶ button in the row action area (near the supervise/tmux buttons). onClick (stopPropagation): `const mc=(window as any).mc; const body={project:sub.project, session:sub.session}; if(mc?.invokeOnServer) await mc.invokeOnServer(sub.serverId,{path:'/api/ide/launch-session',method:'POST',body}); else await fetch('/api/ide/launch-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});` Show a brief launching state. (Optionally pass a default allowedTools for workers.)

### UI SupervisorPanel Start-supervisor button (MODIFY)
Header button "Start supervisor". onClick: resolve serverId (activeId/serverScope). `const cfg = await invoke(serverId, '/api/supervisor/config','GET'); const {supervisorProject, supervisorSession} = cfg.body; await invoke(serverId,'/api/ide/launch-session','POST',{project:supervisorProject, session:supervisorSession, role:'supervisor', invokeSkill:'/supervisor'});` (reuse the store's invoke helper.)

---

## 3. Task Dependency Graph

### YAML
```yaml
tasks:
  - id: config-supervisor-loc
    files: [src/config.ts]
    tests: []
    description: "Add SUPERVISOR_PROJECT / SUPERVISOR_SESSION config (env + defaults)"
    parallel: true
    depends-on: []
  - id: claude-launch
    files: [src/services/claude-launch.ts]
    tests: [src/services/claude-launch.test.ts]
    description: "launchAndBind: tmux -c cwd, launch claude, readiness poll, /collab, optional skill invoke"
    parallel: true
    depends-on: []
  - id: launch-route
    files: [src/routes/ide-routes.ts]
    tests: []
    description: "POST /api/ide/launch-session -> launchAndBind"
    parallel: false
    depends-on: [claude-launch]
  - id: supervisor-config-route
    files: [src/routes/supervisor-routes.ts]
    tests: []
    description: "GET /api/supervisor/config -> {supervisorProject, supervisorSession}"
    parallel: false
    depends-on: [config-supervisor-loc]
  - id: ui-start-button
    files: [ui/src/components/layout/SubscriptionsPanel.tsx]
    tests: []
    description: "Per-row Start button -> invokeOnServer launch-session (per-machine)"
    parallel: false
    depends-on: [launch-route]
  - id: ui-start-supervisor
    files: [ui/src/components/layout/SupervisorPanel.tsx]
    tests: []
    description: "Start-supervisor header button -> GET supervisor/config then invokeOnServer launch-session(role supervisor, /supervisor)"
    parallel: false
    depends-on: [launch-route, supervisor-config-route]
  - id: smoke-verify
    files: []
    tests: []
    description: "Launch a worker via the endpoint on local server; confirm boot+bind; launch supervisor in standardized dir"
    parallel: false
    depends-on: [ui-start-button, ui-start-supervisor]
```

### Waves
- **W1 (parallel):** config-supervisor-loc, claude-launch
- **W2:** launch-route, supervisor-config-route
- **W3:** ui-start-button, ui-start-supervisor
- **W4:** smoke-verify

### Summary
- Total tasks: 7 · Waves: 4 · Max parallelism: 2
