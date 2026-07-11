# Wave 2 — one-click-collab-launch

## Tasks
- **ui-half-button** (`extensions/vscode/src/ui-half.ts`) — added `CollabServerState` union, module state, `updateCollabServerBar` (5 states), `awaitInstanceUp` (pendingInstanceUp map), `startCollabServerLocal`/`startCollabServerRemote`, `mermaidCollab.toggleCollabServer` + `mermaidCollab.stopCollabServer` commands, collab status bar item (Right, 98) + "mermaid-collab Server" output channel + SIGTERM dispose hook; promoted one-shot `readLocalInstances` scan to live `fsSync.watch` + 30s polling fallback. onInstanceUp handler now resolves pending awaiters. Verified clean first try (all 12 criteria).
- **workspace-half-startserver** (`extensions/vscode/src/workspace-half.ts`) — added `resolveServerSource`/`spawnCollabServer` imports, lazy `getOrCreateOutput` "mermaid-collab Server (remote)" channel, `mermaidCollab.workspace.startServer` command (resolve → spawn → return {pid,sessionId,version}; AlreadyRunning → return existing identity). Existing FS watcher untouched. Verified clean first try.

## Verification
Both passed verify first try. tsc clean for both files (extension tsconfig).

## Wave TSC
Clean — no errors in wave-2 files.
