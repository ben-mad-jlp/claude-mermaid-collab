# Design: One-Click Collab Launch

**Status:** Draft — 2026-05-15
**Background:** `research-one-click-collab-button` (this session)
**Builds on:** `design-multi-instance-discovery` (already shipped — PORT=0, instance-discovery, two-half extension)

## Goal

Replace today's "open terminal, cd to plugin source, set 3 env vars, run bun" friction with a single status-bar click that **just works** across all three production targets:

| # | UI host | Server host | Status |
|---|---------|-------------|--------|
| 1 | macOS   | macOS       | local |
| 2 | Windows | Windows     | local |
| 3 | macOS or Windows | Remote Linux (via Remote-SSH) | remote |

After the click the user has a healthy server, a known local URL, and a one-click "Open Collab UI" command.

## Non-goals

- Multi-server-per-workspace selection (one server per `(project, session)` for now)
- Auto-launch on workspace open (deferred — explicit click only)
- Replacing the existing CDP / Chrome-debug button (lives independently)

## Architecture

```
┌──────────────── UI host (Mac/Windows) ──────────────┐
│                                                      │
│  ui-half.ts                                          │
│  ├─ status bar item ($(plug) collab)                 │
│  ├─ command: mermaidCollab.toggleCollabServer        │
│  │     - if vscode.env.remoteName is set →           │
│  │         executeCommand('mermaidCollab.workspace   │
│  │           .startServer', {project, session})      │
│  │     - else → spawnLocal({project, session})       │
│  ├─ command: mermaidCollab.openUi (existing)         │
│  ├─ output channel "mermaid-collab Server"           │
│  ├─ FS watcher on local ~/.mermaid-collab/instances  │
│  │   (NEW — promoted from one-shot scan)             │
│  └─ openTunnel() on onInstanceUp (existing)          │
│                                                      │
│  Imports server-resolver.ts (shared)                 │
└──────────────────────────────────────────────────────┘
                       │  RPC (only when remote)
                       ▼
┌──────────────── Workspace host (Remote Linux) ──────┐
│                                                      │
│  workspace-half.ts                                   │
│  ├─ command: mermaidCollab.workspace.startServer     │
│  │     - resolves source via server-resolver         │
│  │     - spawns bun src/server.ts (PORT=0, env vars) │
│  │     - returns {pid, sessionId} synchronously      │
│  ├─ output channel "mermaid-collab Server (remote)"  │
│  ├─ FS watcher on remote ~/.mermaid-collab/instances │
│  │   (existing)                                      │
│  └─ stdio piped to remote output channel             │
│                                                      │
│  Imports server-resolver.ts (shared)                 │
└──────────────────────────────────────────────────────┘
```

The `server-resolver.ts` helper runs **inside whichever half is doing the spawn** — it inspects the host it's running on (not the remote one). Each half resolves source + bun for its own host.

## New components

### `extensions/vscode/src/server-resolver.ts` (new, shared)

```ts
export interface ServerSource {
  rootDir: string;       // path to the mermaid-collab source dir
  version: string;       // from package.json — used in version-skew warnings
  bunPath: string;       // resolved absolute path to bun binary
}

export async function resolveServerSource(): Promise<ServerSource>;
```

Resolution order (per host):
1. **`process.env.MERMAID_COLLAB_ROOT`** — explicit override (env var or workspace setting)
2. **`process.env.CLAUDE_PLUGIN_ROOT`** — set by Claude Code session-start hook; points at the active plugin install
3. **Glob fallback** — `~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/*/` → pick the highest semver

Throws a descriptive error if none resolve.

`bunPath` resolution:
1. `process.env.BUN_PATH` (escape hatch)
2. `which bun` / `where.exe bun` via `child_process.execSync`
3. **Mac/Linux fallback:** `~/.bun/bin/bun`
4. **Windows fallback:** `%USERPROFILE%\.bun\bin\bun.exe`

Throws "bun not found — install from https://bun.sh" if all fail. The error is shown in the toast + output channel.

### `extensions/vscode/src/spawn-server.ts` (new, shared)

```ts
export interface SpawnedServer {
  pid: number;
  sessionId: string;
  port: number;            // resolved after onInstanceUp fires
  child: ChildProcess;
  output: vscode.OutputChannel;  // for stdio piping
}

export async function spawnCollabServer(opts: {
  project: string;
  session: string;
  source: ServerSource;
  output: vscode.OutputChannel;
  signal?: AbortSignal;
}): Promise<{ pid: number; sessionId: string; child: ChildProcess }>;
```

Steps:
1. Compute `sessionId = sha1(project + '\0' + session).slice(0, 12)`
2. Pre-flight: read `~/.mermaid-collab/instances/<sessionId>.json` if present. If pid is alive (`process.kill(pid, 0)` succeeds) → throw `AlreadyRunning(pid, port)` so caller can route to "open existing UI" instead of respawning. If pid is dead → unlink, proceed.
3. Spawn: `child = child_process.spawn(source.bunPath, ['src/server.ts'], { cwd: source.rootDir, env: { ...process.env, PORT: '0', MERMAID_PROJECT: project, MERMAID_SESSION: session } })`
4. Pipe `child.stdout` and `child.stderr` line-by-line to `output.appendLine(...)`
5. Append a header with `version`, `pid`, `cwd`, `MERMAID_PROJECT`, `MERMAID_SESSION` so debugging is easy
6. Return `{ pid: child.pid!, sessionId, child }` — the caller waits for `onInstanceUp` matching `sessionId` (which carries the actual port) for the "ready" signal

