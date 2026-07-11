# One-Click Collab Server Button — Research & Plan (v2: tri-target)

> Scope expanded: must work on **(1) local Mac**, **(2) local Windows**, **(3) Remote-SSH** (UI host = Mac or Windows; workspace = remote Linux). The earlier MVP only handled local Mac; this revision treats all three as first-class.

---

## TL;DR

- **Two-half architecture is mandatory, not a follow-up.** Spawn logic must live in *both* `ui-half.ts` (used for local Mac/Windows) and `workspace-half.ts` (used for Remote-SSH). The click handler in `ui-half.ts` dispatches by `vscode.env.remoteName`: if unset → spawn locally; if set → `executeCommand('mermaidCollab.workspace.startServer', …)` which transparently runs on the remote.
- **Source-resolution + bun-resolution are shared helpers** that must be portable across darwin/win32/linux. Each half imports the same module (`src/server-resolver.ts`). Glob `~/.claude/plugins/cache/<marketplace>/mermaid-collab/<semver>/` works identically on all three; `os.homedir()` returns the right thing everywhere.
- **Lifecycle on Windows is weaker.** `process.kill(pid, 0)` for liveness probing works (throws on dead pid). But `subprocess.kill('SIGTERM')` on Windows is a forced terminate — no graceful cleanup, so our server's `installSignalHandlers` will NOT run `removeInstance`. We must rely on stale-pid detection (`kill(pid, 0)` from the watcher) instead of trusting clean shutdown anywhere.
- **Output channels work cross-host for free.** A `vscode.OutputChannel` registered on the workspace-half (remote Linux) is RPC'd to the UI window automatically — same as commands. So Remote-SSH spawn logs surface in the user's local Output panel without us building a pipe.
- **Discovery + tunneling on Remote-SSH is already correct.** Workspace-half watcher fires `mermaidCollab.ui.onInstanceUp(inst)` over RPC; UI half opens a `vscode.workspace.openTunnel` to the remote port; existing code path. The only NEW work is the spawn command + dispatch.

---

## Architecture (all three flows)

```
LOCAL MAC / LOCAL WINDOWS  (single extension host; ui-half == workspace-half host)
====================================================================================
 [status bar click]
        │
        ▼
 ui-half: toggleCollabServer
   ├─ remoteName? NO → local path
   ├─ resolveServerRoot()   (env CLAUDE_PLUGIN_ROOT cache → setting → glob ~/.claude/plugins/cache/*/mermaid-collab/<semver>)
   ├─ resolveBun()          (setting → which/where → ~/.bun/bin/bun[.exe] → /opt/homebrew/bin/bun)
   ├─ checkExistingInstance(sessionId) using kill(pid,0)
   ├─ proper-lockfile around spawn (cross-process race guard)
   └─ child_process.spawn(bunPath, ['src/server.ts'], { cwd: root, env, windowsHide:true })
            stdio → OutputChannel('mermaid-collab Server')
            └─ server writes ~/.mermaid-collab/instances/<sid>.json
                  └─ UI-half watcher (NEW: promote watcher when no workspace-half active)
                       └─ openExternal(http://127.0.0.1:port)


REMOTE-SSH  (UI half on Mac/Win, workspace half on remote Linux)
====================================================================================
 [status bar click on local Mac/Win]
        │
        ▼
 ui-half: toggleCollabServer
   ├─ remoteName === 'ssh-remote' → REMOTE path
   └─ executeCommand('mermaidCollab.workspace.startServer', {project, session})
                                    │  (RPC across SSH; resolves on remote)
                                    ▼
        workspace-half on remote Linux:
          ├─ resolveServerRoot()       (remote $HOME, remote ~/.claude/plugins/cache)
          ├─ resolveBun()              (linux: which → ~/.bun/bin/bun)
          ├─ proper-lockfile (remote FS)
          ├─ spawn bun src/server.ts → OutputChannel (RPC'd back to UI window)
          └─ returns { pid, sessionId }
                                    │
                                    ▼ workspace-half watcher (already present) sees instance file
                                    │ fires mermaidCollab.ui.onInstanceUp(inst) via RPC
                                    ▼
        ui-half on Mac/Win:
          ├─ vscode.workspace.openTunnel({remoteAddress:{host:'127.0.0.1', port:N}})
          ├─ updates serverUrl config
          └─ openExternal(http://127.0.0.1:<localTunnelPort>)
```

