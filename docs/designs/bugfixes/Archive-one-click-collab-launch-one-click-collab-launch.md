# Blueprint: One-Click Collab Launch

## Source Artifacts

- `design-one-click-collab-launch` — the design (architecture, components, lifecycle, per-platform notes)
- `research-one-click-collab-button` — supporting research (revised version covering all 3 targets)

## 1. Structure Summary

### Files

**New (in `extensions/vscode/src/`):**
- [ ] `server-resolver.ts` — shared helper to find the mermaid-collab plugin source root + bun binary on whatever host this extension half is running on
- [ ] `spawn-server.ts` — shared helper to spawn `bun src/server.ts` with PORT=0 + the right env, pipe stdio to a given output channel, and return `{ pid, sessionId, child }`

**Modified:**
- [ ] `extensions/vscode/package.json` — declare new commands; bump version 1.0.16 → 1.0.17
- [ ] `extensions/vscode/src/ui-half.ts` — new status bar item, `mermaidCollab.toggleCollabServer` command (local spawn OR delegate to workspace half based on `vscode.env.remoteName`), promote one-shot `readLocalInstances` scan to a live `fs.watch`, modify `mermaidCollab.openUi` to also work as the click action when a server is already running
- [ ] `extensions/vscode/src/workspace-half.ts` — new `mermaidCollab.workspace.startServer` command (spawns the server on the remote, returns `{pid, sessionId, version}`)
- [ ] `docs/multi-instance-setup.md` — append a "One-click launch" section

### Type Definitions

```ts
// server-resolver.ts
export interface ServerSource {
  rootDir: string;       // absolute path to mermaid-collab source dir on this host
  version: string;       // from <rootDir>/package.json
  bunPath: string;       // resolved absolute path to the bun binary
}

// spawn-server.ts
export interface SpawnedServer {
  pid: number;
  sessionId: string;     // sha1(project + '\0' + session).slice(0,12)
  child: import('child_process').ChildProcess;
}

export class AlreadyRunning extends Error {
  constructor(
    public readonly pid: number,
    public readonly port: number,
    public readonly sessionId: string,
  ) {
    super(`mermaid-collab server already running for sessionId ${sessionId} (pid ${pid}, port ${port})`);
  }
}

// ui-half.ts module state
type CollabServerState =
  | { kind: 'stopped' }
  | { kind: 'starting'; sessionId: string }
  | { kind: 'ready'; sessionId: string; localPort: number; remoteVersion?: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'skew'; sessionId: string; localPort: number; uiVersion: string; remoteVersion: string };
```

### Component Interactions

```
status bar click
   └── command: mermaidCollab.toggleCollabServer
         ├── if state === 'ready': open Cmd+click → stopServer()
         │                          plain click  → openUi()
         └── if state === 'stopped' / 'failed':
              ├── if vscode.env.remoteName:
              │     └── executeCommand('mermaidCollab.workspace.startServer',
              │                        { project, session })
              │           → returns { pid, sessionId, version } (workspace half spawns)
              │           → UI half waits for onInstanceUp matching sessionId,
              │             opens tunnel, derives localPort
              └── else (local):
                    ├── source = await resolveServerSource()
                    ├── spawnCollabServer({ project, session, source, output })
                    │     → returns { pid, sessionId, child }
                    │     → AlreadyRunning if a live server already owns the sessionId
                    └── live fs.watch fires onInstanceUp, ui-half sets serverUrl + state

server-resolver lookup order:
  1. process.env.MERMAID_COLLAB_ROOT
  2. process.env.CLAUDE_PLUGIN_ROOT
  3. ~/.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/<latest semver>/

bun lookup order:
  1. process.env.BUN_PATH
  2. shell `which bun` / `where.exe bun`
  3. ~/.bun/bin/bun (mac/linux) or %USERPROFILE%\.bun\bin\bun.exe (windows)
```

---

## 2. Function Blueprints

### `server-resolver.ts`

#### `async resolveServerSource(): Promise<ServerSource>`

