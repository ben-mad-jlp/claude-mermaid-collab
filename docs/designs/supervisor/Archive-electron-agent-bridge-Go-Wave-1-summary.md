# Wave 1 (electron-agent-bridge)

## Tasks
- **pkg-scaffold** — NEW `packages/electron-agent-bridge/{package.json,tsconfig.json,src/index.ts}`. type:module, dep chrome-remote-interface ^0.34.0, exports `.`/`./electron-main`/`./driver`/`./mcp-tools` → src/*.ts. tsconfig mirrors root (ES2022/bundler/strict). index re-exports with `.js` specifiers (repo convention).
- **electron-main** — NEW `src/electron-main.ts`. App-agnostic (no electron/mermaid imports): `ElectronAppLike`, `getFreePort()`, `enableCdp(app,opts)` (appends remote-debugging-port before whenReady), `publishDiscovery({appName,port,path?})` (retry /json/list, write `~/.<app>/electron-cdp.json`).
- **driver** — NEW `src/driver.ts`. `ElectronDriver` over chrome-remote-interface (loaded via createRequire as any, matching cdp-session.ts). fromDiscovery/fromUrl + navigate/screenshot/eval/click/fill/waitFor/snapshot/listTargets/close. Resolves target per call; connect-per-op with finally close.

## Verification
- Package tsconfig typecheck: clean except the expected `./mcp-tools.js` missing (Wave 2 creates it).
- Fixed during verify: driver's `import CDP` → `createRequire` (chrome-remote-interface ships no types; matches repo pattern).

## Wave TSC
clean (only expected forward-ref to mcp-tools, resolves in Wave 2).
