# Multi-Instance Setup Guide

This guide explains how to run multiple `mermaid-collab` servers concurrently — across hosts, users, or sessions — and how the VS Code extension auto-discovers and tunnels each one.

## Overview

As of Wave 1–3, multiple `mermaid-collab` servers can run side-by-side on the same machine, on a shared multi-user remote, or across hosts reached over Remote-SSH. Each server publishes a small JSON record to a per-session discovery file at `~/.mermaid-collab/instances/<sha1[:12]>.json`, and the VS Code extension watches that directory to auto-tunnel and rewire `mermaidCollab.serverUrl`. The `mermaidCollab.serverUrl` workspace setting is now **auto-managed** — you should not need to edit it by hand for normal multi-instance use.

## Background: The Port Collision Problem

Previously every `mermaid-collab` server bound a fixed `PORT` (default `9002`). Starting a second instance on the same host — or running the server on a multi-user remote where two users wanted their own instance — failed with `EADDRINUSE`. The fixed-port model also made VS Code Remote-SSH brittle: only one tunnel could exist on the well-known port at a time.

The new discovery layer fixes both issues. Servers can request `PORT=0` to get an OS-assigned free port, and the actual address (port + sessionId + project + pid) is published to a per-session discovery file under `~/.mermaid-collab/instances/`. Consumers read those files to find live servers instead of guessing a port.

## Quick Start (Single User, Single Machine)

Start a server with an OS-assigned free port:

```bash
PORT=0 bun src/server.ts
```

In another terminal, list discovered instances:

```bash
mermaid-collab whereami
```

You'll get a JSON array of `Instance` records:

```json
[
  {
    "version": 1,
    "sessionId": "a1b2c3d4e5f6",
    "port": 54231,
    "project": "/Users/you/Code/my-project",
    "session": "scratch",
    "pid": 12345,
    "startedAt": "2026-05-15T10:23:01.123Z",
    "serverVersion": "5.69.10"
  }
]
```

The legacy `PORT=9002` (default) flow still works unchanged for the simple, single-instance case — the server publishes to discovery either way.

## Multi-Instance on One Machine

Each instance is keyed by a `sessionId` derived from `(project, session)`:

- `MERMAID_PROJECT` — defaults to `process.cwd()` at server start
- `MERMAID_SESSION` — defaults to `"scratch"`

`deriveSessionId(project, session)` produces a 12-character sha1 hex digest, which becomes the discovery filename: `~/.mermaid-collab/instances/<sessionId>.json`.

Distinct `(project, session)` pairs coexist freely. Identical pairs collide and the second start fails with:

```
Duplicate instance for sessionId <sessionId>
```

(emitted via `proper-lockfile` when the discovery file is already locked).

Example — two instances, same project, different sessions:

```bash
# Terminal A
cd ~/Code/my-project
PORT=0 MERMAID_SESSION=feature-x bun src/server.ts

# Terminal B
cd ~/Code/my-project
PORT=0 MERMAID_SESSION=feature-y bun src/server.ts

# Terminal C
mermaid-collab whereami
# → two records, two different ports, two different sessionIds
```

## Multi-Machine via VS Code Remote-SSH

The VS Code extension is a **split extension** (`extensionKind: ["ui", "workspace"]`):

- **Workspace half** (`extensions/vscode/src/workspace-half.ts`) runs on the remote. It watches `~/.mermaid-collab/instances/` with a filesystem watcher, plus a 30-second polling fallback for NFS-homed `$HOME` where FS events may not fire reliably. It dispatches `mermaidCollab.ui.onInstanceUp` and `mermaidCollab.ui.onInstanceDown` messages to the UI half.
- **UI half** runs locally. On `onInstanceUp` it calls `vscode.workspace.openTunnel({ remoteAddress, localAddressPort })`, persists the chosen local port in `globalState['tunnel:<sessionId>']` so the same local port is reused across reconnects, and writes `ws://127.0.0.1:<localPort>/ws` into the workspace `mermaidCollab.serverUrl` setting.

The `mermaidCollab.openUi` command opens the local tunnel URL in your browser — you don't address the remote port directly.

## Multi-User on a Shared Remote

This works automatically with **no coordination required**. Each Linux user has their own `$HOME`, so `~/.mermaid-collab/instances/` is naturally isolated per user. Two users can run `PORT=0 bun src/server.ts` on the same box at the same time and never see each other's instances. The lockfile-based duplicate check is per-host but only meaningful within one `$HOME`.

## `mermaid-collab whereami` Reference

```
mermaid-collab whereami [--all] [--project <path>] [--session <name>]
```

- Output: JSON array of `Instance` records on **stdout**.
- Errors: written to **stderr** with non-zero exit.
- Stale records (whose owning PID is no longer alive) are garbage-collected on read via `proper-lockfile` lock acquisition — no daemon needed.
- Without flags: returns instances matching the current `cwd` and default session.
- `--all`: returns every instance under `~/.mermaid-collab/instances/`.
- `--project` / `--session`: filter on the recorded values.

## Migration Note: `serverUrl` Is Now Auto-Managed

