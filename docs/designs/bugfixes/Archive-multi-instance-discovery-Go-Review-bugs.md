# Bug Review — multi-instance-discovery (Waves 1–4)

## Critical

### 1. `activateUi` is never called — UI-half is dead code
**File:** `extensions/vscode/src/extension.ts` (entire `activate`) and `extensions/vscode/src/ui-half.ts:289`

`extension.ts::activate` only delegates to `activateWorkspace` when `extensionKind === Workspace`; otherwise it falls through to the legacy inline UI activation logic. It never imports/calls `activateUi` from `ui-half.ts`. As a result, on the UI host:
- `mermaidCollab.ui.onInstanceUp` / `onInstanceDown` / `openUi` / `startChromeDebug` / `stopChromeDebug` commands are **never registered**.
- `tunnelsBySessionId` is never populated; the workspace-half watcher will fire `executeCommand('mermaidCollab.ui.onInstanceUp', inst)` and VS Code will throw `command not found`.
- Local-only path scanning `~/.mermaid-collab/instances/` never runs.

**Fix:** In `extension.ts::activate`, after the `Workspace` early-return, call `activateUi(context)` (and remove the duplicate inline status bar / chrome / outputChannel code so they don't double-register).

### 2. Duplicate command registration risk if both halves run in same host
**File:** `extensions/vscode/src/ui-half.ts:307-316` vs `extensions/vscode/src/extension.ts:51-79`

Both register `mermaidCollab.toggleChromeDebug` and `mermaidCollab.showStatus`. Once #1 is fixed, the legacy registration in extension.ts will collide with `activateUi`'s registration → "command already exists" throw at activation. Remove the legacy ones (or guard).

### 3. `removeInstance` deletes file, then signal `exit` handler `unlinkSync`'s a path that may belong to a *new* owner
**File:** `src/services/instance-discovery.ts:140-150`

The SIGINT/SIGTERM handler calls `removeInstance(sessionId)` (async, releases the lock) → `process.exit(130)`. But the registered `process.on('exit', ...)` *also* runs and calls `unlinkSync(paths.instanceFile(sessionId))` and `unlinkSync(paths.lockFile(sessionId))` unconditionally. Between the async `removeInstance` releasing its lock and `process.exit` firing, another process *cannot* yet have grabbed the lock (we're still alive), but the bigger issue is: if the SIGINT path's `removeInstance` has already deleted the files, the exit-handler unlinks are harmless ENOENT swallows. **However** — if a user intentionally invokes `removeInstance` via some future code path while the server is still running, the exit handler will later delete the lock/file of whatever instance now occupies that sessionId. Today the exit handler is safe but fragile.

**Severity bumped down to Important** — see below.

## Important

### 4. `actualPort` can be 0 / undefined for ephemeral PORT_REQUEST
**File:** `src/server.ts:395`

`const actualPort = server.port ?? PORT_REQUEST;` — if `PORT_REQUEST=0` and `server.port` is somehow `undefined`, we'd write `0` to the discovery file. In Bun `server.port` is always populated post-`Bun.serve`, so practically safe, but the fallback should be a hard error rather than silently writing port 0. Suggest `if (typeof server.port !== 'number' || server.port === 0) throw …`.

### 5. `process.on('exit', unlinkSync)` may delete files belonging to a different sessionId after PID reuse / re-registration
**File:** `src/services/instance-discovery.ts:146-150`

Combined with `installSignalHandlers` being keyed only by sessionId in a `Set`, if the same process ever calls `installSignalHandlers` for *different* sessionIds (it currently doesn't, but the API allows it), each registers another `exit` listener — listeners accumulate. Also, the unconditional unlinkSync on exit fires even if the file was legitimately replaced by a fresh writeInstance (extremely unlikely in practice but worth a guard). Recommend: capture the inode/mtime at write time and only unlink if it matches.

### 6. `writeInstance` called twice in same process throws `ELOCKED` (since we already hold the lock)
**File:** `src/services/instance-discovery.ts:52-82`

`proper-lockfile` won't let the same process re-acquire its own lock with `retries:0`; it throws `ELOCKED`, which we then translate to "Duplicate instance for sessionId … another mermaid-collab server is already running" — a misleading message. If anything ever retries `writeInstance` (e.g., port rebind on EADDRINUSE), the user sees a wrong error. Fix: check `lockReleaseMap.has(inst.sessionId)` first and short-circuit (or at least produce a different error message).

### 7. `readInstances` stale-sweep race: two readers can both decide a record is stale and double-delete
**File:** `src/services/instance-discovery.ts:96-123`

If two processes call `readInstances` concurrently and the owning instance is dead, *both* may successfully acquire the lock sequentially (proper-lockfile is not atomic across processes for the lock-then-delete operation): process A locks → releases → unlinks json → unlinks lock. Process B (slightly behind) tries to lock the lockfile that A just deleted; `proper-lockfile` may recreate it (or throw ENOENT depending on version). The `.catch(() => {})` on unlinks swallows the issue, so the worst case is a confusing log line. **Real risk:** if a *new* instance has just called `writeInstance` (created lockfile, taken lock, written json) between A's lock-release and A's unlinks, A will delete the *new* json + lockfile. The new owner still holds an in-memory `release` handle but its on-disk record has vanished — discovery is silently broken.

**Fix:** read+verify the json's `pid`/`startedAt` before unlinking, or use a tmpfile-rename guard, or check `existsSync(lockFile)` is the same inode you locked.

### 8. `ui-half.ts` `(tunnel.localAddress as any).port` crashes when `localAddress` is a string
**File:** `extensions/vscode/src/ui-half.ts:330`

Per VS Code docs, `Tunnel.localAddress` is `string | { host, port }`. When it's a string like `"127.0.0.1:54321"`, `(s as any).port` is `undefined`, then we write `ws://127.0.0.1:undefined/ws` into settings and persist `undefined` in globalState.

**Fix:** branch on `typeof tunnel.localAddress === 'string'` and parse `:port$`.

### 9. `ui-half.ts` casts `tunnel` to `vscode.Disposable` without checking it implements `dispose`
**File:** `extensions/vscode/src/ui-half.ts:328`

`vscode.Tunnel` *does* have `dispose(): void | Thenable<void>` per the API, so this is fine — but the `(tunnel as any)` shape declared at top of file (`{ dispose(): void; localAddress: ... }`) hardcodes `dispose(): void`. If VS Code returns a Thenable, the subscription cleanup will not await it. Minor.

### 10. `workspace-half.ts` PID liveness check is unreliable across PID reuse
**File:** `extensions/vscode/src/workspace-half.ts:42-50, 117-118`

`process.kill(pid, 0)` returns true if any process has that PID — even an unrelated re-used one. After a server crash + long uptime, a different process inheriting the same PID makes us *not* announce-down, leaving a stale tunnel pinned forever. Combine with `startedAt` mtime check on the file or compare the `pid` to a re-read instance file's `pid`. (The workspace half doesn't read pid lockfiles, so this is effectively the only liveness check it has.)

### 11. Duplicate `announceUp` race between FS watcher and 30s poll
**File:** `extensions/vscode/src/workspace-half.ts:98-99, 112-114`

Both `watcher.onDidChange` and the poll (`if (!known.has(id))`) call `announceUp`. The poll only fires when `!known.has(id)`, so races are limited — but the watcher's `onDidChange` always fires even if the inst object is unchanged, leading to redundant `mermaidCollab.ui.onInstanceUp` invocations on every fsync. The UI half's handler creates a *new* tunnel each time without disposing the previous one → tunnel leak + repeated `globalState.update` + repeated workspace settings write.

**Fix:** in `ui-half.ts::onInstanceUp`, if `tunnelsBySessionId.has(inst.sessionId)`, either skip or dispose+recreate.

### 12. `whereami.ts` `--project=` (empty value) silently sets project to empty string
**File:** `bin/whereami.ts:12`

`a.slice('--project='.length)` returns `''` for `--project=`, which then filters to instances where `i.project === ''` — none. User gets empty results with no error. Minor UX bug; consider validating non-empty.

### 13. `whereami.ts` `argv[++i]` for `--project` with no following arg leaves `project = undefined` and continues
**File:** `bin/whereami.ts:11, 13`

If user passes `mermaid-collab whereami --project`, `argv[++i]` is `undefined`. The for-loop `i` advances past `argv.length`, so the loop ends without error. Filtering then ignores project (since `!project` is true). Silent wrong behavior.

**Fix:** validate `project !== undefined` after consuming.

## Minor

### 14. `process.exit(1)` mid-loop in whereami leaves the partial `readInstances` half-done
**File:** `bin/whereami.ts:17`

Not actually a problem — `process.exit` is synchronous and the loop exits before `readInstances` is even called. False alarm.

### 15. `installSignalHandlers` registers `process.on('exit', …)` (additive) every call for *different* sessionIds
**File:** `src/services/instance-discovery.ts:146`

`signalHandlersInstalled` Set keys by sessionId, so calling for sessionId A then B installs *two* exit listeners. With Node default max=10 listeners this is fine, but it's cumulative leak in long-lived processes that re-register sessions. Use `process.once('exit', …)` and a global flag, or de-dupe globally.

### 16. `writeInstance` writes lockfile then opens it for `lock()` — no `umask`/permission setting
**File:** `src/services/instance-discovery.ts:55`

Lockfile created with default permissions. If `~/.mermaid-collab/instances/` is on a multi-user host, other users could potentially interfere. Low risk for the typical $HOME use case.

### 17. `server.ts` shutdown handlers don't call `removeInstance`
**File:** `src/server.ts:381-393`

Existing SIGINT/SIGTERM handlers (`ptyManager.killAll(); process.exit(0)`) fire **before** the ones registered by `installSignalHandlers` (Node fires listeners in registration order). The pre-existing handler calls `process.exit(0)` which prevents the new handler's `removeInstance` from running. Only the `process.on('exit', unlinkSync)` cleanup will fire — which works, but it's `unlinkSync`-only (no proper-lockfile release), so the lockfile is left orphaned on disk.

**Fix:** Either register `installSignalHandlers` *first* (so it runs before the existing ones), or fold the `removeInstance` call into the existing SIGINT/SIGTERM handlers.

### 18. `cdpSocket: null` shape mismatch between `extension.ts` (legacy) and `ui-half.ts`
Both files duplicate large blocks of CDP/Chrome code. Maintenance hazard once #1 is fixed; pick one source of truth.

---

## Summary
- **Critical:** 2 (UI-half never wired up; command collision once it is).
- **Important:** 8 (port-write fallback, exit-unlink race, lock re-acquire error msg, readInstances stale-sweep race, localAddress-string crash, PID-reuse liveness, watcher-driven duplicate tunnels, whereami arg parsing x2).
- **Minor:** 5 (signal handler ordering, listener accumulation, lockfile perms, dead code, duplication).

The single most blocking bug is **#1**: with `activateUi` never invoked, the entire Wave-3 UI-half feature set is non-functional.
