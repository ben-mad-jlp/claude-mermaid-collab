# Blueprint: Multi-Instance Collab Discovery

## Source Artifacts

- `design-multi-instance-discovery` — design doc (architecture, file layout, RPC choice)
- `research-multi-session-architecture` — full option analysis (REVISED + multi-user extension); confirms R2 is the primary path

## 1. Structure Summary

### Files

**New:**
- [ ] `src/services/instance-discovery.ts` — instance-file write/read/sweep, session-id derivation, lock semantics
- [ ] `src/services/__tests__/instance-discovery.test.ts` — unit tests
- [ ] `bin/whereami.ts` — `mermaid-collab whereami` CLI subcommand (lists live instances)

**Modified:**
- [ ] `src/config.ts` — accept `PORT=0`, expose `PORT_REQUEST` (number, may be 0)
- [ ] `src/server.ts` — capture actual bound port, call `writeInstance(...)` after `Bun.serve`, register signal handlers to delete instance file on shutdown
- [ ] `bin/mermaid-collab.ts` (or wherever the existing CLI lives) — wire `whereami` subcommand
- [ ] `extensions/vscode/package.json` — `extensionKind: ["ui", "workspace"]`, bump version, add `engines.vscode` to `^1.85.0` (for stable `openTunnel`)
- [ ] `extensions/vscode/src/extension.ts` — split into UI-half (status bar + Chrome + openTunnel + Open Collab UI command) and workspace-half (file watcher + RPC announce); branch on `vscode.env.remoteName` + `vscode.env.uiKind`
- [ ] `extensions/vscode/src/ui-half.ts` (NEW) — UI activation logic
- [ ] `extensions/vscode/src/workspace-half.ts` (NEW) — workspace activation logic
- [ ] `package.json` (root) — bump version, add `proper-lockfile` (for cross-platform `flock`)

### Type Definitions

```ts
// src/services/instance-discovery.ts

export interface Instance {
  version: 1;                 // schema version
  sessionId: string;          // sha1(project + '\0' + session)[:12]
  port: number;               // actual bound TCP port
  project: string;            // absolute project path
  session: string;            // session name (from MERMAID_SESSION env or scratch)
  pid: number;
  startedAt: string;          // ISO8601
  serverVersion: string;      // from package.json
}

export interface DiscoveryPaths {
  root: string;               // ~/.mermaid-collab
  instancesDir: string;       // ~/.mermaid-collab/instances
  instanceFile(id: string): string;
  lockFile(id: string): string;
}
```

```ts
// extensions/vscode/src/types.ts

export interface InstanceAnnouncement {
  sessionId: string;
  port: number;
  project: string;
  session: string;
}
```

### Component Interactions

```
┌─ Mac (UI half) ──────────────────┐    ┌─ Remote (workspace half) ────────┐
│ activateUi()                     │    │ activateWorkspace()              │
│  - status bar / Chrome (today)   │    │  - createFileSystemWatcher       │
│  - cmd: mermaidCollab.ui         │    │      ~/.mermaid-collab/instances │
│        .onInstanceUp(inst)       │ ◄──│  - on create: read JSON,         │
│      → openTunnel()              │RPC │       executeCommand UI side     │
│      → set serverUrl             │    │  - cmd: mermaidCollab.workspace  │
│      → cache local port          │    │       .listInstances()           │
│  - cmd: mermaidCollab.openUi     │    │                                  │
│      → opens http://localhost:M  │    │ src/server.ts                    │
└──────────────────────────────────┘    │  on listen: writeInstance()      │
                                        │  on SIGTERM: removeInstance()    │
                                        │                                  │
                                        │ bin/whereami.ts                  │
                                        │   reads ~/.mermaid-collab/       │
                                        │     instances/, prints JSON      │
                                        └──────────────────────────────────┘
```

---

## 2. Function Blueprints

### `src/services/instance-discovery.ts`

#### `getDiscoveryPaths(home = os.homedir()): DiscoveryPaths`

Returns the standard paths (`~/.mermaid-collab/instances/<id>.json` etc.).
Pure function. No FS side effects.

#### `deriveSessionId(project: string, session: string): string`

```
return crypto.createHash('sha1')
              .update(project + '\0' + session)
              .digest('hex')
              .slice(0, 12);
```

Edge cases: empty `session` → still hashable; very long project paths → still 12 chars.

#### `async writeInstance(inst: Instance, paths = getDiscoveryPaths()): Promise<void>`