In multi-instance mode the VS Code extension **overwrites** `mermaidCollab.serverUrl` whenever an instance comes up. If you have a custom URL — for example, you're pointing at a remote dev server you manage manually — pin it in **user-level** settings (`~/.config/Code/User/settings.json`), not workspace settings.

Workspace-level values in `.vscode/settings.json` **will be replaced** when a discovered instance comes up. This is intentional: workspace-scope is the right place for the auto-managed local tunnel URL.

## Tailscale (Recommended for Cross-Machine)

For cross-machine setups outside the VS Code Remote-SSH flow, [Tailscale](https://tailscale.com/) is the recommended path. Install it on both ends and reach the remote server directly over the tailnet using its MagicDNS name. The server currently binds to `HOST` (default `0.0.0.0`); a future enhancement may pin to a specific interface (e.g. `tailscale0`) for tighter exposure control.

## Troubleshooting

### `whereami` returns `[]`

The server didn't write its discovery record. Check the server's stderr for a write error, and confirm `MERMAID_PROJECT` and `MERMAID_SESSION` are what you expect (defaults are `process.cwd()` and `"scratch"`).

### `Duplicate instance for sessionId ...`

Another `mermaid-collab` is already running with the same `(project, session)` pair. Either stop the existing one or change `MERMAID_SESSION` for the new one.

### Remote-SSH tunnel doesn't open

Open the VS Code "mermaid-collab CDP" output channel and look for `[tunnel]` errors. Verify `~/.mermaid-collab/instances/` exists on the remote and contains the expected record. The workspace half logs each watcher event there.

### NFS-homed `$HOME`

FS watcher events sometimes don't fire on NFS mounts. The 30-second poll fallback in `workspace-half.ts` will pick up new and removed instances within at most ~30s — it's slower than native FS events but reliable.

## One-Click Launch (VS Code status bar)

For the common single-user case you don't have to touch a terminal at all. The mermaid-collab VS Code extension (≥ 1.0.17) contributes a `$(plug) collab` item to the status bar. Click it to start a collab server scoped to the current workspace — no terminal, no environment variables to set.

### Status bar states

The item reflects the server lifecycle:

- **stopped** — `$(plug) collab`. Click to launch.
- **starting** — `$(loading~spin)` while the server boots.
- **ready** — `$(check) collab :PORT`. Click again to open the UI in your browser.
- **version-skew warning** — `$(warning)`. The local and resolved server/extension versions differ but the server is still usable (see below).
- **failed** — `$(error)`. Click to open the "mermaid-collab Server" output channel and read the underlying error.

### What happens under the hood

- **Local (macOS / Windows):** the extension resolves the plugin source plus a `bun` binary, then spawns `bun src/server.ts` with `PORT=0` and the workspace path as `MERMAID_PROJECT`. It watches `~/.mermaid-collab/instances/` for the new record and sets `mermaidCollab.serverUrl` automatically once the server is up.
- **Remote-SSH:** the click is delegated to the workspace half, which spawns the server on the remote. The UI half then opens an SSH tunnel and rewrites `serverUrl` to the local tunnel address. Remote server output lands in the "mermaid-collab Server (remote)" channel.

### Resolution order

**Plugin source** is resolved in this order:

1. `MERMAID_COLLAB_ROOT` environment variable
2. `CLAUDE_PLUGIN_ROOT` environment variable
3. The highest-semver directory under `~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/`

**Bun binary** is resolved in this order:

1. `BUN_PATH` environment variable
2. `which bun` (or `where.exe bun` on Windows)
3. `~/.bun/bin/bun` (macOS/Linux) or `%USERPROFILE%\.bun\bin\bun.exe` (Windows)

If `bun` can't be found, you get a clear error pointing to https://bun.sh.

### Already-running detection

Clicking when a healthy server already owns this workspace's `(project, session)` pair simply opens the existing UI instead of erroring — so it's safe to click twice.

### Stopping the server

Run the `mermaid-collab: Stop Collab Server` command from the command palette. The server is also SIGTERM'd automatically when the extension deactivates.

### Per-platform notes

On Windows the child process is force-terminated rather than asked to gracefully `removeInstance` itself, so a stale instance file may briefly linger. The next `whereami` or launch sweeps it via the dead-pid probe. This is expected and harmless.

### Version skew

If the local extension version and the resolved server version differ — common under Remote-SSH where the remote's plugin cache lags behind your local install — the status bar shows the warning state. The server still works for any matching protocol; update both sides if you run into issues.

## Limitations / Future Work

- **UDS (Unix domain socket) isolation** is not yet implemented. Today the server binds TCP loopback or `0.0.0.0`.
- **No interface pinning** — e.g., binding only to `tailscale0` is not yet supported.
- **Lockfile-based duplicate detection is per-host.** Cross-host duplicates are not actually possible since each host's `$HOME` (and therefore `~/.mermaid-collab/instances/`) differs, so this isn't a practical limitation — just a note on the model.

## See Also

- [MCP_SETUP.md](MCP_SETUP.md) — Configuring Claude Code's MCP integration
- [BUILD.md](BUILD.md) — Building the server and VS Code extension
- [README.md](../README.md) — Main project documentation
