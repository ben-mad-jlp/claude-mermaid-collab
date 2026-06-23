# Wave 5 Implementation — MCP & API Reroute

## Tasks completed
- **reroute-pseudo-api** — retired `/stale` endpoint in `src/routes/pseudo-api.ts` with 410 Gone.
- **reroute-code-api** — NO CHANGES. Only read-through methods used (`.search`, `.getMethodLocation`).
- **reroute-onboarding** — NO CHANGES. `onboarding-api.ts`, `onboarding-manager.ts`, `onboarding-db.ts` all use only read-through shim methods (`.listFiles`, `.getFile`, `.getCallGraph`).
- **reroute-mcp-tools** — rerouted 4 MCP handlers in `src/mcp/setup.ts`:
  - `pseudo_index_structural` → `initPseudoDbV6(project).indexer.runIncrementalScanForFile(filePath, { trigger: 'manual' })`
  - `pseudo_index_project` → `initPseudoDbV6(project).indexer.runFullScan({ trigger: 'manual' })`
  - `pseudo_upsert_prose` → maps legacy `ProseData` to `UpsertProseInput` and delegates to `pseudo_upsert_prose_v6`
  - `pseudo_stale_check` → returns `{ stale: [], deprecated: true, reason: ... }` (shim already degraded to empty)
  - Removed now-unused imports: `scanSourceFile`, `isSupportedExtension` from `../services/source-scanner.js`.

## Key semantic notes
- Legacy `pseudo_upsert_prose` payload has `{steps: [{content, depth}]}`; V6 wants `{steps: [{order, content}]}`. `order` synthesized as `i + 1`.
- Legacy `data.calls[]` dropped — V6 derives call edges from source scans, not prose.
- `enclosing_class: null`, `origin: 'llm'` injected (legacy had no such fields).
- `pseudo_index_project` response gains `runId` and `status` fields, drops the per-file method count (V6 doesn't synchronously return it).

## Verification
- `tsc --noEmit`: 0 errors.
- `bun test` scoped: 99/126 pass; all 27 failures are PRE-EXISTING and unrelated (terminal-tools hardcoded macOS path; pseudo-api test fixture ENOENTs; ON CONFLICT snapshot writer issue — all verified on stash of this wave's changes).
- `/stale` retirement confirmed at pseudo-api.ts:73-78.
- 4 handler reroutes confirmed in setup.ts (lines 4034, 4053, 4065, 4083).

## Known follow-ups (deferred)
- pseudo-snapshot ON CONFLICT error — pre-existing, unchanged.
- V2-era pseudo-db.test.ts — Wave 7 retires it.
