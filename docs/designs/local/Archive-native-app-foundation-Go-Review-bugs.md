# Bug Review

Scope: introduced-bug review (correctness only) of the new Electron desktop shell + CDP electron-view changes. 18 new tests pass; `electron-vite build` succeeds.

## Findings

### 1. Important — Single-instance lock does not stop bootstrap()
`desktop/src/main/index.ts:8-11`

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
```

`app.quit()` only schedules a quit; module evaluation continues and `void bootstrap()` (line 119) still runs on the second instance. Before the quit actually fires, `bootstrap()` awaits `getFreePort()`, appends the `remote-debugging-port` switch, awaits `app.whenReady()` (which can resolve before quit completes), and may `createWindow()` + spawn a second Bun sidecar — exactly what the single-instance lock is meant to prevent. The `second-instance` handler on the first process also fires, so you can briefly get two windows / two sidecars and a port/CDP clash.

Fix: guard the rest of startup on the lock. e.g. only run bootstrap when the lock is held:
```ts
if (!gotLock) {
  app.quit();
} else {
  // register handlers + void bootstrap();
}
```
or `app.exit(0)` and ensure no further top-level side effects execute.

### 2. Minor — WebContentsView pane is leaked / `browserPane` is write-only
`desktop/src/main/index.ts:14,110-112` and `desktop/src/main/browser-pane.ts`

`browserPane` is assigned in `bootstrap()` but never read, and the `WebContentsView` added via `win.contentView.addChildView(view)` is never removed (no `removeChildView` / destroy on `mainWindow` `'closed'`). For the current single-window phase this is benign, but on macOS where the app stays alive after window close (`window-all-closed` no-op) and a new window is created via `activate`, the old view/webContents is orphaned. Recommend storing the pane reference for later layout/teardown (the comment says a later phase wires bounds via IPC, so this is partly intentional) and clearing it on window close. Not a correctness defect today — flagged as a resource-management note. Note: it did not trip `noUnusedLocals` (build passed).

## Non-issues verified (no bug)
- bootstrap() ordering is correct: `getFreePort()` is awaited and the `remote-debugging-port` switch is appended BEFORE `app.whenReady()`, so the CDP switch is set before `ready`.
- `waitForHealth` timeout/kill: on timeout it SIGTERMs the child and throws; killing an already-dead/never-started child is wrapped in try/catch — safe.
- `stop()` attached-vs-spawned logic is correct: returns early when `attached` (does not kill a server it didn't spawn); SIGTERM + Windows `taskkill /T /F` for spawned. Double-kill after a health-timeout is harmless (guarded).
- env construction passes `CDP_PORT` + `MC_BROWSER_TARGET=electron-view` only when `cdpPort != null`; spreads `process.env` first so overrides win. Verified by tests.
- `AbortSignal.timeout(1500)` usage in health/dedup fetches is correct.
- `checkExistingInstance` only attaches on a passing health check; discovery/fetch errors fall through to spawn. Correct.
- CDP_PORT re-export: `import { CDP_PORT } from '../config.js'; export { CDP_PORT };` is valid; the import is hoisted above the `createRequire` lines at runtime regardless of source position. config.ts parses env at load with NaN fallback to 9333 — covered by tests.
- `selectElectronViewTarget`: correctly requires `type === 'page'` AND marker in url/title; uses `(t.url ?? '')` null-guard and strict title equality; throws when absent. The electron-view branch in `createOrReplaceTab` correctly bypasses `Target.createTarget` and registers the existing view id. Covered by tests.
- getFreePort: standard ephemeral-port-then-close pattern; inherent TOCTOU window is acceptable.
