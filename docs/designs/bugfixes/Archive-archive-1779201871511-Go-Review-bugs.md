# Bug Review — VS Code one-click collab server

Scope: server-resolver.ts, spawn-server.ts, ui-half.ts, workspace-half.ts, package.json. Generated bundle out/extension.js ignored.

## Critical

### C1 — Server crash/exit never resets the status bar (ui-half.ts ~427, spawn-server.ts:122)
`spawn-server.ts` registers `child.on('exit', ...)` but only logs. `ui-half.ts` keeps a `collabServerChild` reference and a SIGTERM disposer, but nothing listens for the child's `exit`/`error` to drive `collabServerState` back to `stopped`/`failed`. If the spawned server crashes (or exits) after reaching `ready`, the status bar stays `$(check) collab :PORT` indefinitely and `mermaidCollab.openUi` keeps opening a dead URL. Clicking the bar in `ready` only tries to open the dead UI; no way to restart without `Stop` first.
Fix: in `startCollabServerLocal`, attach `result.child.on('exit'/'error', ...)` that, if state's sessionId still matches, sets `failed`/`stopped`, calls `updateCollabServerBar()`, clears `collabServerChild`.

## Important

### I1 — Tunnel churn: onInstanceUp re-runs on every fs.watch event (ui-half.ts:556-568, 480-508)
`rescan()` calls `mermaidCollab.ui.onInstanceUp` for every instance. `fsSync.watch(instancesDir)` fires on any change — including the server rewriting its own `<sessionId>.json` heartbeat and `.lock` churn. Each `onInstanceUp` unconditionally disposes the existing tunnel and re-creates it, then rewrites `mermaidCollab.serverUrl`. Result: repeated tunnel teardown/recreate + config write storms on a steady-state server, with a window where no tunnel exists (UI flaps). On the pure-local UI host a loopback tunnel is opened needlessly.
Fix: dedupe in `onInstanceUp` — if a tunnel exists for `inst.sessionId` with the same remote port, return early. Debounce `rescan`, ignore non-`.json` files.

### I2 — readLocalInstances returns stale/dead instances (ui-half.ts:37-57)
`readLocalInstances()` accepts any well-formed `<x>.json` with `port`+`sessionId`; it does NOT probe `inst.pid` liveness (unlike spawn-server.ts:83-89). After a server dies without cleaning its file (doc says this happens on Windows force-kill), `rescan()` keeps calling `onInstanceUp` for the dead instance, opening tunnels to a closed port and overwriting `serverUrl` with a dead address — can clobber a healthy newer instance's config.
Fix: filter out instances whose `pid` is not alive (`process.kill(inst.pid,0)` in try/catch) before returning.

### I3 — Stop/dispose leaves pending awaiter; state race (ui-half.ts dispose ~444, stopCollabServer ~439, awaitInstanceUp:71-83)
`stopCollabServer` and the dispose subscription SIGTERM the child and set `stopped`, but do not reject/clear in-flight `awaitInstanceUp`. If the user clicks Stop while `starting`, the `pendingInstanceUp` entry survives until its 30 s timeout; if a matching instance file appears in that window the resolver still fires and `startCollabServerLocal` flips the bar back to `ready` after the user asked to stop.
Fix: on stop/dispose, reject + clearTimeout each `pendingInstanceUp` entry and clear the map; guard post-await state assignment to no-op if state is no longer `starting` for that sessionId.

### I4 — Local path never reports version skew (ui-half.ts startCollabServerLocal ~88-96)
Always sets `kind:'ready'`, never `'skew'`, although `inst.serverVersion` and `ctx.extension.packageJSON.version` are both available (remote path does compare). A local server whose source version differs from the extension shows green, defeating the documented local skew warning.
Fix: after `awaitInstanceUp`, compare `inst.serverVersion` vs extension version, set `skew` like `startCollabServerRemote`.

## Minor

### M1 — Status-bar port can disagree with serverUrl; resolve-before-tunnel race (ui-half.ts:95 vs 505-507, 478)
`startCollabServerLocal` sets `localPort: inst.port`, but `onInstanceUp` writes `serverUrl` from the tunnel's resolved `localAddress.port`, which on Remote-SSH/non-loopback can differ. Also `pending(inst)` resolves the awaiter (line 478) before the tunnel/serverUrl write (486+), so `ready` is reported before serverUrl is written; an immediate open-UI click can read stale serverUrl.
Fix: derive `ready` localPort from the tunnel's resolved port, or resolve the awaiter only after the tunnel + serverUrl write completes.

### M2 — No fs.watch error fallback (ui-half.ts:567-573)
The 30 s poll fallback is only installed if `fsSync.watch()` throws synchronously. If `watch()` succeeds then later emits `'error'` (NFS / removed dir), discovery silently stops — no `watcher.on('error')` handler.
Fix: attach an `error` listener that closes the watcher and starts the poll fallback.

### M3 — pipeLines multibyte split (spawn-server.ts:43-60)
`chunk.toString()` with no decoder can split a multibyte UTF-8 sequence across chunk boundaries, corrupting non-ASCII log output. Cosmetic. Use `StringDecoder` / `stream.setEncoding('utf8')`. Line buffering itself is correct.

### M4 — findHighestSemverDir skips pre-release dirs (server-resolver.ts:28-39)
Regex `^(\d+)\.(\d+)\.(\d+)$` excludes `1.0.17-rc1` etc.; descending tuple sort itself is correct. Acceptable for current cache layout; noted in case pre-release dirs ever appear (would be silently skipped, older stable picked).

## Non-issues verified
- `awaitInstanceUp` clears its timeout and deletes its map entry on both resolve and timeout paths — no timer leak on the normal path.
- spawn-server.ts pre-flight dead-pid probe + stale file/lock cleanup correct; throws `AlreadyRunning` only for a live pid.
- `child.pid` undefined explicitly checked (spawn-server.ts:132).
- package.json well-formed; three new command declarations consistent with `registerCommand` calls; version bumped 1.0.15→1.0.17.
- `onInstanceUp`/`onInstanceDown` now guard missing/invalid args (prevents crash from manual palette invocation).
- AbortSignal listener in spawn-server.ts fine (no signal passed by callers).
