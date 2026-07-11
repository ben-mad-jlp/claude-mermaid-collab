# Wave 2 Implementation

## Tasks

- **server-port-zero** — `src/config.ts` got `PORT_REQUEST`, `MERMAID_PROJECT`, `MERMAID_SESSION` exports (existing `config.PORT` left untouched). `src/server.ts` now passes `PORT_REQUEST` to `Bun.serve`, captures `actualPort = server.port ?? PORT_REQUEST`, calls `writeInstance({...})` (exits 1 on lock collision), `installSignalHandlers(sessionId)`, logs `mermaid-collab listening on :PORT, advertised as <id>`. `src/mcp/server.ts` exported `SERVER_VERSION`.
- **cli-whereami** — `bin/whereami.ts` (new) exports `whereami(argv)` parsing `--all`, `--project`, `--session` (both `--key val` and `--key=val` forms), filters via `readInstances()`, prints JSON. `bin/mermaid-collab.ts` got `import { whereami }`, a `case 'whereami':` in the dispatcher, and a help line.
- **extension-ui-half** — `extensions/vscode/src/ui-half.ts` (new) exports `activateUi(ctx)` and `Instance` interface. Lifts CHROME constants + Chrome lifecycle helpers (`startChromeDebug`, `stopChromeDebug`, etc.) from `extension.ts`. New commands: `mermaidCollab.ui.onInstanceUp` (openTunnel + serverUrl update), `mermaidCollab.ui.onInstanceDown` (dispose tunnel), `mermaidCollab.openUi` (env.openExternal). Local-only path scans `~/.mermaid-collab/instances/`. Inline `readLocalInstances` since extension's tsconfig rootDir doesn't reach `src/services/`. extension.ts left UNCHANGED (Wave 3 wires it up).
- **extension-workspace-half** — `extensions/vscode/src/workspace-half.ts` (new) exports `activateWorkspace(ctx)`. Watches `~/.mermaid-collab/instances/` via VS Code FileSystemWatcher; initial scan + create/change/delete handlers + 30s polling fallback (sweeps dead PIDs via `process.kill(pid, 0)`). Dispatches `mermaidCollab.ui.onInstanceUp/onInstanceDown` over the built-in command-RPC channel.

## Verification

- All four task pairs verified semantically.
- Two fix-loop iterations:
  - `src/server.ts` line 401: `server.port` is `number | undefined` → narrowed via `?? PORT_REQUEST`.
  - `extensions/vscode/src/ui-half.ts`: `vscode.Tunnel` and `vscode.workspace.openTunnel` typed as proposed → replaced with structural type + `(vscode.workspace as any).openTunnel(...)` cast.
- Both files re-passed verify after fix.

## Wave TSC

Clean for wave-introduced files. One pre-existing TS5097 on `src/server.ts:43` (binding-sweeper.ts import extension) remains — not introduced by this wave.
