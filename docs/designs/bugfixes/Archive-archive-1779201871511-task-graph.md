# Consolidated Task Graph

This document was auto-generated from blueprint documents.

## Summary

- **Total tasks:** 6
- **Total waves:** 3
- **Max parallelism:** 3

## Execution Waves

**Wave 1:** server-resolver, spawn-server, extension-manifest
**Wave 2:** ui-half-button, workspace-half-startserver
**Wave 3:** docs-update

## Task Graph (YAML)

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

## Dependency Visualization

```mermaid
graph TD
    server-resolver["server-resolver<br/>"New module: resolveServerSour..."]
    spawn-server["spawn-server<br/>"New module: spawnCollabServer..."]
    extension-manifest["extension-manifest<br/>"Declare 3 new commands (merma..."]
    ui-half-button["ui-half-button<br/>"Add collabServerBar status ba..."]
    workspace-half-startserver["workspace-half-startserver<br/>"Add mermaidCollab.workspace.s..."]
    docs-update["docs-update<br/>"Append a 'One-click launch' s..."]

     --> server-resolver
     --> spawn-server
     --> extension-manifest
    server-resolver --> ui-half-button
    spawn-server --> ui-half-button
    extension-manifest --> ui-half-button
    server-resolver --> workspace-half-startserver
    spawn-server --> workspace-half-startserver
    extension-manifest --> workspace-half-startserver
    ui-half-button --> docs-update
    workspace-half-startserver --> docs-update

    style server-resolver fill:#c8e6c9
    style spawn-server fill:#c8e6c9
    style extension-manifest fill:#c8e6c9
    style ui-half-button fill:#bbdefb
    style workspace-half-startserver fill:#bbdefb
    style docs-update fill:#fff3e0
```

## Tasks by Wave

### Wave 1

- **server-resolver**: "New module: resolveServerSource (env -> CLAUDE_PLUGIN_ROOT -> glob fallback for highest semver), bun resolution (env -> which/where.exe -> ~/.bun fallback per-platform), version validation. Exports ServerSource interface."
- **spawn-server**: "New module: spawnCollabServer (pre-flight duplicate detection via instance file pid probe, child_process.spawn bun src/server.ts with PORT=0, MERMAID_PROJECT, MERMAID_SESSION, stdio piped to output channel line-by-line). Exports AlreadyRunning error class. Inlines deriveSessionId (sha1) since extension tsconfig rootDir excludes src/services/."
- **extension-manifest**: "Declare 3 new commands (mermaidCollab.toggleCollabServer, mermaidCollab.stopCollabServer, mermaidCollab.workspace.startServer). Bump version 1.0.16 -> 1.0.17."

### Wave 2

- **ui-half-button**: "Add collabServerBar status bar item (alignment Right, priority 98). Add CollabServerState type + module state. Add toggleCollabServer command (open UI when ready; spawn local or delegate via workspace.startServer based on vscode.env.remoteName when stopped). Add stopCollabServer command. Add awaitInstanceUp(sessionId, timeoutMs) helper. Add updateCollabServerBar(state). Add startCollabServerLocal/Remote functions. Promote one-shot readLocalInstances scan to live fs.watch with polling fallback. Compute version skew on remote start by comparing local extensionVersion with returned remote version."
- **workspace-half-startserver**: "Add mermaidCollab.workspace.startServer command. Resolves source, spawns via spawnCollabServer with new 'mermaid-collab Server (remote)' output channel, returns {pid, sessionId, version}. Catches AlreadyRunning and returns the existing identity instead so the UI half adopts."

### Wave 3

- **docs-update**: "Append a 'One-click launch' section: how the status bar button works, what bun/source resolution looks like, how to override via MERMAID_COLLAB_ROOT or BUN_PATH, what to expect on each platform (Mac, Windows, Remote-SSH), version-skew warning meaning."
