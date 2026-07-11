# Bug Review (electron-agent-bridge)

Scope: correctness only (introduced bugs), commit bcdcc5b. Files reviewed: driver.ts, electron-main.ts, mcp-tools.ts, index.ts, package.json/tsconfig.json, plus bridge edits in desktop/src/main/index.ts and src/mcp/setup.ts.

## Important

### 1. Malformed `MC_CDP_PORT` silently becomes `NaN` (not caught by `??` fallback)
- `electron-main.ts:43-44` and `desktop/src/main/index.ts:247`
- `enableCdp`: `opts?.port ?? (process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : await getFreePort())`. If `MC_CDP_PORT` is set but non-numeric (e.g. "abc"), `Number(...)` yields `NaN`. `NaN` is truthy-for-`?:` only via the string check, but the real problem: in the desktop call site the expression `process.env.MC_CDP_PORT ? Number(...) : undefined` passes `NaN` as `opts.port`. Inside `enableCdp`, `opts?.port ?? ...` — `NaN` is NOT nullish, so the `getFreePort()` fallback is skipped and `String(NaN)` = `"NaN"` is appended as `remote-debugging-port`. Chrome ignores/garbles it; `publishDiscovery` then fetches `http://127.0.0.1:NaN/json/list` and writes a discovery record with `port: NaN`, so the driver can never connect.
- Why it matters: any typo in the env var bricks CDP with no clear error.
- Fix: validate. In `enableCdp`, compute `const envPort = process.env.MC_CDP_PORT ? Number(process.env.MC_CDP_PORT) : undefined;` and treat `Number.isNaN` / `!Number.isInteger` as unset, falling back to `getFreePort()`. Centralize so both the desktop call site and `enableCdp` agree. (Pre-existing in desktop too, but the new bridge keeps the same flaw.)

## Minor

### 2. Saved screenshot always uses `.png` extension even for JPEG
- `src/mcp/setup.ts` desktop_screenshot case: `filePath = ...desktop-screenshot-${Date.now()}.png` regardless of `a.format`. When `format: 'jpeg'`, JPEG bytes are written to a `.png` file.
- Fix: `const ext = a.format === 'jpeg' ? 'jpg' : 'png';` and use it in the filename.

### 3. Stale cached driver never invalidated on later failures
- `src/mcp/setup.ts` `getDesktopDriver`: `_dd` is correctly reset to `null` before throwing on the initial `fromDiscovery` failure (retries work — good). But once cached, a subsequent op failure (app closed/port changed) leaves `_dd` populated; callers keep hitting a driver pointed at a dead endpoint until process restart. Connect-per-op + per-call target resolution mitigates same-port restarts, but a new free port (no MC_CDP_PORT) won't be re-discovered.
- Fix (optional): on a connect error inside handlers, reset `_dd = null` so the next call re-reads discovery. Low priority for the verified single-session flow.

### 4. `listTargets()` returns `[]` for wsUrl-only drivers
- `driver.ts:255-258`: guarded by `if (!this.port) return []`. A driver built via `fromUrl`/`{wsUrl}` (no port) silently returns empty rather than erroring. Cosmetic for current usage (discovery path always has a port).

## Checked — no bug found
- CDP client closed in `finally` for every op including `waitFor` (both timeout-throw and success-return paths) and on `connect()` throw (no client opened yet). Correct.
- `getFreePort` resolve/reject paths and `server.close` timing correct (`error` listener attached before `listen`).
- `publishDiscovery` retry loop is bounded (10 attempts), per-attempt fetch errors caught, and the file is ALWAYS written afterward (port-only record when no page target) — no infinite loop, no unhandled rejection (whole body in try/catch, fire-and-forget via `void`).
- `enableCdp` is `await`ed BEFORE `app.whenReady()` (desktop index.ts:247 vs 250) — switch takes effect. `cdpPort` in scope for the fetch and `publishDiscovery`.
- `eval` exceptionDetails handled; `fill` objectId null-checked; `click` not-found handled; ECONNREFUSED mapped to a clear error.
- setup.ts switch: grouped case labels fall through to one shared block; `desktop_screenshot` intercepted separately before the group; base64→Buffer write correct; project/session both-or-neither gate correct.
- `createRequire(import.meta.url)` usage correct for loading the untyped CJS module under ESM.
- package.json/tsconfig sanity OK; chrome-remote-interface resolvable from root node_modules.