Note: stdio piping is opt-in to the child being spawned with `stdio: ['ignore', 'pipe', 'pipe']`.

## Modified components

### `ui-half.ts`

- Add status bar item `$(plug) collab` (left of existing CDP item) with command `mermaidCollab.toggleCollabServer`
- Add output channel `"mermaid-collab Server"` (separate from existing CDP one)
- Register `mermaidCollab.toggleCollabServer`:
  ```ts
  if (vscode.env.remoteName) {
    return delegateToRemote();
  }
  return startLocal();
  ```
- `startLocal()`:
  1. `source = await resolveServerSource()`
  2. `output = getOrCreateOutputChannel(...)`
  3. `result = await spawnCollabServer({ project: workspaceFolder, session: sessionName, source, output })`
  4. Track `result.child` in module state (one per active sessionId)
  5. Update status bar to `$(loading~spin) collab: starting`
  6. Wait for `onInstanceUp` matching `sessionId` (existing handler runs)
  7. Update status bar to `$(check) collab: :NNNNN`
- `delegateToRemote()`:
  1. `result = await vscode.commands.executeCommand('mermaidCollab.workspace.startServer', { project, session })`
  2. Same status-bar lifecycle as local
  3. The workspace half handles the actual spawn — UI half only needs the returned `{pid, sessionId, version}` to wait for `onInstanceUp` and to detect version skew
- **Promote** the existing one-shot `readLocalInstances()` scan to a live `fs.watch(getDiscoveryPaths().instancesDir)` for the local case — without it, the click-then-`onInstanceUp` flow never fires because the FS watcher only existed in workspace-half. Reuse the `announceUp/announceDown` pattern from workspace-half.
- Click on a running server → `Open Collab UI` (open the cached `tunnel:<sessionId>` URL in browser). Click again with no Cmd modifier → no-op. Cmd+click (or context menu) → "Stop server".
- On extension deactivate: send SIGTERM to all tracked children; let proper-lockfile + signal handler clean up the discovery file.

### `workspace-half.ts`

- Add output channel `"mermaid-collab Server (remote)"` — VS Code Remote-SSH renders workspace-side output channels in the same UI panel
- Register `mermaidCollab.workspace.startServer({ project, session })`:
  - Same body as `startLocal` minus the openTunnel coordination
  - Returns `{ pid, sessionId, version }` so UI half can match + warn on skew
- Existing FS watcher continues to fire `onInstanceUp` to UI half over the built-in command-RPC channel — no new wiring

### `extensions/vscode/package.json`

Add commands:
- `mermaidCollab.toggleCollabServer` — title "mermaid-collab: Start / Stop Collab Server"
- `mermaidCollab.workspace.startServer` — title "mermaid-collab: (Workspace) Start Server" (internal — invoked via executeCommand)

Bump version (1.0.16 → 1.0.17 after this lands).

## Status bar UX

Single status bar item with 4 visible states:

| State | Text | Tooltip | Background |
|-------|------|---------|------------|
| Stopped | `$(plug) collab` | "Click to start collab server" | none |
| Starting | `$(loading~spin) collab` | "Starting server (resolving source, spawning bun)…" | none |
| Ready (local) | `$(check) collab :54321` | "Local server on :54321 — click to open UI, alt+click to stop" | none |
| Ready (remote) | `$(check) collab :54321 → remote` | "Tunnelled from remote :NNNN; remote version 5.69.10, local 5.69.10" | none |
| Failed | `$(error) collab` | "Failed: <reason> — click for details (opens output channel)" | warningBackground |
| Skew warning | `$(warning) collab :54321` | "UI version 5.69.10, remote version 5.68.16 — protocol may mismatch" | warningBackground |

## Lifecycle behavior

| Event | Behavior |
|-------|----------|
| Click (stopped) | Start flow above |
| Click (ready, no modifier) | Open Collab UI in browser |
| Cmd/Alt+click (ready) | Stop server (SIGTERM child, wait, update status bar) |
| Click (failed) | Reopen output channel; offer retry |
| VS Code reload | Send SIGTERM to tracked children; on next activation, scan discovery files and adopt any that survived |
| VS Code quit | SIGTERM children. On next launch, the existing instance file's PID won't be alive — `readInstances`/spawn pre-flight cleans up |
| Remote-SSH disconnect | UI-half tunnel breaks; remote server keeps running. On reconnect, workspace-half re-fires onInstanceUp; UI-half re-opens tunnel |
| Duplicate spawn (same project+session) | Pre-flight `AlreadyRunning(pid, port)` → caller skips spawn, opens UI for the existing one |

