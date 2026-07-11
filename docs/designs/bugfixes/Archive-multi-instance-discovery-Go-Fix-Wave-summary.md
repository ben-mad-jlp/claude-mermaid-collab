# Fix Wave Summary

Fixed 2 Critical + 8 Important bugs from the post-Wave-4 review.

## Issues Fixed

### Critical
1. **`fix-extension-ui-wiring`** — `extension.ts` now calls `activateUi(context)` after the workspace early-return. Removed ~260 lines of duplicate inline UI logic (status bar, chrome lifecycle helpers, 4 commands, `updateStatusBar` function + callers). Imports `activateUi` and `findChrome` from `./ui-half`. Preserved WS bridge + browser CDP subsystem. File 905 → 641 lines.

### Important
2. **`fix-ui-half-tunnel-handling`** — `ui-half.ts` `onInstanceUp` now disposes any existing tunnel for the sessionId before opening a new one (prevents leaks from FS watcher repeated firings). `tunnel.localAddress` parsed safely as string|object|undefined; bails with log if unparseable. Also exported `CHROME_BINARIES_*` and `findChrome` for the entry-rewrite import.
3. **`fix-instance-discovery-races`** — `writeInstance` short-circuits with clear error if same-process re-register (was misleading ELOCKED message). `readInstances` now reads JSON first, then locks, then re-reads + verifies pid+startedAt before unlinking — prevents deleting a fresh owner's files. `installSignalHandlers` uses module-level singleton handlers iterating `lockReleaseMap`; replaced per-sessionId `signalHandlersInstalled` Set.
4. **`fix-server-port-and-shutdown`** — Hard-error guard on `server.port` (was silent fallback to PORT_REQUEST). Existing SIGINT/SIGTERM handlers now `await removeInstance(sessionId)` before `process.exit(0)` so the proper-lockfile lock is released cleanly.
5. **`fix-workspace-half-pid-check`** — New `instanceState(known): 'alive'|'dead'|'replaced'` helper combines file presence + `startedAt` match + `process.kill(pid, 0)` to detect PID reuse. Polling sweep dispatches accordingly: dead → announceDown, replaced → announceDown+announceUp, alive → noop. Removed unreliable `isPidAlive`.
6. **`fix-whereami-arg-validation`** — `--project`, `--project=`, `--session`, `--session=` all validate consumed values; missing → "requires a value" + exit 1; empty → "must be non-empty" + exit 1.

## Files Changed

- `extensions/vscode/src/extension.ts` (905 → 641 lines)
- `extensions/vscode/src/ui-half.ts` (added exports + dispose-existing tunnel + safe localPort parse)
- `extensions/vscode/src/workspace-half.ts` (instanceState helper + polling sweep dispatch)
- `src/services/instance-discovery.ts` (writeInstance guard + readInstances race fix + global signal handlers)
- `src/server.ts` (port hard-error + integrate removeInstance into existing handlers)
- `bin/whereami.ts` (validated arg parsing)

## Verification

All 6 implements verified first try. No new tsc errors introduced; remaining errors in `src/routes/api.ts`, `src/routes/ide-routes.ts`, `src/websocket/handler.ts`, `src/server.ts:43` (binding-sweeper import-extension), and other files are pre-existing and unrelated to this fix wave.

## Final TSC

Wave-introduced files: clean. Project-wide: pre-existing errors only.
