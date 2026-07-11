# Research: electron-agent-bridge (agent-drivable Electron automation)

## Reuse verdict: REUSE the existing CDP client
`src/services/cdp-session.ts` uses **`chrome-remote-interface`** (raw CDP, not puppeteer/playwright). Its connect API — `CDP({host,port,target})` (~:132/:220) and `CDP.List({host,port})` (~:146/:208/:265) — already accepts an arbitrary endpoint and is **already pointed at the Electron renderer's CDP port in production** via `setElectronTarget()` (~:13), driven by `desktop/src/main/index.ts:247,278`. So the collab `browser_*` tools can already drive the desktop renderer. The new package is **repackaging + a discovery-file convention + a clean class API**, not new CDP code.

## Electron-side hook point
`desktop/src/main/index.ts` bootstrap() (~238-253): `remote-debugging-port` is appended (MUST be before `app.whenReady()`), port from `MC_CDP_PORT` or `getFreePort()`. Add: default CDP on; after `whenReady()`/`createWindow()`, fetch the renderer's `webSocketDebuggerUrl` from `http://127.0.0.1:<port>/json/list` and **publish a discovery file**. `index.ts:278` already POSTs the electron target; `:302` reloads renderer to the proxy URL (target IDs churn — resolve per call).

## CDP target selection
`/json/list` returns targets; pick `type==='page'` main window. mermaid uses `selectElectronViewTarget`/`ELECTRON_VIEW_MARKER` (`cdp-session.ts:26-60`) — that view-marker heuristic stays mermaid glue; the package takes an optional `selectTarget` predicate for multi-window apps.

## Package layout (monorepo)
Root `package.json` is `type:module`, Bun-run, **no workspaces today**. Add `"workspaces": ["ui","desktop","packages/*"]`. New `packages/electron-agent-bridge/` (app-agnostic, NO mermaid imports):
- **electron-main helpers:** `enableCdp({port?,address?})` (owns the append-switch-before-whenReady sequencing), `getFreePort()` (copy of `server-supervisor.ts:33`), `publishDiscovery({appName,port,path?})` → writes `{port,webSocketDebuggerUrl,pid,appName}` to default `~/.<app>/electron-cdp.json`.
- **`ElectronDriver`** over chrome-remote-interface: `fromDiscovery()/fromUrl()`, `listTargets`, `navigate/screenshot/eval/click/fill/snapshot/waitFor/close` — thin reimplementations of the proven bodies in `src/mcp/tools/browser.ts`. `screenshot()` returns base64 (+optional path).
- **`createDesktopTools(driver)`** → `{ defs, handlers }` for any MCP host.

## mermaid glue (NOT in package)
- desktop main: call `enableCdp` + `publishDiscovery`.
- `src/mcp/setup.ts`: spread `createDesktopTools(driver).defs` into the tools-list (near `browserToolSchemas.*` ~:1723) + dispatch `desktop_*` in the handler switch (pattern ~:3896/:3924). Driver = server singleton, lazy-connect on first `desktop_*` call via discovery file.
- Keep in glue: `selectElectronViewTarget`/`ELECTRON_VIEW_MARKER`, session/tab registry + PID binding, `CDP_PORT` default 9333 + `MC_*` envs (`src/config.ts`). The `.collab/sessions/<session>/images` screenshot-path policy (`browser.ts:50`) stays glue.

## Screenshot delivery
CDP `Page.captureScreenshot` → base64. `desktop_screenshot` saves under project `.collab` and returns the path (mirror `browser_screenshot`, `browser.ts:50`); package returns base64 + optional path.

## Top risks
1. Target IDs churn on renderer reload (`index.ts:302`) → resolve target per call, never cache.
2. CDP switch must be appended before `whenReady()` (documented spike burn).
3. Adding workspaces touches Bun + npm + electron-vite resolution + the `.js`→`.ts` import convention at once.
4. Two CDP code paths (`cdp-session.ts` vs new driver) can drift — decide whether `cdp-session.ts` migrates onto `ElectronDriver` (recommend: later; v1 just adds the package + driver, leave cdp-session as-is).
5. Discovery-file vs existing `/api/browser/electron-target` POST = two sources of truth → keep discovery file canonical for the package; mermaid can keep its POST.
6. Multi-window apps need a caller `selectTarget` predicate.

## App-agnostic vs glue
| App-agnostic (package) | mermaid glue |
|---|---|
| enableCdp, getFreePort, publishDiscovery | desktop main calling them |
| ElectronDriver (CDP methods) | session/tab registry, PID binding |
| createDesktopTools factory | setup.ts spreading defs + dispatch |
| discovery-file format | view-marker target heuristic, .collab image paths, MC_* envs |
