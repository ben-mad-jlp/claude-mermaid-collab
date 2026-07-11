# Design: Multi-Instance Collab Discovery

**Status:** Draft — 2026-05-15
**Supersedes ad-hoc port wiring in:** `extensions/vscode/src/extension.ts`, `src/config.ts`, `src/server.ts`
**Background research:** `research-multi-session-architecture` (this session)

## Goal

Let the user run any combination of:
1. One user, one machine, one collab session (today)
2. One user, multiple SSH-remote machines, one session each
3. Multiple users on the same SSH-remote machine, each with their own session
4. One user, one machine, multiple parallel sessions

…without port collisions, manual `localPort` bookkeeping, or `.vscode/settings.json` edits per checkout.

## Non-goals

- Cross-laptop session sharing (collab is still single-laptop per session)
- Replacing SSH with a custom transport — we keep VS Code Remote-SSH as the backbone
- A standalone tray app — everything stays inside the VS Code extension

## Architecture overview

```
┌──────────── Mac (UI side) ────────────┐         ┌──────── Remote box (workspace side) ────────┐
│                                        │         │                                              │
│  VS Code window                        │         │  collab server (Bun)                         │
│  ├─ extension (kind: ui)               │         │  ├─ binds 127.0.0.1:<PORT=0>                 │
│  │   - status bar                      │         │  ├─ writes ~/.mermaid-collab/instances/      │
│  │   - Chrome lifecycle / CDP          │         │  │     <session-id>.json (flock'd)           │
│  │   - openTunnel(port) → localPort    │         │  └─ removes file on shutdown                 │
│  │   - sets mermaidCollab.serverUrl    │         │                                              │
│  └─ extension (kind: workspace)        │  RPC    │  extension (workspace half) reads instances/ │
│      ↑ same npm package, branch on     │ ◄─────► │  watches for new files, posts {port,session} │
│        env.remoteName at activation    │         │  to UI half                                  │
│                                        │         │                                              │
│  Chrome --remote-debugging-port=<dyn>  │         │                                              │
└────────────────────────────────────────┘         └──────────────────────────────────────────────┘
```

Single npm package, `extensionKind: ["ui", "workspace"]`. VS Code instantiates it on **both sides** when the workspace is remote. The two halves talk through built-in extension RPC (`vscode.commands.executeCommand` or shared exports).

## Server changes

### `src/config.ts`

```ts
const RAW_PORT = process.env.PORT ?? '9002';
export const PORT_REQUEST = RAW_PORT === '0' ? 0 : parseInt(RAW_PORT, 10);
```

Default stays `9002` for backwards compatibility. New behavior is opt-in via `PORT=0`.

### `src/server.ts`

After `Bun.serve()` returns, we know the actual bound port. Write the discovery file then:

```ts
const actualPort = server.port;
await writeInstanceFile({ port: actualPort, project, session, pid: process.pid });
```

### Discovery file layout

```
~/.mermaid-collab/
  instances/
    <session-id>.json        ← {port, project, session, pid, startedAt, version}
    <session-id>.json.lock   ← flock'd while server alive
  sock/                      ← reserved for future UDS option (case 5: paranoid isolation)
```

Where:

```ts
const sessionId = sha1(project + '\0' + session).slice(0, 12);
```

Properties:
- **Per-user isolation:** `$HOME` scoping, no cross-user reads.
- **Per-session isolation:** session-id derived from `(project, session)` so case 4 doesn't clobber.
- **Liveness:** the `.lock` is held by `flock(LOCK_EX | LOCK_NB)` from server startup until process exit. A reader that can `flock(LOCK_SH | LOCK_NB)` knows the writer is gone — stale entries get garbage-collected by the next read.
- **Atomic writes:** write to `<id>.json.tmp`, fsync, rename.

### Shutdown hook

```ts
process.on('exit', () => {
  unlinkSync(instancePath);
  unlinkSync(lockPath);
});
process.on('SIGTERM', cleanShutdown);
process.on('SIGINT', cleanShutdown);
```

Plus the lock-file fallback for crash cases.

### Optional: `mermaid-collab whereami` CLI

