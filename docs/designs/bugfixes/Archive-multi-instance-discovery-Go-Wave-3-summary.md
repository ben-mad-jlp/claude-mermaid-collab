# Wave 3 Implementation

## Tasks

- **extension-entry-rewrite** — `extensions/vscode/src/extension.ts` got a 3-line early-return at the top of `activate(ctx)`: `if (ctx.extension.extensionKind === vscode.ExtensionKind.Workspace) return activateWorkspace(ctx);`. All existing UI-side logic (status bar, Chrome lifecycle, WS bridge, browser CDP, IDE commands) preserved unchanged for the Mac side. Also fixed `ui-half.ts` local-only guard from `!vscode.env.remoteName` (wrong — same value on both halves) to `ctx.extension.extensionKind === vscode.ExtensionKind.UI`.
- **integration-test-multi-instance** — `src/__tests__/multi-instance.integration.test.ts` (vitest). Spawns two `bun src/server.ts` children with PORT=0, distinct MERMAID_PROJECT/SESSION, isolated HOME=mkdtemp. Asserts distinct ports + sessionIds, distinct discovery files, `/api/health` 200 each, files unlinked after SIGTERM.
- **integration-test-stale-cleanup** — `src/__tests__/stale-cleanup.integration.test.ts` (vitest). Spawns server, SIGKILLs it, calls `readInstances` and asserts the stale `.json`/`.lock` were swept by the lock-probe.

## Verification

- All three verifies passed first try.
- Critical research correction during this wave: `vscode.env.remoteName` is identical on both halves of an `extensionKind: ["ui","workspace"]` extension (it describes the workspace, not the host). Switched to `ctx.extension.extensionKind === vscode.ExtensionKind.{UI|Workspace}` everywhere.

## Wave TSC

Clean for wave-introduced files. One pre-existing TS5097 on `src/server.ts:43` (binding-sweeper.ts import extension) remains — not introduced by this wave.
