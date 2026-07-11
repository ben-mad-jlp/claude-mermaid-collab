# Blueprint: Native App Foundation (Phases 0–2)

## Source Artifacts
- `design-native-app` (decisions D1–D3, risks R1–R8, verified spikes)
- `design-server-switcher` (referenced for Phase 4+, not built here)
- On-disk plan: `docs/plans/2026-05-26-native-app.md` (Phases 0–2)
- Proven spike code: `desktop/main.js`, `desktop/extended.js`, `desktop/emulation-retest.js`

**Scope:** Phase 0 (Electron shell) + Phase 1 (sidecar supervision) + Phase 2 (browser pane + CDP retarget). Phases 3–8 are blueprinted later when reached.

---

## 1. Structure Summary

### Files
- [ ] `desktop/spikes/` — move `main.js`/`extended.js`/`emulation-retest.js` here (keep as reference)
- [ ] `desktop/electron.vite.config.ts` — Create: electron-vite config (main/preload/renderer)
- [ ] `desktop/src/main/index.ts` — Create: app entry; single-instance lock; remote-debugging-port switch; window; wires supervisor + browser pane
- [ ] `desktop/src/preload/index.ts` — Create: minimal contextBridge (`mc` namespace)
- [ ] `desktop/src/main/server-supervisor.ts` — Create: spawn/health/stop the Bun sidecar + instance dedup
- [ ] `desktop/src/main/browser-pane.ts` — Create: WebContentsView creation + bounds + load marker
- [ ] `desktop/src/main/__tests__/server-supervisor.test.ts` — Test
- [ ] `src/config.ts` — Modify: add `CDP_PORT` from env (default 9333)
- [ ] `src/services/cdp-session.ts:8` — Modify: import `CDP_PORT` from config; add electron-view target mode in `createOrReplaceTab`
- [ ] `src/services/__tests__/cdp-session.config.test.ts` — Test
- [ ] `src/services/__tests__/cdp-session.target.test.ts` — Test

### Type Definitions
```ts
// desktop/src/main/server-supervisor.ts
interface SupervisorOpts {
  repoRoot: string;
  project: string;
  session: string;
  host: string;            // MERMAID_BIND_HOST, default 127.0.0.1
  port?: number;           // if omitted, pick a free port
  token?: string;          // MERMAID_AUTH_TOKEN (Phase 5; pass-through now)
  cdpPort?: number;        // Electron remote-debugging-port → sidecar CDP_PORT
  spawnImpl?: typeof import('node:child_process').spawn;  // injectable for tests
  fetchImpl?: typeof fetch;                               // injectable for tests
  discoveryImpl?: () => Promise<Array<{ project: string; session: string; port: number }>>;
}
class ServerSupervisor {
  constructor(opts: SupervisorOpts);
  start(): Promise<{ port: number; attached: boolean }>;
  stop(): Promise<void>;
  isHealthy(): Promise<boolean>;
}
```

### Component Interactions
```
app ready
 └─ index.ts sets remote-debugging-port=<free loopback> (BEFORE ready)
 └─ ServerSupervisor.start()
      ├─ dedup: findInstance(project,session) healthy? → attach (no spawn)
      └─ else spawn `bun run src/server.ts` (env: PORT, HOST, MERMAID_PROJECT,
         MERMAID_SESSION, CDP_PORT=<debug port>, MC_BROWSER_TARGET=electron-view)
         → poll /api/health → { port }
 └─ BrowserWindow.loadURL(http://127.0.0.1:<port>)   ← real collab UI
 └─ browser-pane.ts: WebContentsView added to window; its CDP target is what
    the sidecar's browser_* tools drive (CDP_PORT points at Electron's debug port)
```

---

## 2. Function Blueprints

### `ServerSupervisor.start(): Promise<{ port, attached }>`
**Pseudocode:**
1. If `opts.port` unset → `port = getFreePort()`, else `port = opts.port`.
2. Dedup: `instances = await discoveryImpl()`; find one matching `(project, session)`; if found, health-check its port via `fetchImpl(GET /api/health)`; if healthy → return `{ port: existing, attached: true }` (do NOT spawn).
3. Else spawn: `child = spawnImpl('bun', ['run','src/server.ts'], { cwd: repoRoot, env })` where env carries PORT/HOST/MERMAID_PROJECT/MERMAID_SESSION/CDP_PORT/MC_BROWSER_TARGET (+ token/bind-host pass-through).
4. Poll `GET http://${host}:${port}/api/health` every 300ms until ok or 25s timeout.
5. On ok → store `this.child`, return `{ port, attached: false }`.
**Error handling:** health timeout → reject `Error('server health timeout')` and kill the child. Spawn failure (no pid) → reject.
**Edge cases:** chosen free port races (rare) → caller may retry; attached instance dies between discovery and health → falls through to spawn.
**Test strategy:** inject `spawnImpl`/`fetchImpl`/`discoveryImpl`. Tests: (a) health-ok-after-N → resolves port, not attached; (b) discovery has healthy instance → attached, spawn NOT called; (c) health never ok → rejects + kill called.

