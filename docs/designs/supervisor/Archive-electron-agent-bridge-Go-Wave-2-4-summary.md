# Waves 2-4 (electron-agent-bridge)

## Wave 2
- **mcp-tools-factory** — NEW `packages/.../src/mcp-tools.ts`. `createDesktopTools(getDriver)` → {defs,handlers} for 8 desktop_* tools. Package typechecks clean.
- **desktop-wiring** — MODIFIED `desktop/src/main/index.ts`. Imports enableCdp/publishDiscovery (submodule, not barrel); replaced inline CDP-switch with `enableCdp(app,...)` (before whenReady); `void publishDiscovery({appName:'mermaid-collab',port:cdpPort})` after the electron-target POST.

## Wave 3
- **server-integration** — MODIFIED `src/mcp/setup.ts`. Imports ElectronDriver + createDesktopTools (+ node:fs/promises, node:path). Module-scope lazy `getDesktopDriver()` singleton via `ElectronDriver.fromDiscovery({appName, selectTarget:/Mermaid Collab/})`. Spread desktop defs into ListTools (desktop_screenshot overridden to accept optional project/session). Switch dispatches desktop_* via factory handlers; desktop_screenshot intercepts to save PNG under `<project>/.collab/sessions/<session>/images` when project+session given. tsc clean.

## Wave 4 — smoke-verify (END TO END, real app)
- Restarted 9002 server (new setup.ts) + relaunched desktop dev (new index.ts).
- `publishDiscovery` wrote `~/.mermaid-collab/electron-cdp.json` {port:9444, webSocketDebuggerUrl, pid, appName}.
- Shipped `ElectronDriver.fromDiscovery()` (scripts/driver-smoke.mjs) drove the REAL app: eval document.title="Mermaid Collab", listTargets (2 pages), snapshot (real element outline), screenshot saved (.collab/driver-smoke.png).
- MCP `tools/list` over HTTP confirms all 8 desktop_* tools registered: navigate/screenshot/eval/click/fill/wait_for/snapshot/list_targets.

## Result
electron-agent-bridge works end-to-end through the shipped package + MCP registration. Reusable: package is app-agnostic (no mermaid imports), imported by relative path; enableCdp/publishDiscovery drop into any Electron main; ElectronDriver/createDesktopTools usable by any host.