1. `mkdir -p paths.instancesDir`
2. Write `paths.instanceFile(inst.sessionId) + '.tmp'` with `JSON.stringify(inst, null, 2)`
3. `fsync` the tmp file
4. `rename` tmp → final (atomic on POSIX)
5. Acquire `flock(LOCK_EX | LOCK_NB)` on `paths.lockFile(inst.sessionId)` and **retain the file descriptor for the lifetime of the process** (store in module-level Map keyed by sessionId so `removeInstance` can release).

Error: throws if lock is already held by another process (means a duplicate `(project, session)` pair is already running — bail).

Test strategy: temp dir, two writes with different ids both succeed; same id collides on lock.

#### `async removeInstance(sessionId: string, paths = getDiscoveryPaths()): Promise<void>`

1. Release flock fd if held
2. `unlink` lock file (best effort)
3. `unlink` instance file (best effort)

Idempotent — never throws.

#### `async readInstances(paths = getDiscoveryPaths()): Promise<Instance[]>`

1. `readdir paths.instancesDir`
2. For each `*.json`:
   - Try `flock(LOCK_EX | LOCK_NB)` on the matching `.lock`. If acquired → previous owner is dead → `unlink` both files and skip. Release immediately.
   - Else (lock held) → parse JSON; on parse failure or missing fields, skip; on success push.
3. Return array (live entries only).

Error handling: per-file try/catch; one bad file doesn't poison the list.

Test strategy: write live entry (lock held), write stale entry (lock free) → readInstances returns only live; stale files are unlinked.

#### `async findInstance(project: string, session?: string, paths?: DiscoveryPaths): Promise<Instance | null>`

If `session` provided → filter by exact match. Otherwise filter by `project` only and return first (with a debug log if >1).

#### `installSignalHandlers(sessionId: string): void`

Registers `SIGINT`, `SIGTERM`, `process.on('exit', ...)` to call `removeInstance(sessionId)` synchronously where possible. Idempotent.

---

### `bin/whereami.ts`

```
#!/usr/bin/env bun
const { all, project, session } = parseArgs(Bun.argv);
const instances = await readInstances();
const filtered = all
  ? instances
  : instances.filter(i =>
      (!project || i.project === project) &&
      (!session || i.session === session));
process.stdout.write(JSON.stringify(filtered, null, 2));
```

Exit 0 even if empty array. Exit 1 only on hard errors.

Tests: covered by `instance-discovery.test.ts` (the CLI is a thin wrapper).

---

### `src/config.ts` (modified)

#### `PORT_REQUEST` (new export)

```
const RAW = process.env.PORT ?? '9002';
export const PORT_REQUEST = RAW === '0' ? 0 : Number.parseInt(RAW, 10);
```

Keep existing `PORT` export for backwards compat (returns `PORT_REQUEST` when not 0, else throws — callers that read it after server start should use the *actual* bound port from `server.port`).

#### `MERMAID_PROJECT` / `MERMAID_SESSION` (new env reads)

`process.env.MERMAID_PROJECT ?? process.cwd()`, `process.env.MERMAID_SESSION ?? 'scratch'`. Used to populate the discovery file when no explicit `--project`/`--session` flag was passed.

---

### `src/server.ts` (modified)

After `const server = Bun.serve({...port: PORT_REQUEST...})`:

```ts
const actualPort = server.port;
const sessionId = deriveSessionId(MERMAID_PROJECT, MERMAID_SESSION);
await writeInstance({
  version: 1,
  sessionId,
  port: actualPort,
  project: MERMAID_PROJECT,
  session: MERMAID_SESSION,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  serverVersion: SERVER_VERSION,
});
installSignalHandlers(sessionId);
console.log(`mermaid-collab listening on :${actualPort}, advertised as ${sessionId}`);
```

Edge case: if `writeInstance` throws (lock collision), log + exit non-zero — duplicate process detection.

Test strategy: integration test starts server with `PORT=0`, asserts a file appears under `~/.mermaid-collab/instances/`, then sends SIGTERM, asserts file is gone within 500ms.

---

### `extensions/vscode/src/extension.ts` (rewritten)

```ts
import { activateUi } from './ui-half';
import { activateWorkspace } from './workspace-half';

export function activate(ctx: vscode.ExtensionContext) {
  // remoteName is set when this extension instance is running on the
  // remote (workspace half). Undefined on the Mac (UI half).
  if (vscode.env.remoteName) {
    return activateWorkspace(ctx);
  }
  return activateUi(ctx);
}

export function deactivate() {
  // each half manages its own subscriptions; nothing to do here
}
```

