# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 7
- **Total waves:** 4
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** pkg-scaffold, electron-main, driver
**Wave 2:** mcp-tools-factory, desktop-wiring
**Wave 3:** server-integration
**Wave 4:** smoke-verify

## Task Graph (YAML)

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

## Dependency Visualization

```mermaid
graph TD
    pkg-scaffold["pkg-scaffold<br/>"Package scaffold: package.jso..."]
    electron-main["electron-main<br/>"enableCdp / getFreePort / pub..."]
    driver["driver<br/>"ElectronDriver over chrome-re..."]
    mcp-tools-factory["mcp-tools-factory<br/>"createDesktopTools(getDriver)..."]
    desktop-wiring["desktop-wiring<br/>"Use enableCdp + publishDiscov..."]
    server-integration["server-integration<br/>"Register desktop_* tools: laz..."]
    smoke-verify["smoke-verify<br/>"Integration smoke: against ru..."]

     --> pkg-scaffold
     --> electron-main
     --> driver
    driver --> mcp-tools-factory
    electron-main --> desktop-wiring
    driver --> server-integration
    mcp-tools-factory --> server-integration
    pkg-scaffold --> server-integration
    server-integration --> smoke-verify
    desktop-wiring --> smoke-verify

    style pkg-scaffold fill:#c8e6c9
    style electron-main fill:#c8e6c9
    style driver fill:#c8e6c9
    style mcp-tools-factory fill:#bbdefb
    style desktop-wiring fill:#bbdefb
    style server-integration fill:#fff3e0
    style smoke-verify fill:#f3e5f5
```

## Tasks by Wave

### Wave 1

- **pkg-scaffold**: "Package scaffold: package.json (chrome-remote-interface dep, exports), tsconfig, index re-exports"
- **electron-main**: "enableCdp / getFreePort / publishDiscovery (Electron main helpers, app passed in)"
- **driver**: "ElectronDriver over chrome-remote-interface: fromDiscovery/fromUrl/navigate/screenshot/eval/click/fill/waitFor/snapshot/listTargets/close"

### Wave 2

- **mcp-tools-factory**: "createDesktopTools(getDriver) -> {defs,handlers} for desktop_* tools"
- **desktop-wiring**: "Use enableCdp + publishDiscovery in desktop main (keep banner + electron-target POST)"

### Wave 3

- **server-integration**: "Register desktop_* tools: lazy getDesktopDriver singleton via fromDiscovery; desktop_screenshot saves to .collab and returns path"

### Wave 4

- **smoke-verify**: "Integration smoke: against running desktop app (CDP 9444) verify driver eval/screenshot; verify desktop_* tools registered. Replace scripts/cdp-spike.mjs usage with the real driver."
