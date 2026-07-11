# Completeness Review

## Summary

Implementation is functionally complete against the blueprint's source/integration deliverables, but **4 unit-test files specified in the task graph were not created**. All production source files exist with the promised exports and non-stub bodies. Acceptance criteria for multi-user and multi-session isolation are satisfied, and the extension correctly uses `ctx.extension.extensionKind` (not `vscode.env.remoteName`) per the Wave 3 correction.

## Files Verified Present

### New (production)
- `src/services/instance-discovery.ts` — all exports present: `Instance`, `DiscoveryPaths`, `getDiscoveryPaths`, `deriveSessionId`, `writeInstance`, `removeInstance`, `readInstances`, `findInstance`, `installSignalHandlers`.
- `bin/whereami.ts` — exports `whereami(argv)`.
- `extensions/vscode/src/ui-half.ts` — exports `activateUi`, `Instance`.
- `extensions/vscode/src/workspace-half.ts` — exports `activateWorkspace`.
- `src/__tests__/multi-instance.integration.test.ts`
- `src/__tests__/stale-cleanup.integration.test.ts`
- `docs/multi-instance-setup.md`

### Modified
- `src/config.ts` — `PORT_REQUEST`, `MERMAID_PROJECT`, `MERMAID_SESSION` exported (line 70+).
- `src/server.ts` — passes `PORT_REQUEST` to `Bun.serve`, captures `actualPort = server.port ?? PORT_REQUEST` (line 395), calls `writeInstance` (line 398) and `installSignalHandlers` (line 412).
- `bin/mermaid-collab.ts` — wires `whereami` subcommand (per Wave 2 summary).
- `extensions/vscode/package.json` — `extensionKind: ["ui","workspace"]`, version bump, new commands.
- `extensions/vscode/src/extension.ts` — branches on `context.extension.extensionKind === vscode.ExtensionKind.Workspace` at line 31 to delegate to `activateWorkspace`.
- `package.json` — `proper-lockfile` runtime dep + `@types/proper-lockfile` devDep (lines 33, 38).

## Gaps Found (4)

All gaps are **missing unit-test files** that were listed in the blueprint task graph (Section 3 / Task Dependency Graph):

1. **`src/services/__tests__/instance-discovery.test.ts`** — specified under task `instance-discovery`. Missing. The blueprint described a unit-test strategy per function (atomic write, lock collision, stale sweep). Only integration coverage exists.
2. **`extensions/vscode/src/__tests__/ui-half.test.ts`** — specified under task `extension-ui-half` ("mocked openTunnel; assert command registration; serverUrl update; globalState caching"). Missing.
3. **`extensions/vscode/src/__tests__/workspace-half.test.ts`** — specified under task `extension-workspace-half` ("mock createFileSystemWatcher and executeCommand; assert dispatch"). Missing.
4. **`extensions/vscode/src/__tests__/extension.entry.test.ts`** — specified under task `extension-entry-rewrite`. Missing.

The Wave summaries do not mention these test files, suggesting the implement agents skipped them silently. Integration tests (`multi-instance`, `stale-cleanup`) are present and do exercise the discovery module end-to-end, but the unit-level coverage promised by the blueprint is absent.

## Acceptance Criteria

- **Multi-user-per-host (case 3):** Satisfied. `getDiscoveryPaths` uses `homedir()` (instance-discovery.ts line 35), so each user's `~/.mermaid-collab/instances/` is naturally isolated.
- **Multi-session-per-user (case 4):** Satisfied. `deriveSessionId` is `sha1(project + '\0' + session).slice(0,12)` (line 47-48), producing distinct IDs per `(project, session)` pair, exactly per spec.
- **Extension-kind detection:** Satisfied. `extension.ts:31` and `ui-half.ts:374` both use `ctx.extension.extensionKind === vscode.ExtensionKind.{Workspace|UI}`. No reliance on `vscode.env.remoteName` for the half-split branching (it appears only in the legacy code paths inside `extension.ts`, not as the dispatch criterion). This matches the Wave 3 correction noted in the summary.

## Stub Scan

No `TODO`, `Not implemented`, `NotImplementedError`, or `todo!()` markers found in any of the new or modified files.

## Verdict

Production implementation matches the blueprint. Gap is exclusively in unit-test scaffolding (4 files). Recommend either backfilling those tests or formally accepting the integration-only coverage as adequate.
