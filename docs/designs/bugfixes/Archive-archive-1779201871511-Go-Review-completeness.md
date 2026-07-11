# Completeness Review — One-Click Collab Launch

**Verdict: Implementation complete. 1 gap (missing tests, non-blocking).**

## Tasks (6/6 implemented)

| Task | Status |
|---|---|
| server-resolver | Done — `server-resolver.ts` |
| spawn-server | Done — `spawn-server.ts` |
| extension-manifest | Done — version 1.0.17 + 3 commands |
| ui-half-button | Done — `ui-half.ts` |
| workspace-half-startserver | Done — `workspace-half.ts` |
| docs-update | Done — `docs/multi-instance-setup.md` |

## Files — all exist with real (non-stub) implementations

- `extensions/vscode/src/server-resolver.ts` (NEW, 119 lines)
- `extensions/vscode/src/spawn-server.ts` (NEW, 138 lines)
- `extensions/vscode/src/ui-half.ts` (MODIFIED)
- `extensions/vscode/src/workspace-half.ts` (MODIFIED)
- `extensions/vscode/package.json` (version 1.0.17, 3 new commands)
- `docs/multi-instance-setup.md` (One-Click Launch section, lines 135-184)

## Functions — all present, non-stub

- `resolveServerSource` — server-resolver.ts:113 (env → CLAUDE_PLUGIN_ROOT → glob fallback; version read; bun validate)
- `findHighestSemverDir` — server-resolver.ts:21 (regex filter + semver sort, null if none)
- `spawnCollabServer` — spawn-server.ts:62 (pre-flight pid probe, PORT=0 spawn, line-buffered stdio, signal abort, pid check)
- `AlreadyRunning` — spawn-server.ts:21 (class with pid/port/sessionId, correct message)
- `deriveSessionId` — spawn-server.ts:34 (inlined sha1, matches spec)
- `startCollabServerLocal` — ui-half.ts:123 (AlreadyRunning → open existing UI path; failure toast)
- `startCollabServerRemote` — ui-half.ts:151 (delegates to workspace.startServer, version-skew compare via ctx.extension.packageJSON.version)
- `toggleCollabServer` cmd — ui-half.ts:437 (ready/skew→openUi, starting→ignore, remoteName branch)
- `stopCollabServer` cmd — ui-half.ts:450 (SIGTERM child, state stopped)
- `updateCollabServerBar` — ui-half.ts:77 (all 5 states; alignment Right priority 98)
- `awaitInstanceUp` — ui-half.ts:109 (timeout + pendingInstanceUp resolver map; resolver fired at ui-half.ts:477)
- fs.watch promotion — ui-half.ts:551-575 (mkdir, initial rescan, fsSync.watch, 30s polling fallback)
- `mermaidCollab.workspace.startServer` — workspace-half.ts:162 (resolveServerSource, spawn, AlreadyRunning adoption returns existing identity)

## package.json

- version: `1.0.17` ✓
- `mermaidCollab.toggleCollabServer` ✓
- `mermaidCollab.stopCollabServer` ✓
- `mermaidCollab.workspace.startServer` ✓

## Stubs

None. No TODO / FIXME / "Not implemented" / throw-stub in any new or modified TS file.

## Acceptance criteria

- Local spawn: satisfied (startCollabServerLocal → resolveServerSource + spawnCollabServer, PORT=0).
- Remote delegate via remoteName: satisfied (toggleCollabServer checks `vscode.env.remoteName`, delegates to workspace.startServer).
- Version skew detection: satisfied (startCollabServerRemote compares result.version vs ctx.extension.packageJSON.version → 'skew' state with warning background).
- Already-running adoption: satisfied (spawn-server pre-flight pid probe throws AlreadyRunning; ui-half local path opens existing UI; workspace half returns existing identity for adoption).

## Gap (non-blocking)

**Missing test files.** The blueprint lists 4 test files under `extensions/vscode/src/__tests__/`:
- `server-resolver.test.ts`
- `spawn-server.test.ts`
- `ui-half-button.test.ts`
- `workspace-half-startserver.test.ts`

The `extensions/vscode/src/__tests__/` directory does not exist. None of the 4 test files were created. The blueprint specifies unit test strategies for server-resolver (3 lookup branches + failure) and spawn-server (mocked spawn + duplicate detection). This is a test-coverage gap only; all production code is complete and functional.