1. Resolve `rootDir` via `MERMAID_COLLAB_ROOT` → `CLAUDE_PLUGIN_ROOT` → glob fallback `path.join(os.homedir(), '.claude/plugins/cache/mermaid-collab-dev/mermaid-collab/*')` and pick the highest semver via simple sort.
2. Validate `<rootDir>/src/server.ts` and `<rootDir>/package.json` exist; else throw `Error('Could not locate mermaid-collab source dir — set MERMAID_COLLAB_ROOT')`.
3. Read `version` from `<rootDir>/package.json`.
4. Resolve `bunPath`:
   - If `process.env.BUN_PATH` is set and that file is executable → use it.
   - Else try `child_process.execSync('which bun')` (or `where.exe bun` on win32).
   - Else fall back to `path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')`.
   - Validate by running `bunPath --version`; if it fails or output doesn't look like a semver, throw `Error('bun not found or invalid — install from https://bun.sh')`.
5. Return `{ rootDir, version, bunPath }`.

**Edge cases:** glob fallback returns empty array (no plugin cache yet); two cache versions same number (sort stable); macOS GUI-launched VS Code has empty PATH; Windows `where.exe` returns multiple lines — pick first.

**Test strategy:** unit test with mocked `os.homedir`, `fs.existsSync`, and `execSync`; cover the 3 lookup branches per resolution + the failure path.

#### `async findHighestSemverDir(parent: string): Promise<string | null>`

Read `parent` dir, filter to entries that look like X.Y.Z, sort by semver, return the highest. Returns null if none.

---

### `spawn-server.ts`

#### `async spawnCollabServer(opts: { project, session, source, output, signal? }): Promise<SpawnedServer>`

