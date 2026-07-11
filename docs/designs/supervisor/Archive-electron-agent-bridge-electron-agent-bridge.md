# Blueprint: electron-agent-bridge

## Source Artifacts
- [[design-electron-agent-bridge]] · [[research-electron-agent-bridge]]
- Proven by `scripts/cdp-spike.mjs` (drove the real desktop app over CDP).

## Premise
Reusable, app-agnostic package `packages/electron-agent-bridge/` (relative-path import, NO bun workspaces) + mermaid glue. Reuse `chrome-remote-interface` (already a dep). Leave `cdp-session.ts` as-is. Discovery file canonical. Resolve CDP target per call.

---

## 1. Structure Summary

### Files
- [ ] `packages/electron-agent-bridge/package.json` — NEW. name `electron-agent-bridge`, type module, dep `chrome-remote-interface`, exports `./electron-main`, `./driver`, `./mcp-tools`, `.`.
- [ ] `packages/electron-agent-bridge/src/electron-main.ts` — NEW. `enableCdp`, `getFreePort`, `publishDiscovery` (Electron main side).
- [ ] `packages/electron-agent-bridge/src/driver.ts` — NEW. `ElectronDriver` (CDP client).
- [ ] `packages/electron-agent-bridge/src/mcp-tools.ts` — NEW. `createDesktopTools(getDriver)` → `{ defs, handlers }`.
- [ ] `packages/electron-agent-bridge/src/index.ts` — NEW. re-exports.
- [ ] `packages/electron-agent-bridge/tsconfig.json` — NEW. extends repo style (module/moduleResolution, allowImportingTsExtensions or matching the repo's `.ts` convention).
- [ ] `desktop/src/main/index.ts` — MODIFY. Use `enableCdp()` for the CDP switch (replace inline appendSwitch) and call `publishDiscovery({ appName:'mermaid-collab', port })` after the window/CDP is ready. Keep existing electron-target POST + banner.
- [ ] `src/mcp/setup.ts` — MODIFY. Import `createDesktopTools`; lazy server-singleton `getDesktopDriver()` via `ElectronDriver.fromDiscovery({ appName:'mermaid-collab', selectTarget })`; spread `defs` into tools-list, dispatch handlers; `desktop_screenshot` saves base64 under `.collab` and returns path.

### Types (package)
```ts
interface DiscoveryRecord { port:number; webSocketDebuggerUrl?:string; pid:number; appName:string; }
interface CdpTarget { id:string; type:string; title?:string; url?:string; webSocketDebuggerUrl?:string; }
interface ScreenshotResult { base64:string; }
type TargetPredicate = (t:CdpTarget) => boolean;
```

### Interaction
```
Electron main: enableCdp() [before whenReady] → publishDiscovery() [after ready] → ~/.<app>/electron-cdp.json
collab server: desktop_* tool → getDesktopDriver() → ElectronDriver.fromDiscovery() → chrome-remote-interface → renderer
```

---

## 2. Function Blueprints

### `electron-main.ts`
- `getFreePort(): Promise<number>` — copy the impl from `desktop/src/main/server-supervisor.ts` (net server listen on 0). No electron import.
- `enableCdp(app, opts?:{ port?:number; address?:string }): Promise<number>` — port = opts.port ?? env MC_CDP_PORT ?? await getFreePort(); `app.commandLine.appendSwitch('remote-debugging-port', String(port))`; `appendSwitch('remote-debugging-address', opts.address ?? '127.0.0.1')`; return port. MUST be called before `app.whenReady()`. (Take `app` as param to avoid the package importing electron — keeps it dependency-light; caller passes Electron's `app`.)
- `publishDiscovery(opts:{ appName:string; port:number; path?:string }): Promise<void>` — fetch `http://127.0.0.1:<port>/json/list`, pick first `type==='page'` target's `webSocketDebuggerUrl` (best-effort, retry a few times since renderer may still be coming up); write `{ port, webSocketDebuggerUrl, pid:process.pid, appName }` to `path ?? join(homedir(), '.'+appName, 'electron-cdp.json')` (mkdir recursive). Errors are non-fatal (log).
- **Test:** publishDiscovery writes the expected JSON given a mock /json/list; getFreePort returns a usable port.

### `driver.ts` — `ElectronDriver`
Wraps `chrome-remote-interface`. Connect helpers resolve a target, then `CDP({ host, port, target: webSocketDebuggerUrl })`.
- `static async fromDiscovery(opts?:{ appName?:string; path?:string; selectTarget?:TargetPredicate }): Promise<ElectronDriver>` — read discovery file (default path from appName), get port; `CDP.List({host,port})`; pick target via selectTarget ?? first `type==='page'`; construct.
- `static async fromUrl(wsUrl:string): Promise<ElectronDriver>`.
- `private async resolveClient()` — **resolve target per call** (re-List + reconnect) to survive renderer reloads; cache the port+selector, not the target id.
- `navigate(url): Promise<void>` — Page.enable + Page.navigate + wait load.
- `screenshot(opts?:{format?}): Promise<ScreenshotResult>` — Page.captureScreenshot → { base64 }.
- `eval(expression): Promise<unknown>` — Runtime.evaluate({returnByValue:true}); throw on exceptionDetails.
- `click(selector): Promise<void>` — Runtime.evaluate a querySelector(...).click() (DOM-based, simplest robust), or DOM+Input; v1 use JS click via eval.
- `fill(selector, value): Promise<void>` — eval set value + dispatch input/change.
- `waitFor(selector, timeoutMs=5000): Promise<void>` — poll eval `!!document.querySelector(sel)`.
- `snapshot(): Promise<string>` — eval returning a compact text outline (tag+text of interactive/visible els), mirroring browser_snapshot’s spirit.
- `listTargets(): Promise<CdpTarget[]>`, `close(): Promise<void>`.
- **Test:** against the running desktop app (CDP 9444): fromDiscovery/fromUrl connects, eval returns document.title, screenshot returns non-empty base64, waitFor resolves for an existing selector. (Integration test, gated on the app running.)

### `mcp-tools.ts` — `createDesktopTools(getDriver: () => Promise<ElectronDriver>)`
Returns `{ defs, handlers }`:
- defs: `desktop_navigate {url}`, `desktop_screenshot {format?}`, `desktop_eval {expression}`, `desktop_click {selector}`, `desktop_fill {selector,value}`, `desktop_wait_for {selector,timeoutMs?}`, `desktop_snapshot {}`.
- handlers: each `await getDriver()` then call the method; return JSON string. `desktop_screenshot` returns `{ base64 }` (mermaid glue saves to disk).
- Clear error if getDriver throws (app not running / no discovery file).
- **Test:** handler shape; getDriver error surfaces a helpful message.

### `desktop/src/main/index.ts` (MODIFY)
Replace the inline `appendSwitch('remote-debugging-port'...)` (lines ~246-248) with `const cdpPort = await enableCdp(app, { port: process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : undefined });` (keep before whenReady). After `createWindow()` (and the renderer loads), `void publishDiscovery({ appName:'mermaid-collab', port: cdpPort });`. Keep banner + electron-target POST. Import from the package via relative path `../../../packages/electron-agent-bridge/src/electron-main.ts` (match `.ts` import convention) OR via the package name if tsconfig paths set — use relative to avoid workspace setup.

### `src/mcp/setup.ts` (MODIFY)
- Import `{ createDesktopTools }` and `{ ElectronDriver }` from the package (relative path `../../packages/electron-agent-bridge/src/...`).
- Module singleton: `let _desktopDriver; async function getDesktopDriver() { if (!_desktopDriver) _desktopDriver = await ElectronDriver.fromDiscovery({ appName:'mermaid-collab', selectTarget: t => t.type==='page' && /Mermaid Collab/i.test(t.title||'') }); return _desktopDriver; }` (on connect failure, reset to null so next call retries).
- `const { defs: desktopDefs, handlers: desktopHandlers } = createDesktopTools(getDesktopDriver);` spread defs into tools-list (near supervisor/browser tools); in the switch, for `desktop_screenshot` wrap: save base64 to active session `.collab/.../images/desktop-<ts>.png`, return path; other desktop_* delegate to desktopHandlers.

---

## 3. Task Dependency Graph

### YAML Graph
```yaml
tasks:
  - id: pkg-scaffold
    files: [packages/electron-agent-bridge/package.json, packages/electron-agent-bridge/tsconfig.json, packages/electron-agent-bridge/src/index.ts]
    tests: []
    description: "Package scaffold: package.json (chrome-remote-interface dep, exports), tsconfig, index re-exports"
    parallel: true
    depends-on: []
  - id: electron-main
    files: [packages/electron-agent-bridge/src/electron-main.ts]
    tests: [packages/electron-agent-bridge/src/electron-main.test.ts]
    description: "enableCdp / getFreePort / publishDiscovery (Electron main helpers, app passed in)"
    parallel: true
    depends-on: []
  - id: driver
    files: [packages/electron-agent-bridge/src/driver.ts]
    tests: [packages/electron-agent-bridge/src/driver.test.ts]
    description: "ElectronDriver over chrome-remote-interface: fromDiscovery/fromUrl/navigate/screenshot/eval/click/fill/waitFor/snapshot/listTargets/close"
    parallel: true
    depends-on: []
  - id: mcp-tools-factory
    files: [packages/electron-agent-bridge/src/mcp-tools.ts]
    tests: []
    description: "createDesktopTools(getDriver) -> {defs,handlers} for desktop_* tools"
    parallel: false
    depends-on: [driver]
  - id: desktop-wiring
    files: [desktop/src/main/index.ts]
    tests: []
    description: "Use enableCdp + publishDiscovery in desktop main (keep banner + electron-target POST)"
    parallel: false
    depends-on: [electron-main]
  - id: server-integration
    files: [src/mcp/setup.ts]
    tests: []
    description: "Register desktop_* tools: lazy getDesktopDriver singleton via fromDiscovery; desktop_screenshot saves to .collab and returns path"
    parallel: false
    depends-on: [driver, mcp-tools-factory, pkg-scaffold]
  - id: smoke-verify
    files: []
    tests: []
    description: "Integration smoke: against running desktop app (CDP 9444) verify driver eval/screenshot; verify desktop_* tools registered. Replace scripts/cdp-spike.mjs usage with the real driver."
    parallel: false
    depends-on: [server-integration, desktop-wiring]
```

### Execution Waves
**Wave 1 (parallel):** pkg-scaffold, electron-main, driver
**Wave 2:** mcp-tools-factory, desktop-wiring
**Wave 3:** server-integration, smoke-verify

### Summary
- Total tasks: 7 · Waves: 3 · Max parallelism: 3