---

## Per-target gap analysis

### Local Mac (baseline)

- Discovery dir: `/Users/<user>/.mermaid-collab/instances/`. Atomic rename on APFS works.
- Bun lives at `/Users/<user>/.bun/bin/bun` or `/opt/homebrew/bin/bun`. **GUI-launched VS Code has stripped PATH** — must probe absolute paths.
- Signals: SIGTERM honored; `installSignalHandlers` runs `removeInstance`.
- `process.kill(pid, 0)` works.
- **Failure mode if ignored:** none new vs prior plan.

### Local Windows

- Discovery dir: `C:\Users\<user>\.mermaid-collab\instances\`. NTFS atomic rename works for `fs.rename` if target doesn't exist; for overwrite we already use write-temp + rename which is fine on NTFS (single-volume). Watcher (`fs.watch`) fires correctly on Windows but coalesces — already handled with debounce in `workspace-half.ts`.
- **Bun path:** canonical `%USERPROFILE%\.bun\bin\bun.exe`. The winget installer **does NOT add to user PATH** ([bun#20868](https://github.com/oven-sh/bun/issues/20868)); the official PowerShell installer does. VS Code launched from Start menu inherits the *user* PATH at process start, so if PATH was just modified, a relogin is required. **Resolution chain on Windows:** setting → `where bun` → `%USERPROFILE%\.bun\bin\bun.exe` → `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Oven-sh.Bun_*\bun.exe`.
- **Spawn:** `child_process.spawn(bunPath, args)` with the absolute `.exe` works without `shell: true`. Do NOT use `shell: true` (avoids cmd.exe quoting headaches with paths containing spaces). For an unqualified `'bun'` lookup, `shell: true` would be needed — so we always resolve to absolute path first.
- **Signals:** [Node docs](https://nodejs.org/api/process.html) — Windows ignores POSIX signals; `subprocess.kill('SIGTERM')` is a forced terminate. **Our server's `installSignalHandlers` will NOT cleanly run on Windows shutdown.** Two consequences:
  1. `~/.mermaid-collab/instances/<sid>.json` will be left behind when VS Code closes. Stale-pid sweep on next click is mandatory (already implemented logic, must be exercised).
  2. The detached `start` subcommand's "Ctrl+C → graceful" assumption is moot. We never use it for the click flow anyway (we own the child).
- **`process.kill(pid, 0)`:** works on Windows ([Node process.kill docs](https://nodejs.org/api/process.html)) — throws if pid does not exist; otherwise no-op. Safe for liveness check.
- **proper-lockfile:** mkdir-based strategy, [cross-platform](https://www.npmjs.com/package/proper-lockfile). Works on Windows. Caveat: stale-lock cleanup on hard kill requires the staleness-mtime fallback (default 10s) — fine for our use.
- **Paths with spaces** (`C:\Users\Ben\My Project`): env vars round-trip JSON cleanly; the discovery file already JSON-encodes `project`. Spawn argv uses absolute bun path + script path — Node escapes args for the Windows CreateProcess invocation. Safe.
- **Failure modes if ignored:**
  - Bun not on PATH but installed → click fails silently with cryptic ENOENT. Mitigation: pre-flight resolution that probes user-profile path.
  - Stale instance files accumulating across reboots → "Duplicate instance" error on every click after a crash. Mitigation: liveness sweep before spawn (already in plan; must verify code path).

### Remote-SSH (UI on Mac/Win, workspace on remote Linux)

- **Dispatch signal:** `vscode.env.remoteName` returns `'ssh-remote'` in the UI extension host when a Remote-SSH workspace is open. (`extensionKind` is per-extension-instance; the UI half's instance is always `UI`. So checking `remoteName` is the right query *for "is there a remote workspace I should delegate to"*.) Confirmed correct.
- **Plugin source on remote:** the user must have run Claude Code on the remote at some point; otherwise `~/.claude/plugins/cache/*/mermaid-collab/*/` is empty. **Mitigations:**
  1. Pre-flight error: "No mermaid-collab plugin source found on remote. Install Claude Code on the remote and run any plugin command, OR set `mermaidCollab.serverPath`."
  2. Document that the workspace extension being installed remotely is necessary but NOT sufficient — the *plugin* (server source) is separate from the *VS Code extension* and must also be present.
- **Bun on remote:** standard `~/.bun/bin/bun`. Same resolver works; runs on the remote because workspace-half's `child_process` IS local-to-remote.
- **Output channel:** workspace-half registers `vscode.window.createOutputChannel('mermaid-collab Server')`. VS Code's extension-host RPC pipes the appended text to the UI window's Output panel automatically — no manual stream-forwarding code. Verified by docs ([remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)).
- **PID forwarding:** `executeCommand('mermaidCollab.workspace.startServer', …)` returns `{ pid, sessionId }` synchronously after spawn. UI half awaits `mermaidCollab.ui.onInstanceUp` matching `sessionId` (NOT pid — pid is a remote pid, meaningless to the UI host for any other purpose).
- **Disconnect/reconnect:** if SSH drops, the remote bun keeps running (orphan but writable to its discovery file). On reconnect, workspace-half re-activates and its file watcher initial-scan fires `onInstanceUp` for existing files — UI half re-establishes the tunnel. Verified by reading `workspace-half.ts` watcher pattern.
- **Multi-user same remote host:** each user has their own `$HOME` → discovery files isolated. PORT=0 → unique port per spawn. Independent, no collision.
- **Failure modes if ignored:**
  - Local-only spawn from UI half on Remote-SSH → spawns server on the *Mac/Win UI host* with no project context (and Linux-only assumptions in the server might hit). User sees a confusing "running" state but the workspace can't see it. Critical to dispatch correctly.
  - Output channel registered on UI half only → user sees no logs from remote spawn. We must register it on workspace half too.

---

## Cross-cutting invariants

1. **Same source-resolution code on every host.** Extract `resolveServerRoot(opts)` into `extensions/vscode/src/server-resolver.ts`. Both halves import. Pure: no vscode dep beyond `workspace.getConfiguration`.
2. **Same bun-resolution code on every host.** `resolveBun(): Promise<string>` in same module. Per-platform branch: darwin/linux probe `~/.bun/bin/bun`; win32 probe `%USERPROFILE%\.bun\bin\bun.exe` plus winget cache.
3. **Lifecycle truth source = stale-pid sweep, not signal handlers.** Don't trust `installSignalHandlers` to run on Windows or on SIGKILL anywhere. Every click pre-flight: read instance file, `kill(pid, 0)`, unlink if dead.
4. **Status bar text is identical across targets.** UI half owns the bar; reads state via the existing `onInstanceUp` event + a new `mermaidCollab.ui.onSpawnState` event the half emits to itself.

---

## Implementation plan (stages)

### Stage 1 — `server-resolver.ts` (cross-platform helper)

`extensions/vscode/src/server-resolver.ts`:
- `resolveServerRoot(): Promise<{root, source}>` — env `CLAUDE_PLUGIN_ROOT` (cache file `~/.mermaid-collab/plugin-root` populated by session-start hook) → `mermaidCollab.serverPath` setting → glob `path.join(os.homedir(), '.claude/plugins/cache')` → walk `<marketplace>/mermaid-collab/<semver>/`. Pick highest semver. Fail with structured error listing every candidate searched.
- `resolveBun(): Promise<string>` — `mermaidCollab.bunPath` → `which`/`where` via `execFile` → per-platform fallbacks. Cache result for the session.
- Both functions take no vscode imports beyond a narrow `getSetting(key)` injection so the same module is unit-testable on all three OSes.

### Stage 2 — Pre-flight on each platform

- `await resolveBun()`; if missing → status bar error, output-channel-log search list, toast with install link.
- `await resolveServerRoot()`; if missing → same treatment.
- Verify `bun --version` ≥ minimum (probe-once cache).
- On Windows, additionally normalize the resolved path to use forward slashes for argv (safer in some bun-internal path joins).

### Stage 3 — Spawn + lifecycle

**ui-half.ts (local Mac/Win):**
- New command `mermaidCollab.toggleCollabServer`.
- `proper-lockfile` lock on `~/.mermaid-collab/instances/<sid>.json.lock` (5s timeout) around the whole "check stale → spawn" block.
- `spawn(bunPath, ['src/server.ts'], { cwd: root, env, windowsHide: true, stdio: 'pipe' })`. NOT detached — we want to own the child for the window's lifetime.
- Pipe stdout/stderr → `OutputChannel('mermaid-collab Server')`.
- Promote the workspace-half watcher into UI-half when `vscode.env.remoteName` is unset (the existing watcher only runs when extension instance is `Workspace`; locally that instance doesn't exist for UI-only extension activation). Without this, `onInstanceUp` never fires locally — same bug as v1 plan.

**workspace-half.ts (Remote-SSH):**
- New command `mermaidCollab.workspace.startServer({project, session}) → {pid, sessionId}`.
- Same lock/spawn/stdio as ui-half.
- Returns `{pid, sessionId}` to caller. Existing watcher already fires `onInstanceUp`.

**extension.ts:**
- `deactivate()` must `child.kill()` the spawned server in whichever half started it (Windows: this is forced kill; Linux/Mac: SIGTERM with a 2s SIGKILL fallback timer).

### Stage 4 — Status bar + output channel

- Single status bar item in UI half. States: `idle`, `resolving`, `building-ui`, `starting`, `ready :PORT`, `error: <reason>`.
- Single OutputChannel name `mermaid-collab Server`. Created in *each* half independently (RPC handles the rest on Remote-SSH).
- Auto-`show()` the channel on `error` only.
- Auto-`openExternal(http://127.0.0.1:<port>)` once on first `ready` (gated by `mermaidCollab.openBrowserOnStart` setting, default true).

### Stage 5 — Stale / duplicate handling

- Pre-flight: read `~/.mermaid-collab/instances/<sid>.json`. If present:
  - `kill(pid, 0)` succeeds → existing instance alive → toast "Already running, opening UI" + `openExternal`. Return.
  - throws → stale → unlink, fall through to spawn.
- Lock prevents two clicks (or two windows on same project) from both reaching the spawn block.
- `onDidChangeWorkspaceFolders` → kill + reset state (do NOT auto-restart; require explicit click).

### Stage 6 — Graceful degradation

- Bun missing on host that's about to spawn (local OR remote depending on dispatch): error toast with platform-specific install hint and a "Set bun path…" button that opens settings.
- Plugin source missing: error toast linking to docs explaining `CLAUDE_PLUGIN_ROOT` / `mermaidCollab.serverPath`.
- Remote-SSH but workspace half not yet activated (e.g. fresh connection still loading): retry `executeCommand` up to 3× with backoff; if still failing, instruct user to wait for the remote extension host to finish loading.
- Tunnel API unavailable (older VS Code or Remote-SSH not installed): error with link to install Remote-SSH.

---

## Manual test plan

| # | Target | Setup | Steps | Expected |
|---|--------|-------|-------|----------|
| 1 | Local Mac | bun on PATH, plugin in cache, fresh `~/.mermaid-collab/instances/` | Click bar | Output channel shows server log, status → `ready :PORT`, browser opens. |
| 2 | Local Mac | bun NOT on PATH (rename ~/.bun/bin/bun) | Click bar | Status → `error: bun not found`, toast with install link. |
| 3 | Local Mac | Click twice rapidly | — | Second click sees alive instance, opens existing UI; no duplicate spawn. |
| 4 | Local Mac | Hard-kill server (`kill -9`), then click | — | Stale file unlinked, fresh spawn succeeds. |
| 5 | Local Mac | Two VS Code windows, same project | Click in both | Lock guarantees one spawn; second window opens existing. |
| 6 | Local Win | Default install, GUI launch | Click bar | Resolves `%USERPROFILE%\.bun\bin\bun.exe`; spawn succeeds; status → ready. |
| 7 | Local Win | Project path with spaces (`C:\Users\X\My Project`) | Click bar | Discovery file's `project` round-trips correctly; server starts. |
| 8 | Local Win | Close VS Code window via X (no clean shutdown signal) | Reopen, click | Stale instance detected via `kill(pid,0)`, replaced. |
| 9 | Remote-SSH (Mac→Linux) | Plugin cache present on remote | Click bar | RPC dispatches; remote bun spawns; tunnel opens; localhost browser works. |
| 10 | Remote-SSH | Plugin cache absent on remote | Click bar | Pre-flight error from workspace half, surfaces in UI Output panel + toast. |
| 11 | Remote-SSH | Drop SSH connection mid-session | Reconnect | Watcher re-scans, `onInstanceUp` re-fires, tunnel re-established without user click. |
| 12 | Remote-SSH (Win→Linux) | Two users SSH'd into same Linux host, both click | — | Per-user `$HOME` isolates state; two independent ports. |

CI coverage today: none of these are automated. Mac local is closest — could be scripted with a headless extension-test harness, but Win + Remote-SSH require infra we don't have. **Manual gating only for v1; document the matrix in the PR.**

---

## Open questions / risks

- **`vscode.workspace.openTunnel` is technically a proposed API** ([issue #100222](https://github.com/microsoft/vscode/issues/100222)). It IS shipped in stable for the Remote-SSH scenario but our extension manifest may need to declare an `enabledApiProposals` if we call it directly. Verify: does Remote-SSH's `localhost forwarding` happen automatically when the server binds to 0.0.0.0:N, or do we need explicit `openTunnel`? (Existing UI half code already calls it; presumably resolved.)
- **Windows graceful shutdown gap.** Even with stale-pid sweep, a Windows crash leaves the server's SQLite WAL files un-checkpointed. Not a click-button concern but worth flagging.
- **Plugin source version skew.** UI half resolves locally to 5.69.10; workspace half on remote resolves to 5.65.0 (older Claude Code on remote). Server protocol mismatch possible. Mitigation: surface resolved version + path in status bar tooltip and output channel header.
- **`CLAUDE_PLUGIN_ROOT` cache file** populated by session-start hook is per-host. On Remote-SSH the hook runs on the remote (where Claude Code runs) — so the cache file lands on the remote, which is where the workspace half needs it. Symmetric. ✓
- **`fs.watch` on Windows network shares** is unreliable. If the user has `~/.mermaid-collab/` on a roaming profile / OneDrive folder, watcher events may be missed. Document; recommend local-only.
- **Bun version floor.** Server requires bun ≥ 1.x for some APIs. Add to pre-flight; refuse to spawn on older.
- **proper-lockfile staleness window.** Default 10s mtime threshold means rapid-restart inside that window could hit a false-positive lock. Acceptable; not user-visible in normal click cadence.

---

## Files touched

- **NEW** `extensions/vscode/src/server-resolver.ts` — shared `resolveServerRoot` + `resolveBun`.
- `extensions/vscode/src/ui-half.ts` — status bar, local spawn path, dispatch to workspace command on Remote-SSH, watcher promotion when running locally.
- `extensions/vscode/src/workspace-half.ts` — `mermaidCollab.workspace.startServer` command, output channel, spawn.
- `extensions/vscode/src/extension.ts` — `deactivate()` cleanup of owned child.
- `extensions/vscode/package.json` — commands `mermaidCollab.toggleCollabServer`, `mermaidCollab.workspace.startServer`; settings `mermaidCollab.serverPath`, `mermaidCollab.bunPath`, `mermaidCollab.projectFolder`, `mermaidCollab.openBrowserOnStart`.
- `scripts/session-start-hook.sh` — write `~/.mermaid-collab/plugin-root` for deterministic resolution (and a `.bat` mirror for Windows-launched Claude Code).

No backend/server changes for v1.

---

## Sources

- [Bun installation docs](https://bun.com/docs/installation)
- [bun#20868 — winget doesn't add to PATH](https://github.com/oven-sh/bun/issues/20868)
- [Node.js process docs (signals on Windows)](https://nodejs.org/api/process.html)
- [proper-lockfile (npm)](https://www.npmjs.com/package/proper-lockfile)
- [VS Code Remote Extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)
- [VS Code Remote-SSH](https://code.visualstudio.com/docs/remote/ssh)
- [vscode#100222 — openTunnel API status](https://github.com/microsoft/vscode/issues/100222)
- [Bun child_process spawn reference](https://bun.com/reference/node/child_process/spawn)
