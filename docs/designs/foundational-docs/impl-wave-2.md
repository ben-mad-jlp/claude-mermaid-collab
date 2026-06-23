# Wave 2 Implementation

## Tasks (4)

| Task | Files | Summary |
|---|---|---|
| `pseudo-indexer-resolve-pass` | `src/services/pseudo-indexer.ts` | Imported `resolveCallEdges`. `insertCall` INSERT shape bumped to (caller_method_id, callee_name, callee_name_hint, callee_method_id, file_path, resolution_quality) with `callee_method_id=NULL` and `resolution_quality='unresolved'`. `scanOneFile` now binds `edge.receiver_hint ?? null`. `runFullScan` calls `resolveCallEdges(db)` between `applyOverlay` and `populateFtsFor`. `runIncrementalScan` calls `resolveCallEdges(db, { scopeFiles: paths })` at the same point. |
| `prose-file-self-heal` | `src/services/pseudo-prose-file.ts` + 5 cascade callers | `readProseFile` signature gains optional `project?: string`. When provided, runs `toRelPosixPath(project, proseFile.file)` in try/catch — on success, overwrites `proseFile.file` in-memory; on throw (cross-machine), leaves untouched so migration can bucket it. Callers updated: `pseudo-indexer.ts`, `pseudo-orphan.ts`, `pseudo-watcher.ts`, `pseudo-reassign.ts`, `pseudo-upsert-prose.ts`. |
| `prose-migration-func` | `src/services/pseudo-migration.ts` | New `migrateProseFilesToRelative(project)` exported, with `RelMigrationReport` shape. Walks `.collab/pseudo/prose/`, skips `_orphan`/`_attic`/`_path_map.json`, rewrites ProseFileV3.file to rel POSIX via `toRelPosixPath`, moves cross-machine files to `_orphan/`, writes sentinel `.migrated-rel`. Also patched the v1→v6 bug at lines 177-188: now derives `relPath` (with fallback to `absSource`) before using it as both `v3.file` and `escapePath` input. |
| `upsert-prose-normalize` | `src/mcp/tools/pseudo-upsert-prose.ts` | Added `input.file = toRelPosixPath(project, input.file)` right before the `escapePath` call so new prose writes can't embed absolute paths as mirrored segments. |

## Verification

- `bunx tsc --noEmit` clean on all wave files. Only two pre-existing TS5097 errors (`src/lib/mermaid.ts:2`, `src/services/renderer.ts:2`) — unrelated.
- All 9 grep sanity checks passed.

## Notes captured during Wave 2

- `readProseFile`'s self-heal is in-memory only (by design). Disk rewrite lives in `migrateProseFilesToRelative`.
- `migrateProseFilesToRelative` uses a `.migrated-rel` sentinel separate from the v1→v6 `.migrated` sentinel — idempotent, independently runnable.
- `relative` from `node:path` was imported in pseudo-migration.ts per task spec but is currently unused (the function body uses `toRelPosixPath` and `basename` instead). Safe to remove later if a stricter lint pass lands.
- The cascade affected 5 caller files, which multiplied Wave 2's blast radius. Each edit was trivial (one arg add). One caller (pseudo-migration.ts's own new `migrateProseFilesToRelative` call to `readProseFile(oldPath)`) intentionally omits `project` because the function does its own path normalization explicitly downstream.
