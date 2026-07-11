# Blueprint: One Collab Server Per Machine (plugin + app share)

## Source Artifacts
- `design-unified-collab-server` (attach-or-start on :9002; idle self-shutdown; runtime CDP-target registration; plugin redistributes current code)

## 1. Structure Summary

### Files
- [ ] `src/services/cdp-session.ts` — runtime electron-view target override: `setElectronTarget(cdpPort)` / `clearElectronTarget()` + state read by `selectElectronViewTarget`/`ensureTab` so electron-view mode works without the startup env.
- [ ] `src/routes/browser-routes.ts` — `POST /api/browser/electron-target {cdpPort}` → setElectronTarget; `DELETE` → clearElectronTarget. Loopback.
- [ ] `src/websocket/handler.ts` — expose consumer count + an `onConnectionsChanged` callback (fired on add/remove).
- [ ] `src/server.ts` — idle-shutdown timer: on zero WS connections, arm `MERMAID_IDLE_SHUTDOWN_MS` timer → `removeInstance` + clean exit; cancel on new connection.
- [ ] `src/config.ts` — `MERMAID_IDLE_SHUTDOWN_MS` (default 600000; `0` disables).
- [ ] `desktop/src/main/server-supervisor.ts` — `start()`: target canonical port (`MERMAID_PORT` ?? 9002); health-check → attach if up; else spawn on that port. No ephemeral getFreePort for the server port.
- [ ] `desktop/src/main/index.ts` — after `supervisor.start()`, `POST http://127.0.0.1:<port>/api/browser/electron-target {cdpPort}` (register the embedded view). Remove the shared-server stop from `before-quit` (server self-reaps).

### Types / signatures
- `cdp-session`: `export function setElectronTarget(cdpPort: number): void; export function clearElectronTarget(): void;` internal `let runtimeElectronTarget: { cdpPort: number } | null`.
- `handler`: `getConnectionCount(): number; setOnConnectionsChanged(cb: (n: number) => void): void;`
- supervisor opts already have `cdpPort`, `host`; add nothing required (use config canonical port).

### Component Interactions
```
plugin server-check.sh ─┐
                        ├─ "health :9002 → use; else start bun src/server.ts on :9002"
app ServerSupervisor ───┘   (symmetric; only one server on :9002)
app index.ts → POST /api/browser/electron-target {cdpPort} → cdp-session targets the WebContentsView
server: WS connections→0 for MERMAID_IDLE_SHUTDOWN_MS → removeInstance + exit; next MCP call → server-check.sh restarts
```

---

## 2. Function Blueprints

### `setElectronTarget(cdpPort)` / `clearElectronTarget()` + resolution (cdp-session.ts)
- Module state `runtimeElectronTarget`. `setElectronTarget` stores `{cdpPort}`; `clearElectronTarget` nulls it.
- `ensureTab`/`selectElectronViewTarget` electron-view gate becomes: `const electronView = runtimeElectronTarget != null || process.env.MC_BROWSER_TARGET === 'electron-view';` and the CDP port = `runtimeElectronTarget?.cdpPort ?? CDP_PORT`.
- **Edge:** runtime override wins over env; clearing reverts to default chrome mode.
- **Test:** set→electron-view selection picks the marker; clear→falls back.

### `POST/DELETE /api/browser/electron-target` (browser-routes.ts)
- POST: parse `{cdpPort:number}`; call `setElectronTarget(cdpPort)`; 200 `{ok:true}`. 400 if cdpPort missing.
- DELETE: `clearElectronTarget()`; 200.
- **Edge:** loopback only (consistent with other browser routes).

### Idle shutdown (handler.ts + server.ts)
- `handler`: after `connections.add/delete`, invoke `onConnectionsChanged?.(this.connections.size)`.
- `server.ts`: read `MERMAID_IDLE_SHUTDOWN_MS`; if `>0`, register `wsHandler.setOnConnectionsChanged((n) => { if (n === 0) armIdleTimer(); else cancelIdleTimer(); })`. `armIdleTimer` = `setTimeout(async () => { await removeInstance(sessionId); process.exit(0); }, MS)`; `cancelIdleTimer` clears it. Arm once at startup too (starts with 0 connections — but the plugin hook just health-checked it, so a UI/MCP will connect soon; the grace window covers the gap).
- **Edge:** don't arm if MS===0 (disabled). Hysteresis: only re-arm on transition to 0. Avoid exiting while a request is mid-flight (10min window makes this moot).
- **Test:** simulate connections→0 arms; →1 cancels; (timer via fake timers if extracted).

### `ServerSupervisor.start()` attach-or-start (server-supervisor.ts)
- `const port = this.opts.port ?? Number(process.env.MERMAID_PORT ?? 9002);`
- health-check `http://127.0.0.1:${port}/api/health` (existing `fetchImpl`, short timeout). If ok → `{ port, attached: true }` (spawn nothing).
- else spawn with `env.PORT = String(port)` (the rest of the env unchanged), `waitForHealth(port)`, `{ port, attached: false }`.
- Drop `getFreePort()` for the server port (cdpPort still uses it in index.ts). Keep `checkExistingInstance` or supersede with the direct health-check (simpler — direct health-check on the canonical port).
- **Test:** fetchImpl healthy → attached true, spawnImpl NOT called; unhealthy → spawnImpl called with PORT=port.

### index.ts wiring
- After `const { port, attached } = await supervisor.start();`, register the embedded view target: `await fetch(\`http://127.0.0.1:${port}/api/browser/electron-target\`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ cdpPort }) }).catch(()=>{});`
- `before-quit`: remove `void supervisor?.stop();` (leave proxy/control/aggregator stops). Server self-reaps.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: server-electron-target
    files: [src/services/cdp-session.ts, src/routes/browser-routes.ts]
    tests: [src/services/__tests__/cdp-session.target.test.ts]
    description: "Runtime electron-view target override (setElectronTarget/clearElectronTarget) read by cdp-session; POST/DELETE /api/browser/electron-target endpoint."
    parallel: true
    depends-on: []
  - id: server-idle-shutdown
    files: [src/websocket/handler.ts, src/server.ts, src/config.ts]
    tests: []
    description: "WS consumer-count change callback; server arms MERMAID_IDLE_SHUTDOWN_MS timer on zero connections → removeInstance + clean exit; cancel on new connection; default 10min, 0 disables."
    parallel: true
    depends-on: []
  - id: app-shared-server
    files: [desktop/src/main/server-supervisor.ts, desktop/src/main/index.ts]
    tests: [desktop/src/main/__tests__/server-supervisor.test.ts]
    description: "Supervisor attach-or-start on canonical port (MERMAID_PORT/9002): health-check→attach if up, else spawn on that port. index.ts registers cdp target via POST /api/browser/electron-target after start; remove shared-server stop from before-quit."
    parallel: false
    depends-on: [server-electron-target]
```

### Execution Waves
- **Wave 1 (parallel):** server-electron-target, server-idle-shutdown
- **Wave 2:** app-shared-server (←server-electron-target)

### Post-build (manual, not an agent task)
- `npm version minor` (syncs plugin.json / marketplace.json / server.ts SERVER_VERSION per CLAUDE.md) for plugin redistribution — done by hand since it creates a commit+tag.

### Summary
- Total tasks: 3
- Total waves: 2
- Max parallelism: 2
- Plus a manual version bump for plugin redistribution.
