# Design: electron-agent-bridge

Informed by [[research-electron-agent-bridge]]. Goal: let an AI agent drive the **real Electron desktop app** (navigate/screenshot/click/eval/snapshot) via CDP, packaged as a **reusable, app-agnostic** module so it drops into other Electron apps.

## Key finding (de-risks the build)
The collab server already drives the Electron renderer over CDP through `src/services/cdp-session.ts` (`chrome-remote-interface`), pointed at the renderer port via `setElectronTarget()` + `desktop/src/main/index.ts:247,278`. So this is **repackaging + discovery convention + clean API + `desktop_*` tools**, not new CDP code.

## Decisions
- **No formal Bun workspaces in v1.** `packages/electron-agent-bridge/` is a self-contained dir with its own `package.json`, imported by **relative path** from `desktop/` and the root server. Reusable + extractable to npm later, without touching root build config (avoids the workspace/electron-vite/`.ts`-import risk).
- **Leave `cdp-session.ts` as-is** in v1 (no migration onto the new driver) — avoids two-path drift risk now; migrate later if desired.
- **Discovery file is canonical** for the package (`~/.<app>/electron-cdp.json`). mermaid keeps its existing `/api/browser/electron-target` POST.
- **Resolve the CDP target per call** (never cache target IDs — they churn on renderer reload).
- The package is **app-agnostic**: no mermaid imports. App specifics (view-marker heuristic, `.collab` image paths, session registry) stay in mermaid glue.

## Package API — `packages/electron-agent-bridge/`
```
src/electron-main.ts   // imported in an Electron app's MAIN process
  enableCdp(opts?: { port?: number; address?: string }): number
    // appends remote-debugging-port BEFORE app.whenReady(); returns the port
  getFreePort(): Promise<number>
  publishDiscovery(opts: { appName: string; port: number; path?: string }): Promise<void>
    // after whenReady: read http://127.0.0.1:<port>/json/list, write
    // { port, webSocketDebuggerUrl, pid, appName } to path
    // (default ~/.<appName>/electron-cdp.json)

src/driver.ts          // imported anywhere (server/CLI/test) — CDP client
  class ElectronDriver {
    static fromDiscovery(opts?: { appName?: string; path?: string; selectTarget?: (t)=>boolean }): Promise<ElectronDriver>
    static fromUrl(wsUrl: string): Promise<ElectronDriver>
    navigate(url): Promise<void>
    screenshot(opts?: { format?: 'png'|'jpeg' }): Promise<{ base64: string }>
    eval(expression): Promise<unknown>
    click(selector, opts?): Promise<void>
    fill(selector, value): Promise<void>
    snapshot(): Promise<string>        // a11y/DOM text snapshot
    waitFor(selector, timeoutMs?): Promise<void>
    listTargets(): Promise<Target[]>
    close(): Promise<void>
  }

src/mcp-tools.ts       // optional MCP adapter
  createDesktopTools(getDriver: () => Promise<ElectronDriver>): { defs: ToolDef[]; handlers: Record<string, Handler> }

src/index.ts           // re-exports
package.json           // name "electron-agent-bridge", type module, dep chrome-remote-interface
```

## mermaid glue
- `desktop/src/main/index.ts`: replace the inline CDP-switch logic with `enableCdp()` and, after `createWindow()`, call `publishDiscovery({ appName: 'mermaid-collab', port })`. (Keep existing electron-target POST.)
- `src/mcp/setup.ts`: import `createDesktopTools`; a lazy server singleton `getDesktopDriver()` does `ElectronDriver.fromDiscovery({ appName: 'mermaid-collab', selectTarget: <view-marker predicate> })` on first use; spread `defs` into the tools-list, dispatch handlers in the switch. `desktop_screenshot` saves base64 under the active session's `.collab/.../images` and returns the path (glue concern), wrapping the package's base64.
- `desktop/package.json`: add the relative dep on `../packages/electron-agent-bridge` (or import by relative path).

## desktop_* MCP tools (mermaid)
`desktop_navigate {url}`, `desktop_screenshot {}` (→ saved path), `desktop_eval {expression}`, `desktop_click {selector}`, `desktop_fill {selector,value}`, `desktop_snapshot {}`, `desktop_wait_for {selector,timeoutMs?}`. Lazy-connect via discovery file; clear error if the desktop app isn't running / no discovery file.

## Risks
1. Target churn on renderer reload → resolve per call (designed in).
2. CDP switch before whenReady (enableCdp owns the ordering).
3. (Mitigated) workspace risk avoided by relative-path package.
4. cdp-session drift — accepted; not migrating in v1.
5. Two discovery sources — package uses the file; documented.
6. Multi-window — `selectTarget` predicate param.

## Task breakdown (preview)
- W1: `electron-agent-bridge` package — driver.ts (ElectronDriver) ; electron-main.ts (enableCdp/getFreePort/publishDiscovery) ; package.json + index.ts.
- W2: mcp-tools.ts factory (createDesktopTools) ; desktop main wiring (enableCdp + publishDiscovery).
- W3: setup.ts integration (lazy driver singleton + register desktop_* tools) ; smoke verification.