### `ServerSupervisor.stop(): Promise<void>`
**Pseudocode:** if attached → no-op (we don't own it). Else: POSIX `child.kill('SIGTERM')`; on `process.platform==='win32'` → `spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'])`. Wait for exit or 3s then force.
**Test strategy:** assert kill/taskkill invoked with the child pid; attached mode does not kill.

### `src/config.ts` — CDP_PORT
**Pseudocode:** `export const CDP_PORT = Number(process.env.CDP_PORT ?? '9333')` (validate integer; fallback 9333 on NaN).
**Test strategy:** with `CDP_PORT=4444` env → exported value 4444; unset → 9333.

### `src/services/cdp-session.ts` — config import + electron-view target
**Pseudocode (CDP_PORT):** delete the literal `export const CDP_PORT = 9333` (line 8); `import { CDP_PORT } from '../config'` and re-export for callers. No behavioral change when env unset.
**Pseudocode (electron-view mode in `createOrReplaceTab`):**
1. If `process.env.MC_BROWSER_TARGET === 'electron-view'`:
   - `tabs = await CDP.List({ host:'127.0.0.1', port })`
   - pick `view = tabs.find(t => t.type==='page' && (t.url.includes(MARKER) || t.title===MARKER))` (MARKER = the pane's known data/title)
   - if none → throw `Error('embedded view target not found')`
   - `tabRegistry.set(sessionName, view.id); persistTabRegistry(); return view.id` (never call `Target.createTarget`)
2. Else → existing behavior (Target.createTarget), unchanged.
**Error handling:** ECONNREFUSED → existing "Chrome not reachable" message (keep).
**Edge cases:** two `page` targets exist (spike-confirmed) → MARKER match disambiguates; pick deliberately, not `[0]`.
**Test strategy:** mock `CDP.List`; in electron-view mode resolves to the marked target and `Target.createTarget` is never called; default mode still creates a target.

### `desktop/src/main/index.ts` — startup wiring
**Pseudocode:**
1. `const cdpPort = await getFreePort()` then `app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort))` + `'remote-debugging-address','127.0.0.1'` — BEFORE `app.whenReady()` (spike lesson: switches ignored once ready).
2. `if (!app.requestSingleInstanceLock()) app.quit()` else handle `second-instance` (focus + parse `mermaid-collab://`).
3. `await app.whenReady()`; create `BrowserWindow({ webPreferences:{ contextIsolation:true, sandbox:true, preload }})`.
4. `const sup = new ServerSupervisor({ repoRoot, project, session, host:'127.0.0.1', cdpPort })`; `{ port } = await sup.start()`.
5. `win.loadURL('http://127.0.0.1:'+port)`.
6. `createBrowserPane(win, cdpPort)`; `app.on('before-quit', () => sup.stop())`.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: desktop-shell
    files: [desktop/electron.vite.config.ts, desktop/src/main/index.ts, desktop/src/preload/index.ts]
    tests: []
    description: "Phase 0.1 — electron-vite shell skeleton; spikes moved to desktop/spikes/; contextIsolation+sandbox; placeholder renderer"
    parallel: true
    depends-on: []
  - id: cdp-port-config
    files: [src/config.ts, src/services/cdp-session.ts]
    tests: [src/services/__tests__/cdp-session.config.test.ts]
    description: "Phase 2.1 — CDP_PORT configurable via env (default 9333); cdp-session imports it. No behavioral change when unset"
    parallel: true
    depends-on: []
  - id: desktop-deeplink
    files: [desktop/src/main/index.ts]
    tests: []
    description: "Phase 0.2 — single-instance lock + mermaid-collab:// protocol registration + second-instance forwarding"
    parallel: true
    depends-on: [desktop-shell]
  - id: server-supervisor
    files: [desktop/src/main/server-supervisor.ts]
    tests: [desktop/src/main/__tests__/server-supervisor.test.ts]
    description: "Phase 1.1 — ServerSupervisor: spawn bun sidecar, poll /api/health, stop (SIGTERM / Windows taskkill); injectable spawn/fetch for tests"
    parallel: true
    depends-on: [desktop-shell]
  - id: cdp-electron-target
    files: [src/services/cdp-session.ts]
    tests: [src/services/__tests__/cdp-session.target.test.ts]
    description: "Phase 2.2 — electron-view mode in createOrReplaceTab: select existing WebContentsView target by marker via CDP.List, never Target.createTarget"
    parallel: true
    depends-on: [cdp-port-config]
  - id: supervisor-instance-dedup
    files: [desktop/src/main/server-supervisor.ts]
    tests: [desktop/src/main/__tests__/server-supervisor.test.ts]
    description: "Phase 1.2 — attach to a healthy already-running instance (via discovery registry) instead of double-binding"
    parallel: true
    depends-on: [server-supervisor]
  - id: browser-pane
    files: [desktop/src/main/browser-pane.ts, desktop/src/main/index.ts]
    tests: []
    description: "Phase 2.3 — create WebContentsView pane; set remote-debugging-port; pass CDP_PORT + MC_BROWSER_TARGET=electron-view to sidecar; browser_* tools drive the pane end-to-end"
    parallel: false
    depends-on: [server-supervisor, cdp-electron-target]
```

### Execution Waves

**Wave 1 (parallel, no deps):**
- `desktop-shell`, `cdp-port-config`

**Wave 2 (depends on Wave 1):**
- `desktop-deeplink` (← desktop-shell), `server-supervisor` (← desktop-shell), `cdp-electron-target` (← cdp-port-config)

**Wave 3 (depends on Wave 2):**
- `supervisor-instance-dedup` (← server-supervisor), `browser-pane` (← server-supervisor + cdp-electron-target)

### Summary
- Total tasks: 7
- Total waves: 3
- Max parallelism: 3 (Wave 2)