A small subcommand that prints the active instance.json for the current shell's `$PROJECT/$SESSION` (or all of them with `--all`). Used by:
- The workspace-side extension as a fallback if file watching is unavailable
- Humans debugging tunnels

## Extension changes

### `extensions/vscode/package.json`

```json
{
  "extensionKind": ["ui", "workspace"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js"
}
```

Single entry point. The runtime side is decided by VS Code, not by us.

### `extensions/vscode/src/extension.ts`

```ts
import * as vscode from 'vscode';

export function activate(ctx: vscode.ExtensionContext) {
  const isRemote = !!vscode.env.remoteName;
  const isUiHalf = !isRemote || /* heuristic for ui-side */ vscode.env.uiKind === vscode.UIKind.Desktop;

  if (isRemoteWorkspaceHalf()) {
    return activateWorkspace(ctx);   // file watch, RPC announce
  }
  return activateUi(ctx);            // status bar, Chrome, openTunnel
}
```

Branching uses `vscode.env.remoteName` and `extensionKind` resolution (see open question below).

### Workspace half — what it does

```ts
async function activateWorkspace(ctx: vscode.ExtensionContext) {
  const dir = path.join(os.homedir(), '.mermaid-collab', 'instances');
  await fs.mkdir(dir, { recursive: true });

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(dir), '*.json')
  );

  watcher.onDidCreate(uri => announce(uri));
  watcher.onDidChange(uri => announce(uri));
  watcher.onDidDelete(uri => retract(uri));

  // Initial scan
  for (const f of await fs.readdir(dir)) {
    if (f.endsWith('.json')) announce(vscode.Uri.file(path.join(dir, f)));
  }

  // Expose a command the UI half can call directly
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.workspace.listInstances', async () => {
      // returns Instance[]
    })
  );
}
```

`announce()` reads the JSON, validates liveness (lock is held by another process — so we can't `LOCK_EX` it), then either:
- Calls a UI-half command via `vscode.commands.executeCommand('mermaidCollab.ui.onInstanceUp', instance)`, or
- Writes to a shared exports object the UI half polls

(See open question on RPC mechanism.)

### UI half — what changes

```ts
async function activateUi(ctx: vscode.ExtensionContext) {
  registerStatusBar(ctx);
  registerChromeLifecycle(ctx);

  // New: react to instances announced by the workspace half
  ctx.subscriptions.push(
    vscode.commands.registerCommand('mermaidCollab.ui.onInstanceUp', async (inst: Instance) => {
      const tunnel = await vscode.workspace.openTunnel({
        remoteAddress: { host: '127.0.0.1', port: inst.port },
        label: `collab:${inst.session}`,
      });
      // tunnel.localAddress is { host, port }
      const url = `ws://${tunnel.localAddress.host}:${tunnel.localAddress.port}/ws`;
      await vscode.workspace.getConfiguration('mermaidCollab').update('serverUrl', url, vscode.ConfigurationTarget.Workspace);
    })
  );
}
```

`vscode.workspace.openTunnel()` is the supported API for programmatic port forwarding from the UI side. It returns a `Tunnel` whose `localAddress` is the Mac-side port we should connect to. Multiple `openTunnel` calls give independent local ports — no collisions.

### Local-only path (case 1)

If `!isRemote`, the UI half *also* does the discovery work itself (read `~/.mermaid-collab/instances/`) and skips `openTunnel`. The connection URL is just `ws://127.0.0.1:<discovered>/ws`.

## Settings & config

| Setting | Old | New |
|---|---|---|
| `mermaidCollab.serverUrl` | `ws://127.0.0.1:9002/ws` (default) | Auto-set on instance announce; manual override still respected |
| `mermaidCollab.preferredLocalPort` | (none) | Optional — if set, passed as `localAddressPort` hint to openTunnel |
| `mermaidCollab.discoveryDir` | (none) | Override `~/.mermaid-collab/instances/` for tests |

Backwards compat: if no instance file exists and no env override, fall through to the old `9002` default so the existing single-user single-session flow keeps working without any user action.

## RPC between the two halves

VS Code does not have a first-class "talk to the other half of yourself" API. Two real options:

**Option α — `vscode.commands.executeCommand`**
- Workspace half registers `mermaidCollab.workspace.*` commands, UI half registers `mermaidCollab.ui.*` commands.
- Each side calls the other's command. Works across the remote-extension-host boundary because commands are part of the JSON-RPC channel VS Code maintains.
- Limitation: command results must be JSON-serializable. That's fine here.

**Option β — `vscode.extensions.getExtension(id).exports`**
- Both halves are the same extension id, but VS Code surfaces them as separate `Extension` objects (one per host). The UI half asks for the workspace-side extension and gets its `exports` proxy.
- This is what extensions like the official Git extension do.

We'll use **α** because it's simpler and well-documented for cross-host calls. Drop down to β only if we need event-style streaming.

## Open questions

1. **Detecting which half you are at activation time.** The cleanest signal is `vscode.env.remoteName` (truthy on the workspace side, undefined on the UI side). But for `extensionKind: ["ui", "workspace"]`, *both* halves activate, and `remoteName` is set on both — verify. Backup: check `process.platform` against the workspace's `vscode.env.appHost`. Worst case, `package.json` declares two entry points (`browser`, `main`) and we use a tiny boot file that re-exports the right activator.

2. **`openTunnel` lifetime.** The `Tunnel` object must be retained or it's torn down. Track them in `ctx.subscriptions` so they get disposed on extension deactivation.

3. **Lock-file race on first read.** If the UI half's openTunnel call races the server's startup announcement, the file might not exist yet. Mitigation: `mermaid-collab` server should `fsync` and only then notify; the workspace half waits on `onDidCreate`. The UI half should never read the file directly — it's only triggered by a workspace-half RPC.

4. **Multiple Mac VS Code windows hitting the same remote.** Two windows open over Remote-SSH to box-X each get their own Remote-SSH tunnel and their own remote extension host. So each window's workspace half independently watches `~/.mermaid-collab/instances/` — no coordination needed. Confirm by reading VS Code Remote-SSH docs on extension-host multiplicity.

5. **Cleanup of orphaned instance files.** If a server SIGKILLs, the file lingers. The lock-based liveness check handles this for *readers*, but the file accumulates. Add a `mermaid-collab gc` subcommand and call it from `mermaid-collab start`.

6. **Versioning the discovery file.** Add `"version": 1` to the JSON so future schema changes are detectable.

## Migration plan

1. Land server-side `PORT=0` + discovery file + lock + cleanup (no behavior change at default).
2. Add `whereami` and `gc` CLI subcommands.
3. Land extension `extensionKind: ["ui", "workspace"]` + activation branching with no behavior change yet (workspace half is a no-op).
4. Implement workspace-half watcher + UI-half `onInstanceUp` command + `openTunnel`.
5. Switch the default for new sessions to `PORT=0`. Document the `9002` fallback for the local-only legacy path.
6. Once stable, remove the SSH-tunnel + Windows-Chrome legacy code paths from the extension (they're for a use case we no longer have).

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| `openTunnel` API surface changes | Med | Pin to a tested VS Code engine version; smoke-test on stable + insiders |
| `extensionKind: ["ui","workspace"]` activates both halves on a local workspace | Low | The workspace half no-ops cleanly when its watch dir is empty |
| Cross-user `~/.mermaid-collab` collision via shared `$HOME` | Very Low | Already per-user via `$HOME` |
| Lock semantics on macOS vs Linux | Low | Use `proper-lockfile` (npm) which abstracts this |
| Two halves race on extension deactivation | Med | Both halves register cleanup in `ctx.subscriptions`; server-side instance-file is removed by the server itself, not by the extension |

## Test plan

- **Unit:** instance-file write/read/lock; sessionId derivation
- **Integration on one Mac:** start two collab servers locally with `PORT=0`, confirm both discoverable, confirm UI half opens tunnels for each
- **Integration with Remote-SSH:** start servers on two remote boxes, open both in VS Code on the Mac, confirm independent tunnels
- **Integration multi-user:** two test users on the same remote box, each runs `bun start` with `PORT=0`, confirm independent instance files and independent tunnels back to two Macs
- **Crash recovery:** SIGKILL a server, confirm next `whereami --all` skips the dead entry and `gc` removes it