1. `sessionId = deriveSessionId(opts.project, opts.session)` — re-derive locally (don't import from `src/services/instance-discovery.ts`; the extension's tsconfig rootDir doesn't reach src/services. Inline the SHA1 logic, ~3 lines).
2. **Pre-flight duplicate check:**
   - `instancePath = path.join(os.homedir(), '.mermaid-collab', 'instances', sessionId + '.json')`
   - If exists, parse JSON. If `pid` is alive (`process.kill(pid, 0)` succeeds) → throw `new AlreadyRunning(pid, port, sessionId)`.
   - If parse fails or pid dead → unlink `instancePath` + matching `.lock` (best effort), proceed.
3. `output.appendLine` a header: source root, version, bun path, project, session, sessionId.
4. Spawn:
   ```ts
   const child = child_process.spawn(opts.source.bunPath, ['src/server.ts'], {
     cwd: opts.source.rootDir,
     env: { ...process.env, PORT: '0', MERMAID_PROJECT: opts.project, MERMAID_SESSION: opts.session },
     stdio: ['ignore', 'pipe', 'pipe'],
     detached: false,
   });
   ```
5. Wire stdout/stderr → `output.appendLine`. Buffer chunk → split on `\n`.
6. Wire `child.on('error', err => output.appendLine('[server] spawn error: ' + err.message))` and `child.on('exit', code => output.appendLine('[server] exited code=' + code))`.
7. Honour `opts.signal?.addEventListener('abort', () => child.kill('SIGTERM'))`.
8. Return `{ pid: child.pid!, sessionId, child }` immediately — do NOT wait for the server to be ready. The caller waits for `onInstanceUp` matching `sessionId` to know it's serving.

**Edge cases:** `child.pid` is undefined if spawn fails synchronously (bad bunPath); throw immediately. Long-living stdout chunks split mid-line; buffer.

**Test strategy:** unit test with mocked spawn (returns a mock ChildProcess); test pre-flight duplicate detection with temp $HOME containing fake instance.json files (alive vs dead pid).

---

### `ui-half.ts` — additions

Module state: `let collabServerState: CollabServerState = { kind: 'stopped' }; let collabServerChild: ChildProcess | null = null; let collabServerBar: vscode.StatusBarItem; let collabServerOutput: vscode.OutputChannel; let instancesWatcher: fs.FSWatcher | null = null;`

#### `async startCollabServerLocal(ctx, project, session): Promise<void>`

1. Set state `'starting'`. Update status bar.
2. `source = await resolveServerSource()` — on error, state `'failed'`, surface in output channel + warning toast.
3. `result = await spawnCollabServer({ project, session, source, output: collabServerOutput })` — on `AlreadyRunning`, jump to "open existing UI" path.
4. `collabServerChild = result.child`. Wait for `onInstanceUp` matching `result.sessionId` (existing handler resolves a promise via a sessionId→resolver map; create a tiny `awaitInstanceUp(sessionId, timeoutMs=30_000)` helper for this).
5. On the resulting Instance, `localPort` is the actual bound port (since local). Set state `'ready'` with `localPort`. Update status bar.

#### `async startCollabServerRemote(project, session): Promise<void>`

1. Set state `'starting'`. Update status bar.
2. `result = await vscode.commands.executeCommand<{pid: number, sessionId: string, version: string}>('mermaidCollab.workspace.startServer', { project, session })`. On error → state `'failed'`.
3. Wait for `onInstanceUp` matching `result.sessionId` (existing watcher already covers remote-side files).
4. The `onInstanceUp` handler opens the tunnel and updates `globalState`. Read back the cached `tunnel:<sessionId>` localPort.
5. Compare `result.version` with our `extensionVersion` (read from `ctx.extension.packageJSON.version` or hardcoded `SERVER_VERSION` constant). If mismatch → state `'skew'`. Else `'ready'`.

#### `mermaidCollab.toggleCollabServer` command body

```ts
async () => {
  const wf = vscode.workspace.workspaceFolders?.[0];
  if (!wf) { vscode.window.showWarningMessage('mermaid-collab: open a folder first'); return; }
  const project = wf.uri.fsPath;
  const session = path.basename(project);  // simple default; configurable later

  if (collabServerState.kind === 'ready' || collabServerState.kind === 'skew') {
    // plain click → open UI
    return vscode.commands.executeCommand('mermaidCollab.openUi');
  }
  if (collabServerState.kind === 'starting') {
    return; // ignore, in flight
  }
  // stopped | failed
  if (vscode.env.remoteName) {
    return startCollabServerRemote(project, session);
  }
  return startCollabServerLocal(ctx, project, session);
}
```

(Cmd+click "stop" handled by a separate `mermaidCollab.stopCollabServer` command bound to the alt-modifier; or a context menu entry. v1: ship a separate command, no modifier wiring.)

#### `mermaidCollab.stopCollabServer` command body

```ts
async () => {
  if (collabServerChild) {
    collabServerChild.kill('SIGTERM');
    collabServerChild = null;
  }
  collabServerState = { kind: 'stopped' };
  updateCollabServerBar();
}
```

#### `updateCollabServerBar(): void`

Switch on `collabServerState.kind`:

| kind | text | tooltip | bg |
|---|---|---|---|
| stopped | `$(plug) collab` | "Click to start collab server" | none |
| starting | `$(loading~spin) collab` | "Starting…" | none |
| ready | `$(check) collab :NNNN` | "Local server on :NNNN — click to open UI" | none |
| skew | `$(warning) collab :NNNN` | "UI vN, remote vM — click to open UI (mismatch)" | warningBackground |
| failed | `$(error) collab` | reason + "click to view log" | warningBackground |

Place at `StatusBarAlignment.Right, 98` (left of CDP at 99).

#### Watcher promotion in `activateUi`

Replace the existing one-shot `readLocalInstances()` block with:

```ts
const dir = path.join(os.homedir(), '.mermaid-collab', 'instances');
try { await fs.mkdir(dir, { recursive: true }); } catch {}

const onChange = async () => {
  const instances = await readLocalInstances();
  for (const inst of instances) {
    await vscode.commands.executeCommand('mermaidCollab.ui.onInstanceUp', inst);
  }
  // detect removals: track previously-known set, dispatch onInstanceDown for missing
};

// Initial scan
await onChange();

// Live watch
try {
  instancesWatcher = fs.watch(dir, { persistent: false }, () => { void onChange(); });
  ctx.subscriptions.push({ dispose: () => instancesWatcher?.close() });
} catch (err) {
  collabServerOutput.appendLine('[watch] failed to watch instances/ — falling back to polling');
  // 30s polling fallback similar to workspace-half
}
```

**Edge cases:** `fs.watch` on macOS can fire 2x for a single rename (atomic write via tmp+rename); the Set-based dedup in onChange handles this. Some filesystems (NFS) don't fire — keep the polling fallback.

---

### `workspace-half.ts` — additions

#### `mermaidCollab.workspace.startServer` command body

```ts
vscode.commands.registerCommand('mermaidCollab.workspace.startServer', async (
  args: { project: string; session: string }
): Promise<{ pid: number; sessionId: string; version: string }> => {
  const source = await resolveServerSource();
  const output = getOrCreateOutput('mermaid-collab Server (remote)');
  try {
    const result = await spawnCollabServer({
      project: args.project,
      session: args.session,
      source,
      output,
    });
    return { pid: result.pid, sessionId: result.sessionId, version: source.version };
  } catch (err) {
    if (err instanceof AlreadyRunning) {
      // Already running — return the existing one's identity for UI half to adopt
      return { pid: err.pid, sessionId: err.sessionId, version: source.version };
    }
    throw err;
  }
});
```

The existing FS watcher in `workspace-half.ts` continues to fire `onInstanceUp` on the UI half via the built-in command-RPC channel.

---

### `extensions/vscode/package.json` changes

```jsonc
{
  "version": "1.0.17",
  "contributes": {
    "commands": [
      // ... existing 7 commands ...
      { "command": "mermaidCollab.toggleCollabServer", "title": "mermaid-collab: Start / Stop Collab Server" },
      { "command": "mermaidCollab.stopCollabServer", "title": "mermaid-collab: Stop Collab Server" },
      { "command": "mermaidCollab.workspace.startServer", "title": "mermaid-collab: (Workspace) Start Server (internal)" }
    ]
  }
}
```

---

## 3. Task Dependency Graph

### YAML Graph

```yaml
tasks:
  - id: server-resolver
    files: [extensions/vscode/src/server-resolver.ts]
    tests: [extensions/vscode/src/__tests__/server-resolver.test.ts]
    description: "New module: resolveServerSource (env -> CLAUDE_PLUGIN_ROOT -> glob fallback for highest semver), bun resolution (env -> which/where.exe -> ~/.bun fallback per-platform), version validation. Exports ServerSource interface."
    parallel: true
    depends-on: []

  - id: spawn-server
    files: [extensions/vscode/src/spawn-server.ts]
    tests: [extensions/vscode/src/__tests__/spawn-server.test.ts]
    description: "New module: spawnCollabServer (pre-flight duplicate detection via instance file pid probe, child_process.spawn bun src/server.ts with PORT=0, MERMAID_PROJECT, MERMAID_SESSION, stdio piped to output channel line-by-line). Exports AlreadyRunning error class. Inlines deriveSessionId (sha1) since extension tsconfig rootDir excludes src/services/."
    parallel: true
    depends-on: []

  - id: extension-manifest
    files: [extensions/vscode/package.json]
    tests: []
    description: "Declare 3 new commands (mermaidCollab.toggleCollabServer, mermaidCollab.stopCollabServer, mermaidCollab.workspace.startServer). Bump version 1.0.16 -> 1.0.17."
    parallel: true
    depends-on: []

  - id: ui-half-button
    files: [extensions/vscode/src/ui-half.ts]
    tests: [extensions/vscode/src/__tests__/ui-half-button.test.ts]
    description: "Add collabServerBar status bar item (alignment Right, priority 98). Add CollabServerState type + module state. Add toggleCollabServer command (open UI when ready; spawn local or delegate via workspace.startServer based on vscode.env.remoteName when stopped). Add stopCollabServer command. Add awaitInstanceUp(sessionId, timeoutMs) helper. Add updateCollabServerBar(state). Add startCollabServerLocal/Remote functions. Promote one-shot readLocalInstances scan to live fs.watch with polling fallback. Compute version skew on remote start by comparing local extensionVersion with returned remote version."
    parallel: false
    depends-on: [server-resolver, spawn-server, extension-manifest]

  - id: workspace-half-startserver
    files: [extensions/vscode/src/workspace-half.ts]
    tests: [extensions/vscode/src/__tests__/workspace-half-startserver.test.ts]
    description: "Add mermaidCollab.workspace.startServer command. Resolves source, spawns via spawnCollabServer with new 'mermaid-collab Server (remote)' output channel, returns {pid, sessionId, version}. Catches AlreadyRunning and returns the existing identity instead so the UI half adopts."
    parallel: false
    depends-on: [server-resolver, spawn-server, extension-manifest]

  - id: docs-update
    files: [docs/multi-instance-setup.md]
    tests: []
    description: "Append a 'One-click launch' section: how the status bar button works, what bun/source resolution looks like, how to override via MERMAID_COLLAB_ROOT or BUN_PATH, what to expect on each platform (Mac, Windows, Remote-SSH), version-skew warning meaning."
    parallel: true
    depends-on: [ui-half-button, workspace-half-startserver]
```

### Execution Waves

**Wave 1 (parallel):**
- `server-resolver`
- `spawn-server`
- `extension-manifest`

**Wave 2 (parallel, depends on Wave 1):**
- `ui-half-button`
- `workspace-half-startserver`

**Wave 3 (depends on Wave 2):**
- `docs-update`

### Summary

- Total tasks: **6**
- Total waves: **3**
- Max parallelism: **3** (Wave 1)