## Per-platform considerations

### macOS (UI host or Linux remote — same behavior)

- bun usually at `/opt/homebrew/bin/bun` or `~/.bun/bin/bun`. VS Code launched from Finder/Dock often has neither in `process.env.PATH` — `~/.bun/bin/bun` fallback is essential
- `process.kill(pid, 0)` works as expected
- SIGINT/SIGTERM handlers fire → `removeInstance` runs cleanly

### Windows (UI host)

- bun at `%USERPROFILE%\.bun\bin\bun.exe` (note `.exe`)
- Resolution: try `where.exe bun.exe` (or `bun`) first
- `process.kill(pid, 0)` **does** work on Windows for liveness check
- `subprocess.kill('SIGTERM')` is emulated — child is force-terminated without graceful cleanup. Means the server's own `installSignalHandlers` `removeInstance` does NOT run on Windows shutdown. Mitigation: stale-sweep on next read via the `process.kill(pid, 0)` probe in `readInstances` (already in place after Wave-3 fix).
- Lockfile: `proper-lockfile` is cross-platform but uses different mechanisms; the `process.kill(pid, 0)` orphan-detection in `readInstances` is the critical fallback (proper-lockfile's staleness window doesn't match our needs)

### Remote-SSH

- Workspace-half runs on the remote — uses Linux semantics for spawn, kill, lockfile
- Output channels registered on the workspace side render in the same VS Code Output panel via Remote-SSH's built-in extension-host RPC
- Tunnels open from UI-half via existing `openTunnel` flow — unchanged

## Version skew handling

Each host independently resolves its `mermaid-collab` source via `server-resolver`. The plugin cache on the remote can lag the cache on the local Mac (e.g. user updated the Mac plugin yesterday but the Linux box's cache is from a month ago). This causes silent protocol mismatches.

v1 mitigation: workspace-half returns its `version` in `startServer` response; UI half compares with its own `version` and shows a warning if they differ. Status bar gets the warning state.

v2 (future): proper version handshake (e.g. workspace half advertises capability flags, UI half degrades gracefully).

## Test plan (manual, since CI doesn't cover this)

1. **Local Mac.** Click → see status bar go starting → ready :NNNNN. Confirm `mermaid-collab whereami` lists the instance. Click again → opens browser. Cmd+click → server stops, status returns to stopped. Repeat with bun missing from PATH → toast + output channel error, status shows failed.

2. **Local Windows.** Same flow. Verify `bun.exe` resolution. Verify SIGTERM-equivalent kills the child cleanly. Reload window → confirm next launch doesn't see ghost PIDs.

3. **Remote-SSH.** Open a Linux remote workspace from Mac. Click → workspace half spawns server on remote, UI half opens tunnel. Verify `whereami` (local: nothing; remote via SSH: lists the instance). Verify Open Collab UI opens the local tunnel URL.

4. **Remote-SSH disconnect/reconnect.** Drop SSH, reconnect → tunnel re-establishes, status bar reflects.

5. **Multi-user, same remote.** Two Mac laptops, two SSH sessions to the same Linux box, both click. Each gets its own discovery file, port, tunnel.

6. **Same workspace twice (rare).** Open same remote workspace in two VS Code windows. Two clicks → second one detects `AlreadyRunning` → opens UI for the existing.

## Migration

This is additive. Existing `bun run dev` / `bun run start` flows continue to work unchanged. Users who don't click the new button see no behavior change.

If users have manually pinned `mermaidCollab.serverUrl` in workspace settings, the click flow will overwrite it (same as the existing `onInstanceUp` handler). Document this in `docs/multi-instance-setup.md`.

## Open questions / risks

1. **Version-skew handshake** — v1 just shows a warning. If the protocol diverges (e.g. WebSocket message shape changes), the warning is too late. Worth elevating to a hard error gate at some threshold (major version mismatch?).
2. **Multi-root workspaces** — `MERMAID_PROJECT` is the workspace root. With 3 roots, we pick the first. Acceptable? Or prompt?
3. **stderr noise** — server logs everything to stderr including prose URLs. Output channel will be busy. Consider filtering or a separate "verbose" channel.
4. **Remote-SSH `vscode.env.remoteName`** — confirmed truthy on UI side; the design relies on this. If a user opens a local + remote workspace simultaneously (unusual), the click flow may confuse the two. Defer.
5. **Stale `~/.bun/bin/bun` symlink** — on some macOS setups, `~/.bun` exists but the binary is broken. Pre-flight should `bun --version` and validate output, not just check file existence.

## Implementation phases

**Phase 1 — local Mac/Windows MVP (~half day):**
- `server-resolver.ts` + `spawn-server.ts`
- UI-half: button, command, status bar, output channel, watcher promotion
- Skip remote-half — Remote-SSH gracefully fails with "Remote-SSH not yet supported, click works on local workspaces"

**Phase 2 — Remote-SSH (~half day):**
- Workspace-half `startServer` command
- Version-skew warning
- End-to-end test on a real remote

Total: ~1 day for the first usable version that covers all three targets.
