# Wave 1 Implementation

## Tasks

- **instance-discovery** (`src/services/instance-discovery.ts`) — new module created with `Instance`/`DiscoveryPaths` types and exports `getDiscoveryPaths`, `deriveSessionId`, `writeInstance`, `removeInstance`, `readInstances`, `findInstance`, `installSignalHandlers`. Atomic tmp+fsync+rename. proper-lockfile guard with `ELOCKED` → "Duplicate instance" error. Stale-record GC via lock-acquisition probe in `readInstances`. SIGINT/SIGTERM/exit handlers (idempotent per sessionId). Added `proper-lockfile` runtime dep + `@types/proper-lockfile` devDep.
- **extension-manifest** (`extensions/vscode/package.json`) — version 1.0.14 → 1.0.15; `extensionKind: ["ui"]` → `["ui","workspace"]`; appended 3 commands (`mermaidCollab.ui.onInstanceUp`, `mermaidCollab.ui.onInstanceDown`, `mermaidCollab.openUi`).

## Verification

- `instance-discovery.ts`: all expected exports present, semantics match blueprint, no new tsc errors in the file.
- `package.json`: JSON parses, all expected fields updated, original 4 commands and configuration preserved.

## Wave TSC

Clean — no new errors introduced by this wave (82 pre-existing project-wide errors remain unchanged).