Edge case: when there's no remote workspace at all, only `activateUi` runs (the workspace half is never instantiated). This matches today's behavior for local-only users.

---

### `extensions/vscode/src/ui-half.ts` (new)

#### `activateUi(ctx)`

1. Register existing UI commands (status bar, Chrome lifecycle — kept as-is from today's `extension.ts`)
2. Register `mermaidCollab.ui.onInstanceUp` command:
   ```ts
   vscode.commands.registerCommand('mermaidCollab.ui.onInstanceUp', async (inst: InstanceAnnouncement) => {
     const desiredLocal = ctx.globalState.get<number>(`tunnel:${inst.sessionId}`);
     const tunnel = await vscode.workspace.openTunnel({
       remoteAddress: { host: '127.0.0.1', port: inst.port },
       localAddressPort: desiredLocal,
       label: `collab:${inst.session}`,
     });
     ctx.subscriptions.push(tunnel);
     const localPort = (tunnel.localAddress as any).port;
     await ctx.globalState.update(`tunnel:${inst.sessionId}`, localPort);
     await vscode.workspace.getConfiguration('mermaidCollab')
       .update('serverUrl', `ws://127.0.0.1:${localPort}/ws`,
               vscode.ConfigurationTarget.Workspace);
   });
   ```
3. Register `mermaidCollab.openUi` command — opens `vscode.env.openExternal(http://127.0.0.1:${localPort})` from the most recent tunnel.
4. **Local-only path:** if `!vscode.env.remoteName`, also synchronously call `readInstances()` against the local `~/.mermaid-collab/instances/` and dispatch `onInstanceUp` for each live one (skipping the openTunnel step since they're already local — just set `serverUrl` to `ws://127.0.0.1:${inst.port}/ws`).

Error handling: if `openTunnel` rejects, log to output channel and surface a notification "Couldn't forward port for collab session — open the Ports view to forward manually."

Test strategy: mocked `vscode.workspace.openTunnel`; assert command is registered; assert `serverUrl` is updated; assert global-state caching of port across calls.

---

### `extensions/vscode/src/workspace-half.ts` (new)

#### `activateWorkspace(ctx)`

```ts
const dir = path.join(os.homedir(), '.mermaid-collab', 'instances');
await fs.promises.mkdir(dir, { recursive: true });

// Initial scan
for (const inst of await readInstances()) {
  await vscode.commands.executeCommand('mermaidCollab.ui.onInstanceUp', toAnnouncement(inst));
}

// Watch for changes
const watcher = vscode.workspace.createFileSystemWatcher(
  new vscode.RelativePattern(vscode.Uri.file(dir), '*.json')
);
ctx.subscriptions.push(watcher);
watcher.onDidCreate(uri => onFileEvent(uri, 'up'));
watcher.onDidChange(uri => onFileEvent(uri, 'up'));
watcher.onDidDelete(uri => onFileEvent(uri, 'down'));
```

`onFileEvent`: parse the JSON, validate, then `executeCommand('mermaidCollab.ui.onInstanceUp', announcement)` for `up` and `mermaidCollab.ui.onInstanceDown` for `down`. Wrap in try/catch; never throw.

Edge case: VS Code Remote-SSH's file watcher can be flaky on NFS-homed `$HOME`. Add a 30s polling fallback that re-scans `instances/`.

Test strategy: mock `vscode.workspace.createFileSystemWatcher` and `vscode.commands.executeCommand`; write a fake instance file; assert `onInstanceUp` is dispatched.

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: instance-discovery
    files:
      - src/services/instance-discovery.ts
    tests:
      - src/services/__tests__/instance-discovery.test.ts
    description: "New module: deriveSessionId (sha1(project+\\0+session)[:12]), writeInstance (atomic tmp+rename, flock retained), removeInstance (idempotent, releases lock), readInstances (sweeps stale via LOCK_NB probe), findInstance, installSignalHandlers. Uses proper-lockfile for cross-platform locks."
    parallel: true
    depends-on: []

  - id: extension-manifest
    files:
      - extensions/vscode/package.json
    tests: []
    description: "Set extensionKind to [ui, workspace]; engines.vscode ^1.85.0 (stable openTunnel); add commands mermaidCollab.ui.onInstanceUp, mermaidCollab.ui.onInstanceDown, mermaidCollab.openUi; add activation event onStartupFinished."
    parallel: true
    depends-on: []

  - id: server-port-zero
    files:
      - src/config.ts
      - src/server.ts
    tests:
      - src/__tests__/server.discovery.test.ts
    description: "config.ts: export PORT_REQUEST (0 if PORT=0, else parseInt). Read MERMAID_PROJECT and MERMAID_SESSION env. server.ts: pass PORT_REQUEST to Bun.serve, after listen capture server.port, call writeInstance with full Instance record, installSignalHandlers. Log actual port + sessionId."
    parallel: false
    depends-on: [instance-discovery]

  - id: cli-whereami
    files:
      - bin/whereami.ts
    tests: []
    description: "New CLI subcommand: parses --all, --project, --session args; calls readInstances; filters; prints JSON to stdout. Exit 0 even if empty. Wire into existing bin/mermaid-collab.ts dispatcher (or whatever the project's CLI entry is)."
    parallel: false
    depends-on: [instance-discovery]

  - id: extension-ui-half
    files:
      - extensions/vscode/src/ui-half.ts
    tests:
      - extensions/vscode/src/__tests__/ui-half.test.ts
    description: "activateUi: keep existing status-bar / Chrome lifecycle from old extension.ts. Add mermaidCollab.ui.onInstanceUp command (openTunnel with cached local port from globalState, update serverUrl in workspace config). Add onInstanceDown (dispose tunnel). Add mermaidCollab.openUi (env.openExternal). Local-only path: scan ~/.mermaid-collab/instances/ directly when no remoteName."
    parallel: true
    depends-on: [extension-manifest, instance-discovery]

  - id: extension-workspace-half
    files:
      - extensions/vscode/src/workspace-half.ts
    tests:
      - extensions/vscode/src/__tests__/workspace-half.test.ts
    description: "activateWorkspace: ensure ~/.mermaid-collab/instances exists, initial scan via readInstances → executeCommand mermaidCollab.ui.onInstanceUp for each. Create FileSystemWatcher on instances/*.json; on create/change → onInstanceUp; on delete → onInstanceDown. 30s polling fallback for NFS-homed $HOME."
    parallel: true
    depends-on: [extension-manifest, instance-discovery]

  - id: extension-entry-rewrite
    files:
      - extensions/vscode/src/extension.ts
    tests:
      - extensions/vscode/src/__tests__/extension.entry.test.ts
    description: "Rewrite top-level activate() to branch on vscode.env.remoteName: truthy → activateWorkspace, else → activateUi. deactivate() is a no-op (each half manages its own subscriptions)."
    parallel: false
    depends-on: [extension-ui-half, extension-workspace-half]

  - id: integration-test-multi-instance
    files:
      - src/__tests__/multi-instance.integration.test.ts
    tests:
      - src/__tests__/multi-instance.integration.test.ts
    description: "Integration test: spawn two server processes with PORT=0 (different MERMAID_PROJECT each), assert two distinct files in ~/.mermaid-collab/instances/, assert each is reachable on its own port, kill both, assert files removed. Use temp $HOME so it's hermetic."
    parallel: true
    depends-on: [server-port-zero, cli-whereami]

  - id: integration-test-stale-cleanup
    files:
      - src/__tests__/stale-cleanup.integration.test.ts
    tests:
      - src/__tests__/stale-cleanup.integration.test.ts
    description: "Integration test: spawn server, SIGKILL it (so cleanup hooks don't fire), call readInstances, assert the stale file was unlinked (lock-probe succeeded). Use temp $HOME."
    parallel: true
    depends-on: [server-port-zero, cli-whereami]

  - id: docs-multi-instance
    files:
      - docs/multi-instance-setup.md
    tests: []
    description: "User-facing doc: how to run multiple collab servers (PORT=0 default, or explicit per-session ports), what whereami prints, how the VS Code extension auto-tunnels, how to opt into UDS isolation, Tailscale recommendation for cross-machine. Migration note: serverUrl config becomes auto-managed."
    parallel: true
    depends-on: [extension-entry-rewrite, server-port-zero]
```

### Execution Waves

**Wave 1 (parallel):**
- `instance-discovery`
- `extension-manifest`

**Wave 2 (parallel, depends on Wave 1):**
- `server-port-zero`
- `cli-whereami`
- `extension-ui-half`
- `extension-workspace-half`

**Wave 3 (depends on Wave 2):**
- `extension-entry-rewrite`

**Wave 4 (parallel, depends on Wave 3):**
- `integration-test-multi-instance`
- `integration-test-stale-cleanup`
- `docs-multi-instance`

### Summary

- **Total tasks:** 10
- **Total waves:** 4
- **Max parallelism:** 4 (in Wave 2)
